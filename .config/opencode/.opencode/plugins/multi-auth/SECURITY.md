# multi-auth — Security Review Package

**Plugin:** `.opencode/plugins/multi-auth.ts` + `.opencode/plugins/multi-auth/`  
**Audience:** Warp security re-review before default-on rollout  
**Evidence basis:** Implementation sources + `__tests__/*.test.ts` (suite green at packaging time)  
**Scope of this document:** Documentation only — no code changes.

---

## 1. Scope & threat model summary

### What the plugin handles

| Asset / surface | Description |
| --- | --- |
| **Long-lived OAuth refresh tokens** | Claude Pro/Max (Anthropic) OAuth refresh + access tokens for the user’s own paid accounts |
| **Multi-account store** | Per-provider JSON at `~/.local/share/opencode/multi-auth/<provider>.json` (0600 file, 0700 dir) |
| **Custom fetch in the request path** | `createFetchWrapper` injects `Authorization: Bearer <access>` only for allowlisted API origins; multiplexes accounts on quota/rate-limit exhaustion |
| **OAuth authorize path** | PKCE S256 authorize + loopback (`127.0.0.1`) or manual code paste; tokens written to the plugin store |
| **auth.json interaction** | Loader returns inert `apiKey: "multi-auth-placeholder"`; authorize callback still returns a success payload for opencode’s single auth slot (last login) |

### Threat model (in scope)

- **Token theft from disk** — world/group-readable store, temp/backup residue, lock-file leakage, umask-dependent modes
- **Token exfiltration via network** — Bearer injection to non-Anthropic origins; open redirects after credentialed requests
- **Token leakage via logs/toasts** — access/refresh/placeholder appearing in logger or TUI notify
- **OAuth CSRF / code interception** — weak PKCE, non-loopback bind, state reuse, logging of authorization codes
- **Refresh rotation loss** — concurrent refresh without mutex; use-before-write of rotated refresh tokens
- **False permanent reauth** — treating network/5xx as `invalid_grant` and burning accounts
- **Cross-process store corruption** — concurrent opencode processes mutating the same store file
- **Provider ToS / abuse** — automated multi-account rotation may violate Anthropic Terms of Service

### Out of scope (this package)

- Host compromise with same-UID process memory access
- Malicious opencode core / other plugins with equal privileges
- Provider-side account security (password, MFA, Anthropic console)
- Non-Anthropic providers (v1 wires anthropic only)

---

## 2. S1–S8 mitigations (code pointers + test evidence)

| ID | Concern | Mitigation implemented | Code pointers | Test evidence (exact titles) |
| --- | --- | --- | --- | --- |
| **S1** | Store file permissions | `FILE_MODE = 0o600`, `DIR_MODE = 0o700`; `assertSecureFile` / `isGroupOrWorldAccessible` refuse group/world bits on open; `writeFileAtomic` opens temp with explicit `O_CREAT\|O_EXCL\|O_WRONLY` + mode 0600; post-rename `chmod` 0600; corrupt recovery backups also 0600. **Symlink/TOCTOU:** `assertSecureFile` uses `fs.stat` (follows symlinks); no `lstat`/ownership check — residual (see §6). | `store.ts`: `FILE_MODE`, `DIR_MODE`, `assertSecureFile`, `isGroupOrWorldAccessible`, `writeFileAtomic`, `MultiAuthStore.readUnlocked`, `ensureDir`, `recoverCorrupt` | `permission enforcement` → `read refuses group/world-readable store (0644)`; `mutate also refuses insecure store`; `F3 file modes (umask-independent)` → `temp/backup/store files are 0600 under permissive umask`; `simulated-crash temp residue is 0600`; `corrupt-file recovery` → `garbage JSON → backup created (0600) + fresh empty store` |
| **S2** | OAuth authorize re-implementation | Anthropic adapter re-implements authorize with PKCE S256, CSPRNG verifier/state, loopback on `127.0.0.1` only, exact-match redirect URI, constant-time state compare, single-use state, strict auth-code format, manual code never logged | `adapters/anthropic.ts`: `generateCodeVerifier`, `s256Challenge`, `generateState`, `constantTimeEqual`, `startLoopbackListener`, `buildAuthorizeUrl`, `createAnthropicAdapter.authorize`, `AUTH_CODE_RE`, `isValidAuthCodeFormat` | `F5 PKCE helpers` → all four tests; `F5 loopback listener` → `accepts exact redirect and single-use state; rejects mismatch/reuse/wrong path`; `wrong port is not our listener (exact-match host:port)`; `F5 manual code format` → `rejects wrong-format codes`; `authorize rejects invalid manual code without logging it`; `authorize integration` → `authorize → success tokens; code never logged; challenge is S256` |
| **S3** | Token refresh | Per-label in-process async mutex (`mutexFor` / `Mutex.runExclusive`); **write-then-use**: `await persist(tokens)` before returning `ok` access; persist failure aborts return | `refresh.ts`: `refreshAccount`, `mutexFor`, `_resetRefreshMutexesForTests`; `fetch-wrapper.ts`: `persistTokens`, `doRefresh`, `ensureFreshAccess` | `refreshAccount — happy path + write-then-use` → `persist is invoked BEFORE function resolves with new tokens`; `persist failure prevents returning ok tokens`; `single-flight mutex per account label` → `concurrent refresh for same label is serialized`; `token refresh` → `expired token → refresh called before dispatch; rotated token persisted before use` |
| **S4** | Custom fetch header injection | Frozen origin allowlist from adapter (`ANTHROPIC_API_ORIGINS`); non-allowlisted: strip creds via `sanitizeHeaders`, pass-through; allowlisted: inject Bearer only; `redirect: "manual"`; 3xx → throw (never follow); `PLACEHOLDER_API_KEY` stripped from all header values | `fetch-wrapper.ts`: `PLACEHOLDER_API_KEY`, `sanitizeHeaders`, `isAllowlistedOrigin`, `createFetchWrapper` (dispatch + redirect handling); `adapters/anthropic.ts`: `ANTHROPIC_API_ORIGINS` | `F1 security` → `sentinel placeholder never present in outgoing headers`; `non-allowlisted origin receives NO Authorization and no x-api-key`; `providerConfig containing extra origin keys has no effect (allowlist frozen)`; `3xx on credentialed request → error, fetchImpl called with redirect:manual`; `happy path` → `injects Authorization Bearer, single attempt, touches lastUsedAt` |
| **S5** | Logging / toast redaction | Central `redact()` strips Bearer, secret-looking prefixes, JWT-ish strings, placeholder; all fetch-wrapper log/notify paths call `redact`; `status.ts` redacts before toast/log | `fetch-wrapper.ts`: `redact`, log helpers, `emitNotify`; `status.ts`: `createStatus` | `redact` → `strips Bearer tokens and placeholder`; `S5 redaction` → `logger output never contains access/refresh token substrings`; `suite log hygiene` → `allLogLines contain no known secret substrings from this suite`; `createStatus` → `log mode writes redacted label-only lines; no token material`; `redact helper strips secrets`; `429 failover` → `all exhausted → 429 surfaced + notify with earliest reset, no tokens` |
| **S6** | auth.json interaction | Plugin store is **source of truth** for multi-account tokens and selection. Loader returns `apiKey: PLACEHOLDER_API_KEY` + custom `fetch` (sentinel never used as real key). Authorize callback still returns last-login tokens for opencode’s single auth.json slot (overwritten each login) — intentional host integration, not multi-account multiplexing | `multi-auth.ts`: `buildAuthHook` → `loader` (`PLACEHOLDER_API_KEY`), authorize `callback` success payload + `store.upsertAccount`; comment at success return | `loader` → `returns placeholder apiKey and callable fetch`; `authorize appends labeled accounts` → `two authorize() runs create two labeled accounts; each callback returns success` (store has N accounts; logs free of tokens) |
| **S7** | Multi-process concurrency | Advisory lock via `O_EXCL` lock file (`{pid,hostname,timestamp}` only — token-free); `mutate` always re-reads after lock; atomic rename write; stale lock reclaim by dead PID / age | `store.ts`: `acquireLock`, `tryClearStaleLock`, `mutate`, `writeFileAtomic`, `lockPayload` | `concurrent mutate` → `parallel mutations do not lose updates or corrupt JSON`; `F3` → `lock-file content never matches token patterns` |
| **S8** | ToS / abuse posture | User-owned accounts only (no pooling/sharing); honors provider reset windows (`cooling_down` / `resetAt`); `stickyWithinSession` default **`true`** as anti-abuse control (minimizes rotation churn / cross-account alternation), not merely prompt-cache optimization. **Full disclosure: §4 (F6).** | `config.ts`: `DEFAULT_STICKY_WITHIN_SESSION`, `stickyWithinSession`; `selector.ts` session affinity; `fetch-wrapper.ts` sessionAffinity; `detect.ts` exhaustion classification | `select — session stickiness` → `affinity kept at tied best priority`; `affinity ignored when stickyWithinSession is false`; e2e cooldown/failback tests; config default sticky true via `defaults every optional field on a minimal provider entry` |

---

## 3. Per-finding closure evidence (F1–F6)

### F1 — Hardcoded frozen origin allowlist + redirect:manual + sentinel strip

| Claim | Code | Tests |
| --- | --- | --- |
| `ANTHROPIC_API_ORIGINS` frozen, only `https://api.anthropic.com` | `adapters/anthropic.ts` → `ANTHROPIC_API_ORIGINS = Object.freeze([...])`; adapter exposes same ref | `F1 ANTHROPIC_API_ORIGINS` → `is frozen and contains only api.anthropic.com`; `adapter.apiOrigins is the same frozen constant` |
| Config override inert | `config.ts` → `FORBIDDEN_CONFIG_KEYS` + `stripForbiddenKeys` (warn + drop `allowedOrigins`, `apiOrigins`, `followRedirects`, …) | `F1: origin allowlist / redirect keys stripped` → `allowedOrigins / apiOrigins / followRedirects have no effect on resolved config`; fetch-wrapper `providerConfig containing extra origin keys has no effect (allowlist frozen)` |
| `redirect: "manual"` + 3xx surfaced | `fetch-wrapper.ts` dispatch sets `redirect: "manual"`; status 300–399 throws | `3xx on credentialed request → error, fetchImpl called with redirect:manual`; happy path asserts `redirect === "manual"` |
| Placeholder sentinel stripped | `PLACEHOLDER_API_KEY = "multi-auth-placeholder"`; `sanitizeHeaders` deletes x-api-key / Authorization and any header containing sentinel | `sentinel placeholder never present in outgoing headers`; `returns placeholder apiKey and callable fetch`; `non-allowlisted origin receives NO Authorization and no x-api-key` |

### F2 — Body replay buffering

| Claim | Code | Tests |
| --- | --- | --- |
| Buffer ≤ `maxReplayBodyBytes` (default 10 MiB) | `config.ts` → `DEFAULT_MAX_REPLAY_BODY_BYTES = 10_485_760`; `fetch-wrapper.ts` → `prepareRequestBody` / `bufferBodyInit` | Config defaults; `body > maxReplayBodyBytes → exactly one attempt, exhaustion still recorded` |
| Byte-identical replay | Body cloned via `bodyPrep.bytes.slice()` per attempt | `F2 body replay` → `fallback replays byte-identical body`; e2e → `6. byte-identical replay: POST body identical on A and B attempts` |
| Oversized / non-replayable → single attempt; exhaustion still recorded | `singleAttempt` + `singleAttemptReason`; failover skipped but `markExhausted` still runs | `body > maxReplayBodyBytes → exactly one attempt, exhaustion still recorded`; `non-replayable stream body → single attempt` |

### F3 — Explicit 0600 / token-free lock

| Claim | Code | Tests |
| --- | --- | --- |
| Temp / backup / store 0600 umask-independent | `writeFileAtomic` open mode `FILE_MODE`; `chmod` after rename; `recoverCorrupt` backups | `temp/backup/store files are 0600 under permissive umask`; `simulated-crash temp residue is 0600`; `garbage JSON → backup created (0600) + fresh empty store` |
| Lock file token-free | `lockPayload()` = `{pid, hostname, timestamp}` only | `lock-file content never matches token patterns` |

### F4 — invalid_grant vs ambiguous failures

| Claim | Code | Tests |
| --- | --- | --- |
| Only explicit `invalid_grant` → `needs_reauth` | `adapters/anthropic.ts` → `parseTokenResponse` (`errorCode === "invalid_grant"`); `refresh.ts` stops immediately on `needs_reauth` | Adapter: `invalid_grant → needs_reauth`; refresh: `explicit invalid_grant stops immediately` |
| Ambiguous (network / timeout / 5xx / unknown) → ≤2 retries then transient | `refreshAccount` maxRetries default 2 (3 total attempts); adapter maps 5xx/timeout/network → `transient` | `network/transient retried max 2 times (3 total) then transient`; `timeout-shaped transient then success on retry`; `5xx-shaped and unknown error codes are transient (not needs_reauth)`; `state remains recoverable after transient (caller can retry later)`; adapter `5xx → transient` |
| Transient refresh → short cooldown (not permanent reauth) | `fetch-wrapper.ts` → `markTransientRefreshCooldown` (30s) | Covered via refresh orchestration + fetch refresh path; permanent reauth only on `needs_reauth` |

### F5 — PKCE / loopback / manual code

| Claim | Code | Tests |
| --- | --- | --- |
| S256 only | `buildAuthorizeUrl` sets `code_challenge_method=S256`; `s256Challenge` = SHA-256 base64url | `challenge method is S256 (sha256 base64url)`; `buildAuthorizeUrl sets code_challenge_method=S256 only`; authorize integration challenge assertion |
| ≥256-bit CSPRNG verifier | `generateCodeVerifier()` = `randomBytes(32)` base64url | `verifier has ≥256 bits entropy (32 bytes base64url)` |
| Single-use constant-time state | `constantTimeEqual` + `stateConsumed` in loopback | `constantTimeEqual rejects mismatches and accepts equals`; `accepts exact redirect and single-use state; rejects mismatch/reuse/wrong path`; `mismatched state on loopback → failed authorize` |
| `127.0.0.1` exact-match redirect | `server.listen(0, "127.0.0.1")`; origin/path exact match | Loopback tests above; `wrong port is not our listener (exact-match host:port)` |
| Manual code validated + never logged | `isValidAuthCodeFormat` / `AUTH_CODE_RE`; no log of code | `rejects wrong-format codes`; `authorize rejects invalid manual code without logging it`; `authorize → success tokens; code never logged; challenge is S256` |

### F6 — ToS-risk disclosure

See **§4** (required prominent wording). Evidence that anti-abuse controls exist in code:

- `DEFAULT_STICKY_WITHIN_SESSION = true` (`config.ts`)
- Selector honors sticky affinity (`selector.ts` / session stickiness tests)
- Exhaustion → `cooling_down` + `resetAt` from provider headers (`detect.ts` + fetch-wrapper `markExhausted`)
- No account pooling/sharing APIs — only user-labeled accounts in local store

---

## 4. F6 ToS-risk disclosure (REQUIRED)

> **WARNING — Terms of Service / account risk**
>
> **Automated multi-account rotation may violate Anthropic’s (or any provider’s) Terms of Service and can result in account suspension, rate-limit escalation, or permanent ban.**
>
> By enabling and using this plugin, **you knowingly accept that risk**. This software does not indemnify you against provider enforcement actions.
>
> **What this plugin does and does not do:**
>
> - It schedules **only accounts you yourself authorize and store locally** — there is **no** multi-user pooling, credential sharing, or marketplace of tokens.
> - It **honors provider reset windows** by marking exhausted accounts `cooling_down` until the provider-indicated (or default) reset time before selecting them again.
> - **`stickyWithinSession` defaults to `true` and is an anti-abuse control**: it keeps a session on the same account when possible, **minimizing rotation churn and cross-account alternation**. That is not merely a prompt-cache optimization; it is intentional friction against aggressive multi-account cycling.
>
> If you are unsure whether multi-account failover is permitted for your accounts, **do not enable this plugin** and consult the provider’s current Terms and usage policies.

---

## 5. Redaction evidence (suite-wide token-grep)

The suite asserts that secrets never appear in captured logs/notify output:

| Location | Test title | What is grepped |
| --- | --- | --- |
| `fetch-wrapper.test.ts` | `strips Bearer tokens and placeholder` | Bearer / placeholder → `[REDACTED]` |
| `fetch-wrapper.test.ts` | `logger output never contains access/refresh token substrings` | Suite access/refresh secrets + placeholder |
| `fetch-wrapper.test.ts` | `allLogLines contain no known secret substrings from this suite` | Full suite secret list (access/refresh/rotated tokens) |
| `fetch-wrapper.test.ts` | `all exhausted → 429 surfaced + notify with earliest reset, no tokens` | Notify must not contain Bearer/access material |
| `plugin-entry.test.ts` | `log mode writes redacted label-only lines; no token material` | Toast/log path with injected secret-like strings |
| `plugin-entry.test.ts` | `redact helper strips secrets` | Bearer + placeholder |
| `plugin-entry.test.ts` | `two authorize() runs create two labeled accounts; each callback returns success` | Logs must not contain `access-tok-` / `refresh-tok-` |
| `anthropic-adapter.test.ts` | `authorize rejects invalid manual code without logging it` | Bad paste string absent from console capture |
| `anthropic-adapter.test.ts` | `authorize → success tokens; code never logged; challenge is S256` | Auth code absent from logs |
| `store.test.ts` | `lock-file content never matches token patterns` | Lock JSON free of access/refresh/token patterns |
| `e2e.test.ts` | `5. all exhausted: both 429 → surface 429; both cooling_down; notify earliest reset` | Notify free of raw tokens / `Bearer ` |

---

## 6. Residual risks / open items

| Item | Severity | Notes |
| --- | --- | --- |
| **Second copy of tokens on disk (auth.json)** | Medium | Authorize callback returns real `access`/`refresh`/`expires` for opencode’s single-slot auth.json (last login wins). Plugin store is source of truth for multiplexing, but host auth.json still holds a copy of the most recently authorized account’s tokens. Permissions of auth.json are owned by opencode core, not this plugin. |
| **Symlink / TOCTOU on store path** | Low–Medium | `assertSecureFile` uses `fs.stat` (follows symlinks); no `lstat`, no owner-UID check, no directory sticky verification. A local attacker who can plant a symlink before open could redirect reads/writes if they also control the target path. Atomic write uses `O_EXCL` temp in the same directory, which mitigates some races but not symlink-to-attacker-file on the final path. |
| **macOS advisory lock semantics** | Low | Lock is `O_EXCL` file-based, not `flock`/`fcntl`. Works cross-process on local FS; behavior on network FS / iCloud-synced home dirs is weaker. Stale reclaim uses PID liveness only on same hostname. |
| **Q4 mid-stream behavior** | Low | Classification reads a **clone** of the body only for non-2xx responses (`responseToLike`). A 2xx that later fails mid-stream (SSE) is not reclassified for failover — by design for streaming. Documented product limitation, not a token-leak issue. |
| **In-process refresh mutex only** | Low | Cross-process refresh single-flight relies on store lock during `persist`, not a shared refresh mutex. Two processes could both hit the token endpoint; write-then-use + store lock reduce rotation loss risk but do not eliminate duplicate refresh calls. |
| **Manual smoke test with real accounts** | Process | Automated suite uses fakes/fixtures. **User-gated** live smoke (real Claude OAuth accounts, real 429 failover) has **not** been executed as part of this packaging. Required before production confidence. |
| **Duplicate auth plugin conflict** | Low | Entry logs that last plugin registering `anthropic` auth wins (undefined if another auth plugin also targets anthropic). Not detectable at Plugin API 1.17.x. |
| **Corrupt store → empty reset** | Operational | Corrupt JSON/schema triggers backup + empty store — user loses account list until re-auth (tokens may still exist in `.bak-*` at 0600). |

---

## 7. Re-review request (Warp)

| Field | Status |
| --- | --- |
| Package | multi-auth security review package (`SECURITY.md`) |
| Findings F1–F6 | **Closure evidence compiled** (code pointers + exact test titles above) |
| S1–S8 | **Mitigations documented** with test evidence |
| F6 ToS disclosure | **Present and prominent** (§4) |
| Automated suite | Implementation claims grounded in existing `__tests__` (do not invent coverage) |
| Live account smoke | **Not yet executed** (user-gated residual) |
| Default-on rollout | **Blocked pending Warp re-review sign-off** |

**Request:** Warp security re-review is requested before enabling multi-auth by default.

**Verdict (terminal review phase — placeholder):**

```
Warp re-review verdict: _______________  (approve / approve-with-conditions / reject)
Reviewer: _______________
Date: _______________
Conditions / notes: _______________
```

---

## Appendix — Primary source map

| Module | Path |
| --- | --- |
| Plugin entry | `.opencode/plugins/multi-auth.ts` |
| Store | `.opencode/plugins/multi-auth/store.ts` |
| Fetch wrapper | `.opencode/plugins/multi-auth/fetch-wrapper.ts` |
| Refresh | `.opencode/plugins/multi-auth/refresh.ts` |
| Anthropic adapter | `.opencode/plugins/multi-auth/adapters/anthropic.ts` |
| Config | `.opencode/plugins/multi-auth/config.ts` |
| Status / toast | `.opencode/plugins/multi-auth/status.ts` |
| Selector | `.opencode/plugins/multi-auth/selector.ts` |
| Detect / classify | `.opencode/plugins/multi-auth/detect.ts` |
| Tests | `.opencode/plugins/multi-auth/__tests__/*.test.ts` |

# multi-auth

Multi-account OAuth fallback for [opencode](https://opencode.ai) providers.

**v1 scope:** Anthropic Claude Pro/Max only. Additional providers can plug in later via the adapter interface.

| | |
| --- | --- |
| **Plugin entry** | `.opencode/plugins/multi-auth.ts` |
| **Implementation** | `.opencode/plugins/multi-auth/` |
| **opencode runtime** | **1.17.17** (pinned; verify with `opencode --version`) |
| **Store** | `~/.local/share/opencode/multi-auth/<provider>.json` (mode `0600`) |
| **Security deep-dive** | [SECURITY.md](./SECURITY.md) |

---

## What it is

`multi-auth` registers **multiple OAuth accounts** behind a single opencode provider and multiplexes them on every request:

1. **Priority-ordered selection** — lower `priority` number wins.
2. **Automatic fallback** — on quota / rate-limit exhaustion (`429` classified as `quota` or `rate_limit`), the active account is marked `cooling_down` with a `resetAt`, and the next available account serves the request (body replay when possible).
3. **Lazy failback** — when `now >= resetAt`, a cooling account is treated as available again at selection time (no background timer).
4. **Session stickiness** — once an account successfully serves a request, subsequent requests in the same process prefer that account (see anti-abuse note below).

Default state (no config / no enabled provider) is **fully inert**: no auth hook, no store directory, no network behavior.

---

## ⚠ Terms of Service risk (F6)

> **Automated multi-account rotation may violate your provider’s Terms of Service.**
>
> Using this plugin to rotate across accounts when one hits a usage or rate limit can be construed as limit evasion. **Account suspension or permanent ban is a real risk.** By enabling this plugin you knowingly accept that risk.

### What this plugin does *not* do

- It schedules **only accounts you own and connect yourself**.
- There is **no credential pooling**, no shared account marketplace, and no third-party token exchange.
- Priorities and cooldowns honor provider reset windows when the API supplies them; otherwise a configured default cooldown applies.

### `stickyWithinSession` is an anti-abuse control

`stickyWithinSession` (default **`true`**) is documented first as an **anti-abuse control**, not merely a prompt-cache optimization:

| Role | Why it matters |
| --- | --- |
| **Anti-abuse** | Minimizes rotation churn and cross-account alternation. Without stickiness, every request could bounce between accounts and look like aggressive limit-hopping. |
| **Prompt-cache** | Secondary benefit: staying on one account preserves provider-side prompt caches (cost/latency). |

It defaults to `true` so the safe posture is the default. Set it to `false` only if you understand the ToS and cache implications.

---

## Setup from scratch

### 1. Prerequisites

- opencode **1.17.17** (`opencode --version`)
- Plugin files present:
  - `.opencode/plugins/multi-auth.ts` (entry; auto-discovered from `.opencode/plugins/`)
  - `.opencode/plugins/multi-auth/` (implementation modules)
- At least two Anthropic Claude Pro/Max accounts you are allowed to use

### 2. Enable the plugin in opencode config

The plugin is **inert** until it receives options with at least one **enabled** v1 provider (`anthropic`). Options are the object that `parseConfig` expects after extraction:

```jsonc
{
  "providers": {
    "anthropic": {
      "enabled": true,
      "accounts": [
        { "label": "work-max", "priority": 1 },
        { "label": "personal-pro", "priority": 2 }
      ]
    }
  }
}
```

How that object reaches the plugin (all supported by `extractMultiAuthRaw` in `multi-auth.ts`):

**A. Plugin array tuple (options at load — recommended for activation)**

```jsonc
{
  "plugin": [
    // ...other plugins...
    [
      // path or package id must include "multi-auth"
      "file:///absolute/path/to/.opencode/plugins/multi-auth.ts",
      {
        "providers": {
          "anthropic": {
            "enabled": true,
            "accounts": [
              { "label": "work-max", "priority": 1 },
              { "label": "personal-pro", "priority": 2 }
            ],
            // optional overrides — defaults shown in Config reference
            "defaultCooldownSeconds": 300,
            "maxCooldownSeconds": 18000,
            "refreshSkewSeconds": 120,
            "stickyWithinSession": true,
            "failover": {
              "maxAttemptsPerRequest": 3,
              "retryOn": ["quota", "rate_limit"],
              "maxReplayBodyBytes": 10485760,
              "notify": "toast"
            }
          }
        }
      }
    ]
  ]
}
```

**B. Object-style plugin map (plan shape)**

```jsonc
{
  "plugin": {
    "multi-auth": {
      "providers": {
        "anthropic": {
          "enabled": true,
          "accounts": [
            { "label": "work-max", "priority": 1 },
            { "label": "personal-pro", "priority": 2 }
          ]
        }
      }
    }
  }
}
```

**C. Top-level key** (also accepted when present on the live config object):

```jsonc
{
  "multi-auth": {
    "providers": {
      "anthropic": { "enabled": true, "accounts": [/* ... */] }
    }
  }
}
```

> **Activation rule:** at plugin load, `MultiAuthPlugin` only registers the auth hook if `providers.anthropic.enabled === true`. With no options / empty providers / `enabled: false`, hooks are empty (dark-launch / rollback). Prefer the **array tuple** form so options are available at load time. Live config updates (priorities, failover policy) are re-read via the `config` hook once the plugin is active.

Notes:

- Config holds **priorities and policy only** — never tokens.
- Account `label` values must match the labels you choose at login.
- Store accounts missing from config still work at priority `100 + insertionIndex`.
- Duplicate priorities are allowed (selector tie-breaks by least-recently-exhausted, then `addedAt`, then label).

### 3. Add accounts (OAuth)

Repeat once per account:

1. Run `opencode auth login` or the TUI **`/connect`** command.
2. Choose provider **Anthropic**.
3. Pick the method labeled **`Multi-account (add account)`**.
4. When prompted:
   - **Account label** — e.g. `work-max` (must match config if you set priorities there)
   - **Priority** — non-negative integer; lower = higher priority (optional; can also live only in config)
5. Complete Claude OAuth in the browser (or paste the code if using the manual flow).

Tokens are written to the **plugin store**, not as the long-term multi-account source of truth in opencode’s single `auth.json` slot (that slot still receives a success payload for “connected” UX; real multi-account tokens live only in the store).

### 4. Where tokens are stored

| Path | Mode | Contents |
| --- | --- | --- |
| `~/.local/share/opencode/multi-auth/` | `0700` | Base directory |
| `~/.local/share/opencode/multi-auth/anthropic.json` | `0600` | Versioned JSON: labels → OAuth tokens + state |

- Plugin-owned; atomic writes; advisory lock file (lock has **no** token material).
- **Never** `cat` or paste the store into chat/logs — it contains refresh tokens.
- Safe to delete the store file at any time; re-run `/connect` to re-add accounts.

Verify mode without dumping secrets:

```bash
ls -l ~/.local/share/opencode/multi-auth/anthropic.json
# expect: -rw------- (0600)
```

---

## Config reference

Root shape after extraction: `{ "providers": { "<id>": ProviderConfig } }`.

### Provider keys (`providers.anthropic`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` when the provider object is present | Master switch. `false` → plugin stays inert (no auth hook). |
| `accounts` | `AccountConfig[]` | `[]` | Priority/disabled metadata by label. |
| `defaultCooldownSeconds` | `integer ≥ 0` | **`300`** | Cooldown when the provider gives no reset hint. |
| `maxCooldownSeconds` | `integer ≥ 0` | **`18000`** | Cap on cooldown (5h). |
| `refreshSkewSeconds` | `integer ≥ 0` | **`120`** | Refresh access tokens this many seconds before expiry. |
| `stickyWithinSession` | `boolean` | **`true`** | Prefer the account already serving this process (anti-abuse + cache). |
| `failover` | object | see below | Per-request failover policy. |

### Account keys (`accounts[]`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | non-empty `string` | *(required)* | Must match the label chosen at `/connect`. |
| `priority` | integer | *(required)* | Lower number = higher priority. |
| `disabled` | `boolean` | `false` | Config-level disable (never selected). |

### Failover keys (`failover`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `maxAttemptsPerRequest` | `integer ≥ 1` | **`3`** | Max distinct account attempts per request. |
| `retryOn` | `("quota" \| "rate_limit")[]` | **`["quota", "rate_limit"]`** | Exhaustion reasons that trigger failover. |
| `maxReplayBodyBytes` | `integer ≥ 0` | **`10485760`** (10 MiB) | Bodies larger than this are single-attempt (no fallback replay). |
| `notify` | `"toast" \| "log" \| "silent"` | **`"toast"`** | How to surface exhaustion / reauth events. |

### Not configurable (F1)

Origin allowlist and redirect policy are **hardcoded** in the Anthropic adapter / fetch wrapper. These keys are **stripped and ignored** (with a console warning):

`allowedOrigins`, `apiOrigins`, `followRedirects`, `redirect`, `redirectPolicy`, `originAllowlist`, `allowOrigins`, `allowed_origins`, `api_origins`, `follow_redirects`

Credentialed requests always use `redirect: "manual"`; a `3xx` from the API is surfaced as an error, never followed.

---

## How fallback works

### Per-request lifecycle

```
opencode → provider SDK → wrappedFetch(request)
  1. Origin allowlist check (non-API origins: strip credentials, no failover)
  2. Buffer body for replay (if ≤ maxReplayBodyBytes; else single-attempt)
  3. select() best account (priority + sticky + not cooling/disabled/needs_reauth)
  4. Refresh access token if expires < now + refreshSkewSeconds
  5. Inject Authorization: Bearer <access> (allowlisted origins only)
  6. Dispatch with redirect: "manual"
  7. Success (2xx) → touch lastUsed, set session affinity, return
  8. Exhausted (quota/rate_limit) → mark cooling_down + resetAt, notify, try next account
  9. All exhausted → return last 429 / synthetic error + toast
```

### Account states

| State | Meaning | Selected? |
| --- | --- | --- |
| `available` | Healthy | Yes |
| `cooling_down` | Quota/rate-limit (or short transient refresh cooldown); has `resetAt` | Only when `now ≥ resetAt` (lazy failback) |
| `needs_reauth` | Refresh returned explicit invalid grant | No — re-run `/connect` for that label |
| `disabled` | User/config disabled | No |

### Notifications (`failover.notify`)

With default `"toast"`, the TUI shows messages such as (labels only; tokens redacted):

- `account <label> exhausted (quota|rate_limit); reset at <iso>`
- `all N accounts exhausted, earliest reset at <iso>`
- `account <label> needs re-authentication`
- `account added: <label>` (after successful connect)

Modes: `toast` (prefer TUI, fall back to log) · `log` · `silent`.

---

## Security model

Short summary — full threat model, F1–F6 closure, and test pointers: **[SECURITY.md](./SECURITY.md)**.

| Control | Behavior |
| --- | --- |
| Store permissions | File `0600`, directory `0700`; refuse group/world-readable stores |
| Redaction | Logs/toasts strip Bearer tokens, JWT-ish strings, secret prefixes; prefer **labels only** |
| Origin allowlist | Frozen `https://api.anthropic.com` — not config-extensible |
| No redirect follow | Credentialed requests use `redirect: "manual"` |
| Refresh rotation | Persist rotated refresh before use; per-account locking |
| Placeholder apiKey | Loader returns inert `multi-auth-placeholder`; never sent as a real credential |

---

## Limitations

| Limitation | Detail |
| --- | --- |
| **Prompt-cache stickiness** | Alternating accounts breaks provider-side prompt caches (cost/latency). Mitigated by `stickyWithinSession: true` (default). |
| **Single-provider v1** | Only Anthropic is wired (`V1_PROVIDERS`). Adapter interface exists for future providers. |
| **Mid-stream no-retry** | Once a `2xx` response is returned (including streaming bodies), the wrapper does not retry mid-stream failures. Errors after the stream starts are surfaced to the consumer. |
| **Oversized / non-replayable body** | Bodies `> maxReplayBodyBytes` or non-bufferable streams are **single-attempt**: exhaustion is still recorded, but no failover replay. Log line: `single-attempt request: body_exceeds_max_replay \| non_replayable_stream (no failover replay)`. |
| **Model/tier availability** | Per-account model or subscription tier is **not** modeled; selection is label/priority/state only. |
| **Other auth plugins** | If another plugin also registers `auth` for `anthropic`, last hook wins — **undefined behavior**. multi-auth logs an advisory when it registers. |

---

## Manual smoke test with real accounts

Gated checklist (Task 10). Execute only with accounts you own. **Do not print tokens to the terminal.**

### Checklist

- [ ] **Register two real Anthropic accounts** via `/connect` → method **Multi-account (add account)**  
  - Account A: label e.g. `work-max`, priority **1**  
  - Account B: label e.g. `personal-pro`, priority **2**  
  - Ensure config `accounts` labels match (or rely on store-only priorities).

- [ ] **Verify store file** exists with both labels and mode `0600`  
  ```bash
  ls -l ~/.local/share/opencode/multi-auth/anthropic.json
  # expect -rw------- and two labels under .accounts
  # Inspect labels only, e.g. with a JSON tool that prints keys — never dump access/refresh:
  #   jq 'keys, (.accounts | keys)' ~/.local/share/opencode/multi-auth/anthropic.json
  ```

- [ ] **Normal session** — start a chat; confirm requests are served by priority **1**  
  - Look for structured logs / debug lines containing the priority-1 **label** (e.g. `account work-max served request successfully`).  
  - Do not enable verbose logging that might echo headers.

- [ ] **Force fallback** (pick one):  
  - **A. Edit store** (careful — keep tokens intact; only change state fields for account 1):  
    Set account 1 to cooling with a future `resetAt` (epoch **milliseconds**):  
    ```jsonc
    // under accounts["work-max"] (example label):
    "state": "cooling_down",
    "resetAt": 9999999999999
    ```  
    Save the file; keep mode `0600`.  
  - **B. Wait for a real quota/rate-limit trip** on account 1.

- [ ] **Confirm fallback to account 2**  
  - Session continues successfully.  
  - Toast/log fires for exhaustion of account 1, e.g.  
    `account work-max exhausted (quota); reset at …`  
    (and subsequent success on the priority-2 label).

- [ ] **Restore account 1 / failback**  
  - Set account 1 back to available, e.g. `"state": "available", "resetAt": null`  
    (or set `resetAt` to a past epoch ms).  
  - On the **next** request (new process affinity may still stick to account 2 until restart if sticky; for a clean failback test, restart opencode **or** cool down account 2 briefly).  
  - Confirm priority-1 is eligible again when it is the best candidate.

- [ ] **Record results** in the table below.

### Smoke test record

| Date | opencode version | Result | Notes |
| --- | --- | --- | --- |
| — | — | **pending — not yet executed (requires real accounts)** | |

---

## Rollout / rollback

| Phase | Action |
| --- | --- |
| **Dark launch** | Plugin present; `enabled: false` (or no options) → fully inert; stock auth unchanged. |
| **Opt-in multi-account** | Set `enabled: true`, add ≥2 accounts via `/connect`, run daily-driver. |
| **Default-on** | Only after security review ([SECURITY.md](./SECURITY.md)) and recorded smoke test. |

### Rollback

1. Set `providers.anthropic.enabled` to **`false`** (or remove multi-auth options) → auth hook not registered → opencode falls back to stock single-account auth in `auth.json`.
2. Optionally delete the store:  
   `rm ~/.local/share/opencode/multi-auth/anthropic.json`  
   Re-run `/connect` later if needed.

---

## Development

```bash
# from the opencode config tree that owns .opencode/plugins/multi-auth
bun test .opencode/plugins/multi-auth
```

Unit + integration coverage lives under `__tests__/` (selector, config, store, detect, refresh, fetch-wrapper, adapter, plugin entry, e2e).

---

## Related

- [SECURITY.md](./SECURITY.md) — threat model, F1–F6, ToS disclosure, test evidence
- Plan: `.weave/plans/multi-account-oauth-fallback.md`

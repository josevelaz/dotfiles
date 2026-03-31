# GitHub Copilot Multi-Account Rotation Plugin Design

## Goal

Add an OpenCode plugin that extends the existing `github-copilot` provider with multi-account authentication, sticky account selection, automatic rotation on rate limits, and in-place token refresh, while preserving normal `github-copilot/*` model names.

## Desired User Experience

- Users continue selecting models with existing `github-copilot/*` identifiers.
- `/connect` can be used multiple times to add more than one Copilot account.
- The plugin keeps using the current healthy account until a real account-level failure happens.
- When a request is rate limited, the plugin cools down that account and retries with another authenticated account.
- If a token expires, the plugin refreshes it before falling back to another account.
- Users can inspect and manage the account pool without editing files by hand.

## Recommended Approach

Implement a transparent auth override for the existing `github-copilot` provider instead of creating a new provider alias or a standalone local proxy.

This approach keeps the operator experience unchanged, matches proven OpenCode auth plugin patterns, and centralizes request routing inside the provider auth loader. It also avoids forcing users to adopt new provider names or maintain a separate background process.

## Platform Capability Gate

Before implementation begins, verify that the OpenCode auth extension point can do all of the following inside the `github-copilot` override path:

- inspect upstream response status and body,
- retry a safely replayable request before control returns to the caller,
- persist refreshed auth state during request handling, and
- override request transport details on a per-call basis.

If any of these capabilities are missing, v1 stops and does not implement a proxy fallback. In that case the project returns to design with a proxy as a separate future option, rather than carrying two architectures in the same release.

## Non-Goals

- Distributed state shared across multiple machines.
- Advanced load balancing beyond sticky selection plus deterministic failover.
- Any attempt to bypass true global or organization-wide Copilot restrictions.
- Project-local storage of refresh tokens or other account secrets.

## Plugin Shape

The plugin should export an auth extension for `github-copilot` and a small set of management tools.

Core capabilities:

1. Register one or more additional auth methods for `github-copilot`.
2. Maintain a plugin-owned account registry in user-scoped state.
3. Provide a request-time `loader()` that selects the active account and returns provider config overrides.
4. Wrap upstream requests with response classification, refresh logic, cooldown handling, and rotation.
5. Expose management tools for inspection and recovery.

## Architecture

### 1. Auth Extension Layer

The plugin attaches to the existing `github-copilot` provider rather than introducing a new provider name. The auth extension is responsible for:

- adding a multi-account-compatible auth method,
- accepting repeated account additions,
- normalizing account identity metadata,
- persisting refreshed credentials, and
- providing the runtime loader used by OpenCode for outgoing provider requests.

### 2. Account Registry

The plugin owns a user-scoped registry containing one record per authenticated Copilot account.

Each account record should include:

- stable account id,
- human-readable label such as email or login,
- deterministic identity key used for dedupe,
- access token,
- refresh token,
- expiry timestamp,
- status (`active`, `cooldown`, `reauth_required`, `disabled`),
- last-used timestamp,
- last-switch reason,
- cooldown-until timestamp,
- lightweight recent failure metadata,
- optional per-model-family rate-limit metadata, and
- schema version for future migrations.

The canonical identity key must come from an immutable provider identifier such as GitHub user id or token subject claim, combined with issuer or host when necessary. Email and login remain display labels only and must never be used as the dedupe key.

This registry is separate from repository config and should live in user state.

Repeated `/connect` calls should deduplicate by identity key. If the identity already exists, the plugin updates that account in place rather than creating a duplicate record.

### 3. Account Selector

Selection should use sticky round-robin behavior:

- keep using the current healthy account,
- rotate only when the current account becomes temporarily or permanently unsuitable,
- choose the next eligible account deterministically, and
- skip disabled, expired-without-refresh, or cooling-down accounts.

This avoids unnecessary churn while still allowing fast failover.

### 4. Request Wrapper

Every Copilot request should pass through a wrapper that:

1. loads the account pool,
2. chooses an eligible account,
3. refreshes the token if needed,
4. injects auth headers and any provider-specific request overrides,
5. forwards the upstream request,
6. classifies the response, and
7. updates account state atomically.

The wrapper must preserve the original request semantics unless the account itself needs to change.

## Concurrency Model

The plugin must behave predictably under concurrent requests and manual management actions.

- use per-account singleflight protection so only one refresh happens for a given account at a time,
- serialize registry mutations so concurrent writes cannot clobber tokens or cooldown metadata,
- use file locking or compare-and-swap semantics to protect same-user multi-process access on one machine,
- treat `remove_account`, `disable_account`, and `set_active_account` as state transitions that may race with in-flight requests,
- allow in-flight requests to finish with their already-selected account, but prevent newly scheduled requests from choosing an account that was just disabled or removed.

### Cross-Process Refresh Protocol

- before refreshing, a process acquires a per-account lease stored in local state with owner id and expiry,
- refresh writes use credential-version compare-and-swap so a stale process cannot overwrite a newer token set,
- if lease acquisition fails, the second process reloads state and waits only for a short bounded interval of up to 2 seconds total before rechecking,
- after the bounded wait, the process must either use the newer credential version now visible in state, retry lease acquisition if the prior lease expired, or fail the current request fast,
- expired leases are treated as stale and may be reclaimed safely,
- old secret versions are garbage-collected only after the winning process confirms the new registry pointer is durable.

## Persistence and Storage

Store the registry under a platform-native user-scoped plugin state path, for example:

`~/.local/share/opencode/plugins/github-copilot-multi-account/accounts.json`

V1 requires OS credential store support for access tokens and refresh tokens. The JSON registry keeps account metadata plus secret references only. Environments without supported keychain access are out of scope for multi-account mode and should fail with a clear setup error instead of silently falling back to weaker storage. Temporary keychain lock or unavailability should be surfaced distinctly from corrupted or missing credentials.

Storage requirements:

- strict file permissions,
- atomic writes,
- schema validation on load,
- migration support via a version field,
- no project-local copies,
- no secrets in logs.

If persistence fails, the plugin should surface a clear error rather than continuing with ambiguous state.

### Persistence Consistency Contract

Registry metadata and keychain secrets must be kept consistent across crashes and partial failures.

- each account stores a `secret_ref` and credential version in the registry,
- credential upsert writes the new secret first, then atomically updates the registry to point at the new secret version,
- old secrets are deleted only after the registry update succeeds,
- startup reconciliation removes orphaned secrets and marks registry entries with missing secrets as recoverable errors,
- refresh, remove, disable, and migration flows must be idempotent.

## Management Surface

The plugin should expose lightweight tools or commands for:

- `list_accounts` - show configured accounts and current status,
- `show_pool_status` - show active account, cooldown windows, and recent switch reasons,
- `set_active_account` - set a preferred healthy account that remains sticky until it fails, cools down, is disabled, or is manually changed,
- `remove_account` - tombstone an account immediately for new requests, then delete its secrets only after no in-flight lease still references it,
- `disable_account` / `enable_account` - allow safe quarantine without deletion.

These tools keep the normal runtime automatic while making recovery and debugging practical.

## Request Lifecycle

### Happy Path

1. OpenCode resolves a `github-copilot/*` request.
2. The plugin loader selects the current healthy account.
3. If the token is near expiry, the plugin refreshes it before sending the request.
4. The request is forwarded with the chosen account's credentials.
5. A successful response updates `last_used_at` and clears transient failure metadata.
6. If `set_active_account` was used, that preference stays in effect until the selected account becomes ineligible.

### Rate Limit Path

#### Account-Scoped `429`

1. Upstream returns `429` with signals that prove the throttle is account-scoped.
2. The plugin marks the current account as cooling down.
3. The cooldown window is recorded, optionally scoped by model family.
4. The same request is retried against the next eligible account.
5. If no eligible account remains, the plugin returns a pool-exhausted error with earliest retry timing.

#### Shared or Ambiguous `429`

1. Upstream returns `429` without proof that the throttle is account-scoped.
2. The plugin does not rotate to another account.
3. The plugin does not mark unrelated accounts as cooling down.
4. The plugin returns a fail-fast error with earliest retry timing and may persist a short-lived backoff hint with explicit scope and hard TTL.

### Expired Token Path

1. Upstream indicates token expiry or auth failure.
2. The plugin attempts refresh for the same account.
3. If refresh succeeds, the request is retried once on that account.
4. If refresh fails, the account is marked `reauth_required` and the request moves to the next healthy account.

## Retry Safety Contract

Cross-account retries are allowed only when the original request is still safely replayable.

- retry before the first response byte is returned to the caller,
- do not replay after a streaming response has started,
- bound total attempts per request across all accounts,
- do not retry request bodies that cannot be replayed safely,
- preserve the original request payload exactly when a replay is allowed.

### Retry Budget

- at most one same-account retry for refresh or transient transport failure,
- at most one cross-account attempt per eligible account,
- hard cap of five total upstream attempts per request even if more accounts exist,
- when all remaining accounts are cooling down, mark cooldown state and fail the current request fast with earliest retry time instead of sleeping inline for long windows.

## Failure Classification

Use explicit response classification rather than scattered conditional retries.

Possible classifications:

- `success` - request succeeded,
- `refresh_and_retry` - token is expired or revoked in a way refresh can fix,
- `rotate_account` - account-specific failure such as rate limiting,
- `retry_same_account` - short-lived transport or upstream instability,
- `fail_with_retry_time` - no eligible safe retry path exists and the caller should retry later,
- `fail_request` - the request itself is invalid or unsupported,
- `fail_without_rotation` - the account is authenticated but blocked by org, entitlement, or model-access policy.

### Handling Rules

- `401`: refresh first when the response shape indicates expiry or revocation; if refresh fails, mark `reauth_required` and rotate.
- `403`: do not refresh or rotate by default; only rotate when provider-specific response details show the problem is account-specific and not an org or entitlement restriction.
- `429`: rotate only when provider-specific details prove the throttle is account-scoped; otherwise treat it as shared or ambiguous throttling and do not rotate.
- `5xx` / network failure: retry once on same account, then rotate on repeat if the request is still replayable.
- non-retryable `4xx`: surface immediately without rotation.
- exhausted pool: fail with a clear, inspectable error instead of looping forever.

The classifier must rely on Copilot-specific response body and header signals rather than status code alone. Unknown or ambiguous provider signals must fail closed: do not refresh or rotate unless classification is confident.

### Provider Signal Table

Before implementation is considered complete, capture and codify real Copilot fixtures for each bucket below.

| Condition | Required signal | Classification | Allowed action |
| --- | --- | --- | --- |
| Expired or revoked token | provider-specific auth-expiry body or header signal | `refresh_and_retry` | refresh once, then retry same account |
| Org or entitlement restriction | provider-specific policy or model-access denial signal | `fail_without_rotation` | fail immediately |
| Account rate limit | `429` plus optional rate-limit headers | `rotate_account` | apply cooldown, honor `Retry-After`, retry another account |
| Shared or ambiguous throttling | `429` without proof that throttle is account-scoped | `fail_with_retry_time` | do not rotate; fail fast with earliest retry time |
| Upstream transient failure | `5xx`, timeout, or connection reset before response start | `retry_same_account` | retry once, then rotate if still replayable |
| Invalid request | validation or unsupported-model signal | `fail_request` | fail immediately |

## Cooldown Strategy

Use deterministic cooldowns with bounded backoff.

- Base cooldown is assigned on first `429`.
- `Retry-After` takes precedence over locally computed backoff when present.
- Repeated rate limits on the same account can extend the cooldown.
- Cooldowns may optionally be tracked by model family if Copilot behavior differs by endpoint.
- If all accounts are cooling down, the plugin returns the soonest recovery time.

This should remain simple at first; sophisticated traffic-shaping is unnecessary for the initial version.

## Migration and Rollback

The plugin must define how it coexists with built-in `github-copilot` auth.

- on first run, detect whether a usable built-in Copilot auth record already exists,
- if it exists, offer an import path into the plugin-owned registry rather than silently ignoring it,
- if import is declined, the plugin should stay inactive for multi-account mode until the user explicitly imports or reauthenticates through the plugin flow,
- while import is declined, native built-in Copilot auth continues unchanged,
- after import, the plugin registry becomes the only source of truth for multi-account runtime selection and is not continuously synchronized back into built-in auth,
- built-in `github-copilot` auth remains a bootstrap snapshot only and may become stale after plugin-managed refreshes,
- if the plugin is disabled or removed, the only supported recovery path in v1 is to run native `/connect` again,
- the plugin must avoid creating split-brain auth state where built-in auth and plugin state diverge silently.

This ownership model is intentionally one-way: import from built-in auth is supported, but ongoing bidirectional sync is not.

## Replayability Matrix

V1 retries only request shapes that are proven safely replayable.

- eligible: JSON-based Copilot requests whose full body is buffered before send and whose response has not started,
- eligible for same-account retry: pre-response transport errors and refresh-driven retry on the same buffered request,
- eligible for cross-account rotation: pre-response `429` and other account-specific failures on buffered requests,
- not eligible: non-seekable request bodies, requests that have already emitted response bytes, and streaming sessions after the first byte,
- fallback for non-eligible requests: surface the current failure and rely on the next user-initiated request to select another healthy account.

Streaming or SSE requests may still use account selection before dispatch, but once the response begins, that request is pinned to its current account for the remainder of the stream.

## Safety and Observability

### Logging

Use `client.app.log` for structured operational logs.

Log:

- selected account label or redacted identifier,
- token refresh attempts,
- cooldown application,
- rotation events,
- pool exhaustion,
- manual tool actions.

Track counters or equivalent metrics for:

- refresh success and failure,
- rotation count,
- cooldown entries,
- shared or ambiguous `429` backoff hints applied,
- classifier buckets,
- pool exhaustion events.

Never log:

- access tokens,
- refresh tokens,
- raw authorization headers,
- full secrets,
- full unredacted account identifiers if they create unnecessary exposure.

### Safety Rails

- Never rotate on request-validation errors.
- Never silently swallow the final upstream failure.
- Never continue using an account that failed refresh and is known invalid.
- Allow manual disabling of a problematic account without removing historical context.

## Testing Strategy

Focus testing on decision logic and state transitions.

### Unit Tests

- account registry load/store and schema validation,
- sticky selector behavior,
- cooldown eligibility checks,
- response classification,
- token refresh state transitions,
- pool exhaustion reporting,
- persistence atomicity behavior,
- concurrent refresh singleflight behavior,
- corrupted registry handling,
- migration and rollback logic,
- missing keychain reference recovery logic.

### Integration Tests

- repeated `/connect` adds multiple accounts,
- `429` on active account rotates to next healthy account,
- ambiguous or shared `429` does not rotate across the pool,
- expired token refreshes and retries in place,
- failed refresh marks account `reauth_required` and rotates,
- all accounts exhausted returns actionable error details,
- management tools reflect live pool state correctly,
- `403` org or entitlement failures do not rotate to other accounts,
- `Retry-After` headers are honored,
- manual management actions behave correctly while requests are in flight,
- plugin capability gate hard-stops implementation when response-aware auth override is not available.

## Open Questions To Resolve During Implementation

- whether model-family-specific cooldowns are needed immediately or can remain a future enhancement.

## Required Pre-Implementation Validation Artifacts

- captured Copilot auth payload and refresh contract details for the plugin auth method,
- captured Copilot response fixtures for every classifier bucket in the provider signal table,
- proof that the auth override capability gate passes end-to-end in OpenCode.

## Implementation Outline

1. Create a dedicated plugin file for the GitHub Copilot multi-account auth extension.
2. Add typed account/state models plus schema validation.
3. Implement secure persistence helpers.
4. Implement selection, cooldown, and response classification helpers.
5. Prove the plugin API supports response-aware replay; if the capability gate fails, stop v1 and return to design.
6. Implement token refresh and request wrapper behavior in the auth loader.
7. Add management tools for pool inspection and account control.
8. Add automated tests for rotation, refresh, concurrency, migration, and pool exhaustion.

## Acceptance Criteria

- Users can authenticate multiple GitHub Copilot accounts without changing model names.
- The plugin preserves `github-copilot/*` provider usage from the caller's perspective.
- Rate-limited requests automatically move to another healthy account.
- Expired tokens refresh before unnecessary rotation.
- `403` responses caused by org, entitlement, or model-access restrictions do not rotate to other accounts.
- Invalid accounts are quarantined without blocking the whole pool.
- Operators can inspect and manage the pool through plugin-provided commands.
- State survives restarts without corrupting the registry or leaking secrets.
- Concurrent requests do not trigger duplicate refreshes or lose registry updates.
- Retries happen only while the request is safely replayable.
- Existing single-account `github-copilot` users can adopt the plugin without losing access or ending up with split auth state.
- Disabling the plugin leaves baseline `github-copilot` behavior recoverable through native `/connect`.
- Declining import when built-in auth exists leaves the plugin inactive for multi-account runtime until the user explicitly imports or reauthenticates through the plugin flow.
- While import is declined, baseline single-account `github-copilot` requests continue through native auth unchanged.
- Partial failure across registry and keychain storage is detected and repaired or surfaced clearly on startup.
- Environments without supported OS keychain access fail fast instead of storing long-lived secrets insecurely.
- Cross-process refreshes do not overwrite newer credentials or leak orphaned active secret versions.
- Streaming requests stay pinned to their selected account after the first response byte and are never replayed across accounts.
- Capability-gate behavior is binary: either response-aware auth override works and v1 proceeds, or implementation stops with no proxy fallback.
- Completion requires captured Copilot fixtures for every classifier bucket and the refresh contract used by the auth flow.
- Reconnecting the same immutable identity through repeated `/connect` updates the existing account record instead of creating duplicates.
- Tombstoned removed accounts are never selected for new requests, including after restart, and their secrets are deleted only after safe cleanup completes.
- Ambiguous or shared `429` responses do not trigger account rotation or pool-wide cooldown churn.
- Any ambiguous or shared-throttling backoff hint has a bounded TTL and defined scope.

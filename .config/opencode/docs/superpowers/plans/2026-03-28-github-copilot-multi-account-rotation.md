# GitHub Copilot Multi-Account Rotation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenCode plugin that transparently extends `github-copilot` auth with multiple accounts, sticky selection, safe rotation on account-scoped throttles, token refresh, and operator management tools.

**Architecture:** Implement a local plugin at `.opencode/plugins/github-copilot-multi-account.ts` and keep the logic split into focused helper modules under `.opencode/plugins/github-copilot-multi-account/`. The first milestone is the capability gate: prove the auth override can inspect responses, replay safe requests, persist refreshed state, and override transport per call. If that proof fails, stop implementation and return to design; do not add a proxy in this plan.

**Tech Stack:** TypeScript, Bun, `@opencode-ai/plugin`, `zod`, Node `fs/promises` + `path` + `os` + `crypto`, macOS `security` CLI for keychain access, colocated `bun test` suites.

**Implementation notes:** Repo instructions override the default planning skill here: do not use TDD, and do not create git commits unless the user explicitly asks. Implement in small vertical slices, then run focused verification after each slice.

---

## File Map

**Create**
- `.opencode/plugins/github-copilot-multi-account.ts` - plugin entrypoint exporting both named and default plugin exports.
- `.opencode/plugins/github-copilot-multi-account/capability-gate.json` - checked-in record of the validated auth override contract and the go/stop decision for this repo state.
- `.opencode/plugins/github-copilot-multi-account/capability-gate.probe.ts` - executable probe that validates the real auth override path before implementation continues.
- `.opencode/plugins/github-copilot-multi-account/types.ts` - shared runtime types for registry state, credentials, classifier results, and tool payloads.
- `.opencode/plugins/github-copilot-multi-account/schema.ts` - `zod` schemas for persisted registry state and tool arguments.
- `.opencode/plugins/github-copilot-multi-account/logger.ts` - `client.app.log` wrapper with redaction helpers.
- `.opencode/plugins/github-copilot-multi-account/logger.redaction.test.ts` - verifies tokens, secret refs, labels, and identity keys are redacted before logging.
- `.opencode/plugins/github-copilot-multi-account/storage.ts` - registry path resolution, revisioned mutation helper, atomic JSON persistence, reconciliation, tombstone handling.
- `.opencode/plugins/github-copilot-multi-account/keychain.ts` - secret storage adapter with macOS implementation and explicit unsupported/unavailable errors.
- `.opencode/plugins/github-copilot-multi-account/locks.ts` - per-account lease handling, owner-id generation, and credential-version compare-and-swap helpers.
- `.opencode/plugins/github-copilot-multi-account/accounts.ts` - dedupe, sticky selection, cooldown updates, shared-backoff hints, active-account preference.
- `.opencode/plugins/github-copilot-multi-account/classifier.ts` - fail-closed response classification, shared-vs-account-scoped `429` handling, retry-budget helpers.
- `.opencode/plugins/github-copilot-multi-account/auth.ts` - request wrapper, refresh flow, replayability checks, and auth-loader orchestration.
- `.opencode/plugins/github-copilot-multi-account/tools.ts` - `list_accounts`, `show_pool_status`, `set_active_account`, `remove_account`, `disable_account`, `enable_account`.
- `.opencode/plugins/github-copilot-multi-account/fixtures.ts` - typed fixture loaders for captured auth and response samples.
- `.opencode/plugins/github-copilot-multi-account/capability-gate.test.ts` - entrypoint and fail-closed gate tests.
- `.opencode/plugins/github-copilot-multi-account/storage.test.ts` - persistence, reconciliation, revision/CAS, declined-import, and tombstone tests.
- `.opencode/plugins/github-copilot-multi-account/accounts.test.ts` - selector, dedupe, cooldown, shared-backoff, and lease behavior tests.
- `.opencode/plugins/github-copilot-multi-account/classifier.test.ts` - classifier buckets, ambiguous `429`, and retry-budget tests.
- `.opencode/plugins/github-copilot-multi-account/auth.test.ts` - auth loader, refresh, replay safety, and account-rotation tests with mocked fetch.

**Modify**
- `.opencode/package.json` - only if implementation proves an extra dependency is truly necessary; prefer built-in Bun/Node APIs first.

**Reference only**
- `docs/superpowers/specs/2026-03-28-github-copilot-multi-account-rotation-design.md` - source of truth for behavior, acceptance criteria, and stop conditions.
- `.opencode/plugins/worktree.ts` - reference for larger plugin structure, persistence patterns, and default exports.
- `.opencode/plugins/background-agents.ts` - reference for structured logging, state files, and helper-module decomposition.
- `.opencode/plugins/kdco-primitives/mutex.ts` - optional in-process serialization helper if a local mutex is needed alongside file-backed compare-and-swap.

## Chunk 1: Capability Gate And State Foundations

### Task 1: Prove The Auth Override Contract

**Files:**
- Create: `.opencode/plugins/github-copilot-multi-account.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/capability-gate.json`
- Create: `.opencode/plugins/github-copilot-multi-account/capability-gate.probe.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/types.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/logger.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/logger.redaction.test.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/fixtures.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/capability-gate.test.ts`
- Reference: `docs/superpowers/specs/2026-03-28-github-copilot-multi-account-rotation-design.md`

- [ ] **Step 1: Record the capability-gate evidence in a checked-in file before deeper coding**

Create `.opencode/plugins/github-copilot-multi-account/capability-gate.json` and capture the exact local contract being targeted plus the proof used to validate it.

```json
{
  "authMethodShape": "string",
  "loaderShape": "string",
  "opencodeVersion": "string",
  "pluginVersion": "local",
  "providerId": "github-copilot",
  "authMethodId": "string",
  "validationCommand": "string",
  "probeScript": ".opencode/plugins/github-copilot-multi-account/capability-gate.probe.ts",
  "validationDate": "2026-03-28",
  "providerContractSummary": "string",
  "refreshContractSummary": "string",
  "requestFixtureHash": "string",
  "responseFixtureHash": "string",
  "replayProof": "string",
  "persistenceProof": "string",
  "transportOverrideProof": "string",
  "canInspectResponse": true,
  "canReplayBufferedRequest": true,
  "canPersistDuringRequest": true,
  "canOverrideTransport": true,
  "goNoGo": "go"
}
```

This file is the binary stop/go artifact for the entire plan. If any field stays false, stop v1 work.

- [ ] **Step 2: Create the plugin shell with named and default exports**

`logger.ts` must recursively redact nested objects and arrays before anything reaches `client.app.log`, including access tokens, refresh tokens, authorization headers, raw secret refs, account labels, immutable identity keys, and any account ids that do not match a plugin-generated opaque id format such as `copilot-acct-<hex>`.

```ts
export const GithubCopilotMultiAccountPlugin: Plugin = async ({ client }) => {
  const log = createLogger(client)

  return {
    auth: {
      provider: "github-copilot",
      methods: [],
      async loader(getAuth, provider) {
        throw new Error("Capability gate not implemented yet")
      },
    },
  }
}

export default GithubCopilotMultiAccountPlugin
```

- [ ] **Step 3: Add the gate helper that reads the recorded decision and fails closed**

```ts
export interface CapabilityGateEvidence {
  authMethodShape: string
  loaderShape: string
  opencodeVersion: string
  pluginVersion: string
  providerId: "github-copilot"
  authMethodId: string
  validationCommand: string
  probeScript: string
  validationDate: string
  providerContractSummary: string
  refreshContractSummary: string
  requestFixtureHash: string
  responseFixtureHash: string
  replayProof: string
  persistenceProof: string
  transportOverrideProof: string
  canInspectResponse: boolean
  canReplayBufferedRequest: boolean
  canPersistDuringRequest: boolean
  canOverrideTransport: boolean
  goNoGo: "go" | "stop"
}

export async function loadCapabilityGateEvidence(): Promise<CapabilityGateEvidence>

export function assertCapabilityGate(evidence: CapabilityGateEvidence): void {
  if (
    !evidence.authMethodShape ||
    !evidence.loaderShape ||
    !evidence.opencodeVersion ||
    !evidence.pluginVersion ||
    evidence.providerId !== "github-copilot" ||
    !evidence.authMethodId ||
    !evidence.validationCommand ||
    !evidence.probeScript ||
    !evidence.validationDate ||
    !evidence.providerContractSummary ||
    !evidence.refreshContractSummary ||
    !evidence.requestFixtureHash ||
    !evidence.responseFixtureHash ||
    !evidence.replayProof ||
    !evidence.persistenceProof ||
    !evidence.transportOverrideProof ||
    evidence.goNoGo !== "go" ||
    !evidence.canInspectResponse ||
    !evidence.canReplayBufferedRequest ||
    !evidence.canPersistDuringRequest ||
    !evidence.canOverrideTransport
  ) {
    throw new Error(
      "github-copilot multi-account requires response-aware auth override support; stop v1 and return to design",
    )
  }
}
```

- [ ] **Step 4: Add a focused gate test**

Create `.opencode/plugins/github-copilot-multi-account/capability-gate.test.ts` and verify both importability and fail-closed behavior.

```ts
import { expect, test } from "bun:test"
import { assertCapabilityGate } from "./types"

test("capability gate fails closed", () => {
  expect(() =>
    assertCapabilityGate({
      authMethodShape: "unknown",
      loaderShape: "unknown",
      opencodeVersion: "unknown",
      pluginVersion: "local",
      providerId: "github-copilot",
      authMethodId: "unknown",
      validationCommand: "manual",
      probeScript: ".opencode/plugins/github-copilot-multi-account/capability-gate.probe.ts",
      validationDate: "2026-03-28",
      providerContractSummary: "missing",
      refreshContractSummary: "missing",
      requestFixtureHash: "missing",
      responseFixtureHash: "missing",
      replayProof: "missing",
      persistenceProof: "missing",
      transportOverrideProof: "missing",
      canInspectResponse: false,
      canReplayBufferedRequest: false,
      canPersistDuringRequest: false,
      canOverrideTransport: false,
      goNoGo: "stop",
    }),
  ).toThrow("stop v1 and return to design")
})
```

Also add `logger.redaction.test.ts` covering recursive redaction of nested objects and arrays containing tokens, auth headers, secret refs, labels, identity keys, and non-synthetic account ids.

Also add a positive test that loads the real checked-in `capability-gate.json` artifact plus negative tests for missing proof fields and a wrong `providerId`.

- [ ] **Step 5: Add and run the executable probe against the real OpenCode runtime path**

Create `.opencode/plugins/github-copilot-multi-account/capability-gate.probe.ts`, make `validationCommand` point to it, and run that exact command against the actual local auth override path. Only leave `goNoGo` set to `"go"` after the probe records request/response evidence, replay proof, persistence proof, and transport-override proof.

- [ ] **Step 6: Verify the gate slice**

Run: `bun test .opencode/plugins/github-copilot-multi-account/capability-gate.test.ts && bun test .opencode/plugins/github-copilot-multi-account/logger.redaction.test.ts && bun --eval "await import('./.opencode/plugins/github-copilot-multi-account.ts')"`

Expected: PASS, with the plugin entrypoint importing the real checked-in artifact through `loadCapabilityGateEvidence()`, `validationCommand` matching the recorded probe command exactly, and `go` present only after real runtime evidence is captured.

### Task 2: Build Registry Schema, Secret Payloads, And Revisioned Persistence

**Files:**
- Create: `.opencode/plugins/github-copilot-multi-account/schema.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/storage.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/keychain.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/storage.test.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/types.ts`

- [ ] **Step 1: Define the persisted state and secret payload types once**

```ts
export interface StoredCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
}

export interface CopilotAccountRecord {
  id: string // plugin-generated opaque id, e.g. copilot-acct-<hex>
  identityKey: string
  label: string
  secretRef: string
  credentialVersion: number
  status: "active" | "cooldown" | "reauth_required" | "disabled" | "removed"
  expiresAt: number | null
  cooldownUntil: number | null
  modelCooldowns: Record<string, number>
  preferred: boolean
  lastUsedAt: number | null
  lastSwitchReason: string | null
  recentFailureReason: string | null
  recentFailureAt: number | null
  recoverableError: {
    code: string
    message: string
    detectedAt: number
    requiresReauth: boolean
  } | null
  schemaVersion: 1
}

export interface AccountRegistry {
  version: 1
  revision: number
  importDeclined: boolean
  activeAccountId: string | null
  sharedBackoffUntil: number | null
  sharedBackoffScope: "provider" | "model-family" | null
  sharedBackoffReason: string | null
  accounts: CopilotAccountRecord[]
}
```

- [ ] **Step 2: Implement the secret-store adapter with explicit error mapping**

```ts
export interface SecretStore {
  upsert(ref: string, version: number, value: StoredCredentials): Promise<void>
  read(ref: string, version: number): Promise<StoredCredentials>
  listVersions(ref: string): Promise<number[]>
  removeVersion(ref: string, version: number): Promise<void>
  removeAll(ref: string): Promise<void>
}
```

Behavior rules:
- use the macOS keychain service name `opencode.github-copilot-multi-account` and account name format `${ref}:v${version}` so `listVersions(ref)` can enumerate versions deterministically
- macOS: `security add-generic-password`, `find-generic-password`, `delete-generic-password`
- `listVersions(ref)` must enumerate only records under service `opencode.github-copilot-multi-account`, filter by the `${ref}:v` prefix, parse numeric suffixes, sort numerically ascending, and ignore unrelated records
- non-macOS: throw `UnsupportedSecretStoreError`
- locked or unavailable keychain: throw `SecretStoreUnavailableError`
- corrupt or missing record: throw `SecretStoreCorruptError`
- refreshed credentials keep the old secret version until registry durability is confirmed
- tombstoned accounts call `removeAll(ref)` only after lease-safe cleanup confirms no active reader still depends on that ref
- startup reconciliation uses `listVersions(ref)` to detect orphaned superseded versions and schedule deterministic cleanup

- [ ] **Step 3: Implement revisioned mutation control and atomic persistence**

Add `loadRegistry()`, `saveRegistry()`, `mutateRegistry()`, `reconcileRegistry()`, and `tombstoneAccount()`.

```ts
export async function mutateRegistry<T>(
  mutate: (registry: AccountRegistry) => Promise<{ registry: AccountRegistry; result: T }>,
): Promise<T>
```

Implementation notes:
- persist the registry only under the platform-native user-scoped plugin state path; do not write project-local copies
- use file-backed compare-and-swap on `revision`
- use atomic rename for the final write
- reuse `.opencode/plugins/kdco-primitives/mutex.ts` for in-process serialization so only the CAS path handles true cross-process contention
- if `revision` changed underfoot, reload and retry the mutation helper instead of clobbering state
- set strict permissions on registry and lease files when they are created or rewritten

- [ ] **Step 4: Implement startup reconciliation**

Reconciliation rules:
- missing `secretRef` target -> set `recoverableError`, mark the account recoverable, and surface actionable error
- orphaned secrets -> queue cleanup
- `removed` accounts -> remain tombstoned and never become eligible again on load
- `sharedBackoffUntil` survives restart only while its TTL has not expired

- [ ] **Step 5: Add focused persistence tests**

Cover:
- schema round-trip
- atomic save/load
- concurrent mutation does not clobber `revision`
- registry and lease files are created with strict permissions
- registry rewrite preserves strict permissions
- corrupt registry JSON or schema fails loudly
- declined-import registry flag
- account ids remain plugin-generated opaque ids during merge/import and never reuse labels or identity keys
- missing secret reference recovery
- unsupported, unavailable, and corrupt keychain paths are mapped to explicit errors
- orphaned superseded secret versions are detected through `listVersions(ref)` and queued for cleanup
- unrelated keychain records do not pollute `listVersions(ref)` results
- tombstoned account persists across reload

```ts
test("tombstoned accounts persist across reload", async () => {
  const registry = await loadRegistry(fixtureDir)
  expect(registry.accounts.find((a) => a.id === "removed-1")?.status).toBe("removed")
})
```

- [ ] **Step 6: Verify the storage slice**

Run: `bun test .opencode/plugins/github-copilot-multi-account/storage.test.ts`

Expected: PASS for revision/CAS, persistence, reconciliation, and tombstone scenarios.

### Task 3: Add Deterministic Selection, Shared Backoff, And Cross-Process Leases

**Files:**
- Create: `.opencode/plugins/github-copilot-multi-account/accounts.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/locks.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/accounts.test.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/types.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/storage.ts`

- [ ] **Step 1: Implement the selector with explicit deterministic order**

```ts
export function pickEligibleAccount(
  registry: AccountRegistry,
  now: number,
): CopilotAccountRecord | null

export function mergeImportedAccount(
  registry: AccountRegistry,
  account: CopilotAccountRecord,
): AccountRegistry
```

Rules:
- prefer explicitly selected account while it remains eligible
- on failover, walk stable registry order starting immediately after the current sticky account, wrap once, and make the winning account sticky for subsequent requests
- dedupe by immutable `identityKey`
- allow an expired-but-refreshable selected account to remain eligible for same-account refresh only
- ignore `removed`, `disabled`, `reauth_required`, and active cooldowns for normal routing
- honor registry-level shared backoff before rotating to another account

- [ ] **Step 2: Implement account cooldown and shared-backoff helpers**

```ts
export function applyAccountCooldown(registry: AccountRegistry, accountId: string, until: number): AccountRegistry
export function applySharedBackoff(
  registry: AccountRegistry,
  until: number,
  scope: "provider" | "model-family",
  reason: string,
): AccountRegistry
```

- [ ] **Step 3: Implement cross-process refresh leases**

```ts
export interface RefreshLease {
  accountId: string
  ownerId: string
  expiresAt: number
}

export type RefreshLeaseOutcome<T> =
  | { type: "acquired"; value: T }
  | { type: "newer_credentials_visible"; credentialVersion: number }
  | { type: "retry" }
  | { type: "timed_out" }

export async function withRefreshLease<T>(args: {
  accountId: string
  expectedCredentialVersion: number
  reloadCurrentVersion: () => Promise<number>
  run: () => Promise<T>
}): Promise<RefreshLeaseOutcome<T>>
export function assertCredentialVersion(expected: number, current: number): void
```

Behavior rules:
- store leases in the same plugin state directory as the registry
- generate `ownerId` once per process from hostname + pid + random suffix
- wait up to 2 seconds total for another process to finish
- after the wait, surface one explicit outcome: newer credentials visible, retry allowed, acquired, or timed out
- reclaim stale leases only after expiry and registry reload
- use the lease helper for both cross-process coordination and same-account refresh singleflight

- [ ] **Step 4: Add selector and lease tests**

Cover:
- repeated `/connect` for the same identity updates in place
- merge/import preserves the existing opaque account id for a known identity instead of replacing it with provider-derived identifiers
- preferred account stays sticky until ineligible
- A -> B deterministic failover walks forward from the current sticky account instead of restarting at the first record
- shared backoff blocks rotation
- expired-but-refreshable selected account is retained only for same-account refresh
- only one same-account refresh executes when two requests race for the same credentials
- stale lease cannot overwrite newer credential version
- bounded 2-second lease wait exits through re-read, reclaim, or fail-fast behavior
- lease files are created and rewritten with strict permissions in the user-scoped state path

- [ ] **Step 5: Verify the selection slice**

Run: `bun test .opencode/plugins/github-copilot-multi-account/storage.test.ts && bun test .opencode/plugins/github-copilot-multi-account/accounts.test.ts && bun test .opencode/plugins/github-copilot-multi-account/logger.redaction.test.ts`

Expected: PASS for selector, dedupe, cooldown, shared-backoff, revisioned persistence, and lease coordination scenarios.

## Chunk 2: Runtime Wiring, Tools, And Final Verification

### Task 4: Implement Fail-Closed Classification And Replay Safety

**Files:**
- Create: `.opencode/plugins/github-copilot-multi-account/classifier.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/classifier.test.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/fixtures.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/types.ts`

- [ ] **Step 1: Encode classifier enums and replayability helpers**

```ts
export type ResponseDisposition =
  | "success"
  | "refresh_and_retry"
  | "rotate_account"
  | "retry_same_account"
  | "fail_with_retry_time"
  | "fail_request"
  | "fail_without_rotation"

export function canReplayRequest(input: RequestInit & { body?: BodyInit | null }): boolean
export function snapshotReplayableRequest(input: RequestInit & { body?: BodyInit | null }): Promise<ReplaySnapshot | null>
export function classifyCopilotResponse(response: Response, bodyText: string): {
  disposition: ResponseDisposition
  retryAt?: number
  retryAfterMs?: number
  cooldownScope?: "account" | "provider" | "model-family"
  reason?: string
  accountScoped?: boolean
}
export function classifyCopilotFailure(error: unknown): {
  disposition: ResponseDisposition
  retryAt?: number
  retryAfterMs?: number
  reason?: string
}
```

- [ ] **Step 2: Implement fail-closed `429` handling**

Rules:
- only `rotate_account` when fixtures prove the throttle is account-scoped
- ambiguous/shared `429` -> `fail_with_retry_time`
- never rotate on unknown signals
- honor `Retry-After` when present

- [ ] **Step 3: Add classifier tests using captured fixtures**

Cover each provider-signal-table bucket from the spec:
- expired token fixture -> `refresh_and_retry`
- org restriction fixture -> `fail_without_rotation`
- account-scoped `429` fixture -> `rotate_account`
- ambiguous `429` fixture -> `fail_with_retry_time`
- transient `5xx` or network fixture -> `retry_same_account`
- invalid request fixture -> `fail_request`
- direct transport-failure tests use `classifyCopilotFailure(error)` so pre-response timeouts and connection resets are classified centrally

Run: `bun test .opencode/plugins/github-copilot-multi-account/classifier.test.ts`

Expected: PASS for all fixture-backed classifier cases.

### Task 5: Wire The Auth Loader, Refresh Flow, And Management Tools

**Files:**
- Create: `.opencode/plugins/github-copilot-multi-account/auth.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/tools.ts`
- Create: `.opencode/plugins/github-copilot-multi-account/auth.test.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/accounts.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/storage.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/logger.ts`

- [ ] **Step 1: Implement the auth-loader orchestration**

```ts
export async function buildCopilotAuthOverride(args: {
  getAuth: () => Promise<unknown>
  provider: unknown
  registryStore: RegistryStore
  secretStore: SecretStore
  log: PluginLogger
}): Promise<{
  fetch: typeof fetch
  headers?: Record<string, string>
}>
```

Flow:
- assert the capability gate passed
- load registry and choose account
- reuse the lease/singleflight helpers so only one refresh runs per account while cross-process contenders re-read or fail fast per the lock outcome
- refresh if near expiry
- buffer and snapshot replayable requests so retries preserve the exact payload
- enforce retry budget: one same-account retry, one cross-account attempt per eligible account, hard cap of five total upstream attempts
- wrap `fetch` for replay-safe retries only
- persist updated state through revisioned mutation helpers
- emit structured logs and counters for refreshes, cooldowns, rotations, pool exhaustion, classifier buckets, shared-backoff hints, and manual tool actions

- [ ] **Step 2: Implement refresh and import behavior**

Handle:
- first successful plugin auth import from existing native Copilot auth
- declined import -> plugin stays inactive and native auth keeps working unchanged
- refresh success -> bump credential version and update keychain + registry
- refresh failure -> mark account `reauth_required` and rotate if another healthy account exists
- missing keychain refs or corrupt secrets surfaced clearly during runtime load instead of silently falling back

- [ ] **Step 3: Add management tools**

Define `tool()` entries for:
- `list_accounts`
- `show_pool_status`
- `set_active_account`
- `remove_account`
- `disable_account`
- `enable_account`

Tool output must redact secrets and expose only labels, ids, statuses, cooldowns, and switch reasons.

State-transition rules:
- `remove_account` tombstones immediately for new selections
- secret deletion is deferred until lease-safe cleanup completes
- `disable_account` blocks new selections but does not break already in-flight requests
- management actions must race safely with in-flight requests: existing requests may finish on their selected account, new requests must observe the new state

- [ ] **Step 4: Add loader and tool tests with mocked fetch and mocked keychain**

Cover:
- healthy request uses sticky account
- expired token refreshes once then succeeds
- concurrent requests for the same account perform only one refresh and the follower reuses the newer credentials or fails fast per lease outcome
- failed refresh marks account `reauth_required` and rotates
- account-scoped `429` rotates to next account
- ambiguous `429` fails fast and does not rotate
- `403` org or entitlement restriction does not rotate
- pre-response transport or `5xx` retry once on the same account and rotate only on repeated replayable failure
- `Retry-After` is honored and exposed as actionable retry timing
- exhausted pool returns earliest retry timing
- capability gate hard-stops runtime when evidence is missing or set to stop
- retry budget is enforced at one same-account retry, one cross-account pass, and five total attempts max
- manual remove or disable actions race safely with in-flight requests
- streamed response is never replayed after first byte
- declined-import branch keeps plugin inactive while native auth continues unchanged

Run: `bun test .opencode/plugins/github-copilot-multi-account/auth.test.ts`

Expected: PASS for loader orchestration, replay-safety, and management-tool behavior.

### Task 6: End-To-End Verification And Operator Readiness

**Files:**
- Modify: `.opencode/plugins/github-copilot-multi-account.ts`
- Modify: `.opencode/plugins/github-copilot-multi-account/*.test.ts`
- Reference: `docs/superpowers/specs/2026-03-28-github-copilot-multi-account-rotation-design.md`

- [ ] **Step 1: Run the full focused test suite**

Run: `bun test .opencode/plugins/github-copilot-multi-account`

Expected: PASS across capability gate, storage, accounts, classifier, and auth tests.

- [ ] **Step 2: Smoke-load the plugin module with Bun**

Run: `bun --eval "await import('./.opencode/plugins/github-copilot-multi-account.ts')"`

Expected: exits 0 with no import/runtime error.

- [ ] **Step 3: Manual operator checklist**

Verify manually in OpenCode after implementation:
- native `github-copilot/*` model names still resolve
- repeated `/connect` updates or adds accounts without duplicate identity keys
- management tools show redacted state only
- removing an account tombstones it immediately for new requests
- ambiguous/shared `429` surfaces retry timing without pool churn
- `403` org or entitlement failures do not rotate
- pool exhaustion reports earliest retry timing
- disable and enable actions update eligibility without breaking already-started requests
- declined import leaves native auth working unchanged

- [ ] **Step 4: Compare implementation against the spec acceptance criteria**

Create a short checklist in implementation notes, or in a PR if one exists, that maps each acceptance criterion in `docs/superpowers/specs/2026-03-28-github-copilot-multi-account-rotation-design.md` to either:
- automated coverage
- manual smoke coverage
- explicit stop condition

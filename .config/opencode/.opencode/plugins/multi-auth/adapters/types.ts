/**
 * Provider adapter contract for multi-auth.
 *
 * Adapters own OAuth authorize/refresh and the hardcoded API origin allowlist (F1).
 * Exhaustion classification is optional (implemented per-provider in detect task).
 *
 * @module multi-auth/adapters/types
 */

// =============================================================================
// TOKENS
// =============================================================================

/** OAuth token set (access + refresh + absolute expiry). */
export type TokenSet = {
	access: string
	refresh: string
	/** Absolute expiry as epoch milliseconds. */
	expires: number
}

/**
 * Result of a completed authorize (PKCE) dance.
 * Task 8 maps `type: "success"` onto opencode's auth hook contract
 * `{ type: "success", refresh, access, expires }`.
 */
export type AuthorizeResult =
	| ({
			type: "success"
			/** Account label chosen at login time. */
			label: string
			meta?: Record<string, unknown>
	  } & TokenSet)
	| {
			type: "failed"
			/** Safe, non-sensitive failure reason (never includes codes/tokens). */
			reason: string
	  }

/**
 * F4 refresh outcome (discriminated union).
 * - `ok` — new tokens (persist before use is the caller's / orchestrator's job)
 * - `needs_reauth` — only for explicit `invalid_grant` (or provider equivalent)
 * - `transient` — ambiguous failures after bounded retry
 */
export type RefreshResult =
	| ({ outcome: "ok" } & TokenSet)
	| {
			outcome: "needs_reauth"
			error?: string
	  }
	| {
			outcome: "transient"
			error?: string
			/** Total token-endpoint attempts performed. */
			attempts: number
	  }

// =============================================================================
// EXHAUSTION (optional; task 6)
// =============================================================================

export type ExhaustionKind =
	| "quota"
	| "rate_limit"
	| "needs_reauth"
	| "transient"
	| "none"

export type ExhaustionClassification = {
	kind: ExhaustionKind
	/** Epoch ms when the account may become usable again; null if unknown. */
	resetAt: number | null
	reason?: string
}

// =============================================================================
// DEPS (injectable seams)
// =============================================================================

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

/** Optional deps for authorize — keep production defaults; override in tests. */
export type AuthorizeDeps = {
	fetch?: FetchLike
	/** Open the authorize URL (default: no-op in headless; production wires a real opener). */
	openUrl?: (url: string) => void | Promise<void>
	/**
	 * Manual code-paste fallback. Return the pasted authorization code
	 * (optionally `code#state`). Return null to skip / cancel.
	 */
	promptCode?: () => Promise<string | null>
	/** Max wait for loopback callback or manual code (ms). */
	timeoutMs?: number
	/**
	 * Invoked once the loopback listener is ready and the authorize URL is built.
	 * Tests use this to drive the redirect without a real browser.
	 */
	onReady?: (info: {
		authorizeUrl: string
		redirectUri: string
		state: string
		codeChallenge: string
		codeChallengeMethod: "S256"
	}) => void | Promise<void>
	/**
	 * Test-only endpoint / client overrides. Production MUST omit this.
	 * @internal
	 */
	_endpoints?: {
		authorizeUrl?: string
		tokenUrl?: string
		clientId?: string
		/** Override redirect URI (disables loopback when set without loopback). */
		redirectUri?: string
		scopes?: string
		/** When true, skip loopback and only accept manual code paste. */
		manualOnly?: boolean
	}
}

/** Optional deps for a single token-endpoint refresh attempt. */
export type RefreshDeps = {
	fetch?: FetchLike
	/** Per-attempt timeout (ms). */
	timeoutMs?: number
	/**
	 * Test-only endpoint overrides.
	 * @internal
	 */
	_endpoints?: {
		tokenUrl?: string
		clientId?: string
	}
}

// =============================================================================
// ADAPTER
// =============================================================================

/**
 * Per-provider OAuth + origin allowlist adapter.
 *
 * `apiOrigins` is FROZEN and hardcoded (F1) — no config or parameter may extend it.
 */
export interface ProviderAdapter {
	readonly providerId: string
	/** F1: hardcoded, non-configurable API origin allowlist. */
	readonly apiOrigins: readonly string[]
	/** Interactive PKCE authorize dance for one labeled account. */
	authorize(
		input: { label: string },
		deps?: AuthorizeDeps,
	): Promise<AuthorizeResult>
	/**
	 * Single token-endpoint refresh attempt (no retry).
	 * Orchestration (mutex, F4 retries, persist-before-use) lives in `refresh.ts`.
	 */
	refresh(refreshToken: string, deps?: RefreshDeps): Promise<RefreshResult>
	/**
	 * Optional exhaustion classifier (task 6). Declared here for the fetch wrapper.
	 */
	classifyExhaustion?(
		response: Response,
		bodyText?: string,
	): ExhaustionClassification | Promise<ExhaustionClassification>
}

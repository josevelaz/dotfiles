/**
 * multi-auth exhaustion detection.
 *
 * Pure classifier: no I/O at classify time. `now` is injectable for date math.
 *
 * Generic layer handles HTTP status semantics; provider refinements (e.g.
 * `anthropicRefinement`) refine reason / resetAt from body + headers.
 *
 * Q3 header findings (docs.anthropic.com rate-limits + empirical OAuth shapes):
 * - Documented API headers: `retry-after` (seconds), `anthropic-ratelimit-requests-*`,
 *   `anthropic-ratelimit-tokens-*` with `*-reset` as RFC 3339 timestamps.
 * - Claude subscription OAuth (undocumented publicly; observed in Claude Code /
 *   community captures): `anthropic-ratelimit-unified-reset` (unix epoch seconds),
 *   `anthropic-ratelimit-unified-status` (`allowed` | `allowed_warning` | `rejected`),
 *   plus windowed variants `…-5h-*` / `…-7d-*` and
 *   `anthropic-ratelimit-unified-representative-claim` (`five_hour` | `seven_day`).
 * - 529 / `overloaded_error` is provider capacity, not account exhaustion.
 */

import {
	DEFAULT_COOLDOWN_SECONDS,
	DEFAULT_MAX_COOLDOWN_SECONDS,
	type RetryReason,
} from "./config"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Classification =
	| { kind: "none" }
	| {
			kind: "exhausted"
			reason: RetryReason
			/** Epoch ms when the account may be usable again; null if unknown. */
			resetAtMs: number | null
			cooldownSeconds: number
	  }
	| { kind: "needs_reauth" }
	| { kind: "auth_stale" }
	| { kind: "transient" }

/** Minimal Response-like input (status + headers + optionally parsed body). */
export interface ResponseLike {
	status: number
	headers?: HeadersLike
	/** Already-parsed JSON body when available. */
	body?: unknown
	/**
	 * True for transport failures (DNS, connection reset, abort) with no HTTP
	 * status. Treated as `transient`.
	 */
	networkError?: boolean
}

export type HeadersLike =
	| Headers
	| Record<string, string | null | undefined>
	| Map<string, string>
	| Iterable<[string, string]>

export interface ClassifyContext {
	/** True when this request used a token that was just refreshed. */
	justRefreshed?: boolean
	/** Prior consecutive exhaustion trips for this account (0 = first trip). */
	consecutiveTrips?: number
	defaultCooldownSeconds?: number
	maxCooldownSeconds?: number
	/** Epoch ms; injectable for pure date math. Defaults to Date.now(). */
	now?: number
	/** Optional provider refinement applied after the generic pass. */
	refinement?: ProviderRefinement
}

export interface RefineContext {
	justRefreshed: boolean
	consecutiveTrips: number
	defaultCooldownSeconds: number
	maxCooldownSeconds: number
	now: number
}

/**
 * Provider-specific refinement. May upgrade/downgrade a classification and
 * supply a more precise `resetAtMs` / reason.
 */
export interface ProviderRefinement {
	/** Short id for logging (e.g. "anthropic"). */
	id: string
	refine(response: ResponseLike, base: Classification, ctx: RefineContext): Classification
	/**
	 * Optional hint used by the generic 429 path when `retry-after` is absent:
	 * return epoch-ms reset or null.
	 */
	hintResetAtMs?(response: ResponseLike, ctx: RefineContext): number | null
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function headerEntries(headers: HeadersLike | undefined): Array<[string, string]> {
	if (!headers) return []
	if (typeof Headers !== "undefined" && headers instanceof Headers) {
		return [...headers.entries()]
	}
	if (headers instanceof Map) {
		return [...headers.entries()]
	}
	if (Symbol.iterator in Object(headers) && !Array.isArray(headers) && typeof headers !== "object") {
		// unreachable for plain objects; fall through
	}
	// Iterable of pairs (but not plain object)
	if (
		typeof (headers as Iterable<[string, string]>)[Symbol.iterator] === "function" &&
		!isPlainRecord(headers)
	) {
		return [...(headers as Iterable<[string, string]>)]
	}
	const out: Array<[string, string]> = []
	for (const [k, v] of Object.entries(headers as Record<string, string | null | undefined>)) {
		if (v == null) continue
		out.push([k, v])
	}
	return out
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Case-insensitive header lookup. */
export function getHeader(headers: HeadersLike | undefined, name: string): string | null {
	const want = name.toLowerCase()
	for (const [k, v] of headerEntries(headers)) {
		if (k.toLowerCase() === want) return v
	}
	return null
}

/**
 * Parse `Retry-After`: integer seconds OR HTTP-date.
 * Returns cooldown seconds from `now`, or null if unparseable/missing.
 */
export function parseRetryAfterSeconds(
	value: string | null | undefined,
	now: number,
): number | null {
	if (value == null) return null
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	// Integer seconds (possibly with fractional part — floor)
	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		const secs = Math.floor(Number(trimmed))
		if (!Number.isFinite(secs) || secs < 0) return null
		return secs
	}

	// HTTP-date
	const ms = Date.parse(trimmed)
	if (Number.isNaN(ms)) return null
	const delta = Math.ceil((ms - now) / 1000)
	return Math.max(0, delta)
}

/**
 * Parse a rate-limit reset value: unix epoch seconds (numeric string) or RFC 3339.
 * Returns epoch ms, or null.
 */
export function parseResetTimestamp(value: string | null | undefined): number | null {
	if (value == null) return null
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	// Pure integer → treat as unix epoch seconds (or ms if clearly ms-scale)
	if (/^\d+$/.test(trimmed)) {
		const n = Number(trimmed)
		if (!Number.isFinite(n)) return null
		// Heuristic: 1e12+ is already ms (year ~2001+)
		if (n >= 1e12) return n
		return n * 1000
	}

	const ms = Date.parse(trimmed)
	if (Number.isNaN(ms)) return null
	return ms
}

// ---------------------------------------------------------------------------
// Cooldown math
// ---------------------------------------------------------------------------

/**
 * Exponential cooldown: default * 2^consecutiveTrips, capped at max.
 * consecutiveTrips=0 → default; 1 → 2×; 2 → 4×; …
 */
export function exponentialCooldownSeconds(
	consecutiveTrips: number,
	defaultCooldownSeconds: number,
	maxCooldownSeconds: number,
): number {
	const trips = Math.max(0, Math.floor(consecutiveTrips))
	const base = Math.max(0, defaultCooldownSeconds)
	const cap = Math.max(0, maxCooldownSeconds)
	// Avoid Infinity from huge exponents
	const factor = trips >= 31 ? Number.POSITIVE_INFINITY : 2 ** trips
	const raw = base * factor
	if (!Number.isFinite(raw)) return cap
	return Math.min(raw, cap)
}

function exhausted(
	reason: RetryReason,
	cooldownSeconds: number,
	now: number,
	resetAtMs: number | null,
): Classification {
	const cd = Math.max(0, Math.floor(cooldownSeconds))
	const reset = resetAtMs ?? (cd > 0 ? now + cd * 1000 : null)
	return {
		kind: "exhausted",
		reason,
		resetAtMs: reset,
		cooldownSeconds: cd,
	}
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

interface AnthropicErrorShape {
	type?: string
	error?: {
		type?: string
		message?: string
	}
}

function anthropicError(body: unknown): AnthropicErrorShape["error"] | null {
	if (!isPlainRecord(body)) return null
	// Shape: { type: "error", error: { type, message } }
	if (isPlainRecord(body.error)) {
		return body.error as AnthropicErrorShape["error"]
	}
	// Shape: { type: "rate_limit_error", message } (flat)
	if (typeof body.type === "string" && body.type.endsWith("_error")) {
		return { type: body.type, message: typeof body.message === "string" ? body.message : undefined }
	}
	return null
}

function errorType(body: unknown): string | null {
	const err = anthropicError(body)
	return err?.type ?? null
}

function errorMessage(body: unknown): string {
	const err = anthropicError(body)
	return (err?.message ?? "").toLowerCase()
}

/** Subscription / quota flavored messages (weekly, usage limits, etc.). */
function looksLikeQuotaMessage(message: string): boolean {
	return (
		/\bweekly\b/.test(message) ||
		/\busage limit\b/.test(message) ||
		/\bmonthly\b/.test(message) ||
		/\bquota\b/.test(message) ||
		/\bsubscription\b/.test(message) ||
		/\bplan limit\b/.test(message) ||
		/\byou.ve hit your\b/.test(message) ||
		/\byou have hit your\b/.test(message)
	)
}

// ---------------------------------------------------------------------------
// Anthropic header parsing
// ---------------------------------------------------------------------------

const ANTHROPIC_RESET_HEADERS = [
	// Prefer unified subscription window reset (OAuth Pro/Max)
	"anthropic-ratelimit-unified-reset",
	"anthropic-ratelimit-unified-5h-reset",
	"anthropic-ratelimit-unified-7d-reset",
	// Documented API token/request windows (RFC 3339)
	"anthropic-ratelimit-requests-reset",
	"anthropic-ratelimit-tokens-reset",
	"anthropic-ratelimit-input-tokens-reset",
	"anthropic-ratelimit-output-tokens-reset",
] as const

/**
 * Pick the best reset timestamp from Anthropic rate-limit headers.
 *
 * Preference:
 * 1. `anthropic-ratelimit-unified-reset` (representative window)
 * 2. Window matching `representative-claim` (five_hour → 5h, seven_day → 7d)
 * 3. Any rejected window's reset
 * 4. First parseable standard `anthropic-ratelimit-*-reset`
 */
export function parseAnthropicResetAtMs(headers: HeadersLike | undefined): number | null {
	const unified = parseResetTimestamp(getHeader(headers, "anthropic-ratelimit-unified-reset"))
	if (unified != null) return unified

	const claim = (getHeader(headers, "anthropic-ratelimit-unified-representative-claim") ?? "")
		.toLowerCase()
		.replace(/-/g, "_")

	if (claim === "five_hour" || claim === "5h") {
		const v = parseResetTimestamp(getHeader(headers, "anthropic-ratelimit-unified-5h-reset"))
		if (v != null) return v
	}
	if (claim === "seven_day" || claim === "7d" || claim === "seven_days") {
		const v = parseResetTimestamp(getHeader(headers, "anthropic-ratelimit-unified-7d-reset"))
		if (v != null) return v
	}

	// Prefer a rejected window if status is present
	const fiveStatus = getHeader(headers, "anthropic-ratelimit-unified-5h-status")
	const sevenStatus = getHeader(headers, "anthropic-ratelimit-unified-7d-status")
	if (fiveStatus === "rejected") {
		const v = parseResetTimestamp(getHeader(headers, "anthropic-ratelimit-unified-5h-reset"))
		if (v != null) return v
	}
	if (sevenStatus === "rejected") {
		const v = parseResetTimestamp(getHeader(headers, "anthropic-ratelimit-unified-7d-reset"))
		if (v != null) return v
	}

	for (const name of ANTHROPIC_RESET_HEADERS) {
		const v = parseResetTimestamp(getHeader(headers, name))
		if (v != null) return v
	}
	return null
}

function anthropicExhaustionReason(response: ResponseLike): RetryReason {
	const msg = errorMessage(response.body)
	if (looksLikeQuotaMessage(msg)) return "quota"

	const unifiedStatus = getHeader(response.headers, "anthropic-ratelimit-unified-status")
	if (unifiedStatus === "rejected") {
		// Subscription OAuth window rejection → quota (5h / weekly usage)
		return "quota"
	}

	const sevenStatus = getHeader(response.headers, "anthropic-ratelimit-unified-7d-status")
	const fiveStatus = getHeader(response.headers, "anthropic-ratelimit-unified-5h-status")
	if (sevenStatus === "rejected" || fiveStatus === "rejected") {
		return "quota"
	}

	return "rate_limit"
}

// ---------------------------------------------------------------------------
// Anthropic refinement (exported for callers / tests)
// ---------------------------------------------------------------------------

export const anthropicRefinement: ProviderRefinement = {
	id: "anthropic",

	hintResetAtMs(response, _ctx) {
		return parseAnthropicResetAtMs(response.headers)
	},

	refine(response, base, ctx) {
		const et = errorType(response.body)

		// Capacity overload — never burn accounts
		if (response.status === 529 || et === "overloaded_error") {
			return { kind: "transient" }
		}

		// Explicit rate_limit_error body on any status → exhaustion
		if (et === "rate_limit_error") {
			const reason = anthropicExhaustionReason(response)
			const retryAfter = parseRetryAfterSeconds(getHeader(response.headers, "retry-after"), ctx.now)
			const headerReset = parseAnthropicResetAtMs(response.headers)

			if (retryAfter != null) {
				return exhausted(reason, retryAfter, ctx.now, ctx.now + retryAfter * 1000)
			}
			if (headerReset != null) {
				const secs = Math.max(0, Math.ceil((headerReset - ctx.now) / 1000))
				return exhausted(reason, secs, ctx.now, headerReset)
			}
			const cd = exponentialCooldownSeconds(
				ctx.consecutiveTrips,
				ctx.defaultCooldownSeconds,
				ctx.maxCooldownSeconds,
			)
			return exhausted(reason, cd, ctx.now, null)
		}

		// Refine a generic 429 exhaustion with Anthropic reason + reset
		if (base.kind === "exhausted" && response.status === 429) {
			const reason = anthropicExhaustionReason(response)
			const headerReset = parseAnthropicResetAtMs(response.headers)
			if (headerReset != null && base.resetAtMs == null) {
				const secs = Math.max(0, Math.ceil((headerReset - ctx.now) / 1000))
				// Prefer header reset when retry-after was absent (cooldown was default)
				const hadRetryAfter =
					parseRetryAfterSeconds(getHeader(response.headers, "retry-after"), ctx.now) != null
				if (!hadRetryAfter) {
					return exhausted(reason, secs, ctx.now, headerReset)
				}
			}
			if (reason !== base.reason) {
				return { ...base, reason, resetAtMs: headerReset ?? base.resetAtMs }
			}
			if (headerReset != null && base.resetAtMs == null) {
				return { ...base, resetAtMs: headerReset }
			}
		}

		return base
	},
}

// ---------------------------------------------------------------------------
// Generic classifier
// ---------------------------------------------------------------------------

/**
 * Classify an HTTP (or network) response for multi-auth failover.
 *
 * Pure: no I/O. Pass `now` for deterministic date math.
 */
export function classify(response: ResponseLike, ctx: ClassifyContext = {}): Classification {
	const now = ctx.now ?? Date.now()
	const justRefreshed = ctx.justRefreshed === true
	const consecutiveTrips = ctx.consecutiveTrips ?? 0
	const defaultCooldownSeconds = ctx.defaultCooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS
	const maxCooldownSeconds = ctx.maxCooldownSeconds ?? DEFAULT_MAX_COOLDOWN_SECONDS
	const refineCtx: RefineContext = {
		justRefreshed,
		consecutiveTrips,
		defaultCooldownSeconds,
		maxCooldownSeconds,
		now,
	}

	const base = classifyGeneric(response, refineCtx, ctx.refinement)
	if (ctx.refinement) {
		return ctx.refinement.refine(response, base, refineCtx)
	}
	return base
}

function classifyGeneric(
	response: ResponseLike,
	ctx: RefineContext,
	refinement?: ProviderRefinement,
): Classification {
	if (response.networkError === true || response.status === 0) {
		return { kind: "transient" }
	}

	const status = response.status

	// Auth outcomes — never loop refresh when justRefreshed
	if (status === 401 || status === 403) {
		return justRefreshedResult(ctx.justRefreshed)
	}

	// Provider capacity / server errors — not account exhaustion
	if (status === 529 || (status >= 500 && status <= 599)) {
		return { kind: "transient" }
	}

	// Rate limit / quota
	if (status === 429) {
		return classify429(response, ctx, refinement)
	}

	return { kind: "none" }
}

function justRefreshedResult(justRefreshed: boolean): Classification {
	return justRefreshed ? { kind: "needs_reauth" } : { kind: "auth_stale" }
}

function classify429(
	response: ResponseLike,
	ctx: RefineContext,
	refinement?: ProviderRefinement,
): Classification {
	// Default reason; refinement may upgrade to quota
	const reason: RetryReason = "rate_limit"

	// 1. retry-after header
	const retryAfter = parseRetryAfterSeconds(getHeader(response.headers, "retry-after"), ctx.now)
	if (retryAfter != null) {
		return exhausted(reason, retryAfter, ctx.now, ctx.now + retryAfter * 1000)
	}

	// 2. provider hint (adapter refinement)
	const hint = refinement?.hintResetAtMs?.(response, ctx) ?? null
	if (hint != null) {
		const secs = Math.max(0, Math.ceil((hint - ctx.now) / 1000))
		return exhausted(reason, secs, ctx.now, hint)
	}

	// 3. exponential default
	const cd = exponentialCooldownSeconds(
		ctx.consecutiveTrips,
		ctx.defaultCooldownSeconds,
		ctx.maxCooldownSeconds,
	)
	return exhausted(reason, cd, ctx.now, null)
}

/**
 * Convenience: classify with Anthropic refinement applied.
 */
export function classifyAnthropic(
	response: ResponseLike,
	ctx: Omit<ClassifyContext, "refinement"> = {},
): Classification {
	return classify(response, { ...ctx, refinement: anthropicRefinement })
}

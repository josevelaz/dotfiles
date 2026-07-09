/**
 * Per-request multi-account fetch wrapper.
 *
 * Multiplexes OAuth accounts: select → refresh-if-stale → inject Bearer on
 * allowlisted origins only (F1) → classify → failover with body replay (F2).
 *
 * All dynamic state (store reads, refresh, selection) runs inside the returned
 * fetch on every request — the factory itself is load-once.
 *
 * @module multi-auth/fetch-wrapper
 */

import type { ProviderAdapter, TokenSet } from "./adapters/types"
import {
	effectivePriority,
	type ProviderConfig,
	type RetryReason,
} from "./config"
import {
	classifyAnthropic,
	type Classification,
	type ResponseLike,
} from "./detect"
import { refreshAccount } from "./refresh"
import { select, type SelectorAccount } from "./selector"
import type { MultiAuthStore, OAuthAccount, StoreData } from "./store"

// =============================================================================
// CONSTANTS
// =============================================================================

/** Inert apiKey sentinel used by the plugin entry — must never leave this process. */
export const PLACEHOLDER_API_KEY = "multi-auth-placeholder"

/** Short cooldown when a pre-dispatch refresh fails transiently (ms). */
const TRANSIENT_REFRESH_COOLDOWN_MS = 30_000

// =============================================================================
// TYPES
// =============================================================================

export type Logger = {
	debug?: (...args: unknown[]) => void
	info?: (...args: unknown[]) => void
	warn?: (...args: unknown[]) => void
	error?: (...args: unknown[]) => void
	log?: (...args: unknown[]) => void
}

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>

export type NotifyFn = (message: string) => void

export type CreateFetchWrapperOptions = {
	store: MultiAuthStore
	adapter: ProviderAdapter
	providerConfig: ProviderConfig
	/** Session id for stickyWithinSession affinity. */
	sessionId?: string
	/** Toast / UI notify hook (used when failover.notify === "toast"). */
	notify?: NotifyFn
	/** Injectable logger (default: console). Tests capture this for redaction. */
	logger?: Logger
	/** Injectable fetch (default: globalThis.fetch). */
	fetchImpl?: FetchLike
}

// =============================================================================
// REDACTION (S5)
// =============================================================================

const BEARER_RE = /Bearer\s+\S+/gi
const LONG_SECRET_RE =
	/\b(?:sk-|sk-ant-|access-|refresh-|rt-|at-)[A-Za-z0-9._\-/+=]{8,}\b/g
const JWTISH_RE =
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g

/**
 * Central redact helper — strips bearer tokens and secret-looking substrings.
 * Safe to apply to any log/notify string. Exported for status.ts.
 */
export function redact(str: string): string {
	if (!str) return str
	return str
		.replace(BEARER_RE, "Bearer [REDACTED]")
		.replace(LONG_SECRET_RE, "[REDACTED]")
		.replace(JWTISH_RE, "[REDACTED]")
		.replaceAll(PLACEHOLDER_API_KEY, "[REDACTED]")
}

// =============================================================================
// BODY BUFFERING (F2)
// =============================================================================

type BodyPrep = {
	/** Bytes to send / replay; null when no body or non-bufferable single-shot. */
	bytes: Uint8Array | null
	/** Original body for a single non-replayable pass-through attempt. */
	passthrough: BodyInit | null
	/** When true, never failover-retry (oversized or non-replayable). */
	singleAttempt: boolean
	/** Why single-attempt was forced (for logs). */
	singleAttemptReason?: string
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total)
	let offset = 0
	for (const c of chunks) {
		out.set(c, offset)
		offset += c.byteLength
	}
	return out
}

async function readStreamFully(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value && value.byteLength > 0) {
				chunks.push(value)
				total += value.byteLength
			}
		}
	} finally {
		try {
			reader.releaseLock()
		} catch {
			/* ignore */
		}
	}
	return concatChunks(chunks, total)
}

async function bufferBodyInit(
	body: BodyInit,
	maxBytes: number,
): Promise<BodyPrep> {
	if (typeof body === "string") {
		const bytes = new TextEncoder().encode(body)
		if (bytes.byteLength > maxBytes) {
			return {
				bytes,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes, passthrough: null, singleAttempt: false }
	}

	if (body instanceof Uint8Array) {
		if (body.byteLength > maxBytes) {
			return {
				bytes: body,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes: body, passthrough: null, singleAttempt: false }
	}

	if (body instanceof ArrayBuffer) {
		const bytes = new Uint8Array(body)
		if (bytes.byteLength > maxBytes) {
			return {
				bytes,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes, passthrough: null, singleAttempt: false }
	}

	if (ArrayBuffer.isView(body)) {
		const view = body as ArrayBufferView
		const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
		if (bytes.byteLength > maxBytes) {
			return {
				bytes,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes, passthrough: null, singleAttempt: false }
	}

	if (typeof Blob !== "undefined" && body instanceof Blob) {
		const bytes = new Uint8Array(await body.arrayBuffer())
		if (bytes.byteLength > maxBytes) {
			return {
				bytes,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes, passthrough: null, singleAttempt: false }
	}

	if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
		try {
			const bytes = await readStreamFully(body as ReadableStream<Uint8Array>)
			if (bytes.byteLength > maxBytes) {
				return {
					bytes,
					passthrough: null,
					singleAttempt: true,
					singleAttemptReason: "body_exceeds_max_replay",
				}
			}
			return { bytes, passthrough: null, singleAttempt: false }
		} catch {
			return {
				bytes: null,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "non_replayable_stream",
			}
		}
	}

	// FormData / URLSearchParams / unknown — try Request materialization
	try {
		const tmp = new Request("https://buffer.local/", { method: "POST", body })
		const bytes = new Uint8Array(await tmp.arrayBuffer())
		if (bytes.byteLength > maxBytes) {
			return {
				bytes,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "body_exceeds_max_replay",
			}
		}
		return { bytes, passthrough: null, singleAttempt: false }
	} catch {
		return {
			bytes: null,
			passthrough: body,
			singleAttempt: true,
			singleAttemptReason: "non_replayable_stream",
		}
	}
}

async function prepareRequestBody(
	request: Request,
	init: RequestInit | undefined,
	maxBytes: number,
): Promise<BodyPrep> {
	const method = (init?.method ?? request.method).toUpperCase()
	if (method === "GET" || method === "HEAD") {
		return { bytes: null, passthrough: null, singleAttempt: false }
	}

	const hasInitBody = init !== undefined && "body" in init && init.body != null
	if (hasInitBody) {
		return bufferBodyInit(init.body as BodyInit, maxBytes)
	}

	if (request.body) {
		try {
			return await bufferBodyInit(request.body, maxBytes)
		} catch {
			return {
				bytes: null,
				passthrough: null,
				singleAttempt: true,
				singleAttemptReason: "non_replayable_stream",
			}
		}
	}

	return { bytes: null, passthrough: null, singleAttempt: false }
}

// =============================================================================
// HEADERS / ORIGIN (F1)
// =============================================================================

function requestUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input
	if (input instanceof URL) return input.href
	return input.url
}

function originOf(urlStr: string): string {
	return new URL(urlStr).origin
}

function isAllowlistedOrigin(
	origin: string,
	apiOrigins: readonly string[],
): boolean {
	return (apiOrigins as readonly string[]).includes(origin)
}

/**
 * Strip placeholder / inert credentials. Removes x-api-key entirely and any
 * Authorization we did not set. Ensures the sentinel never appears in values.
 */
function sanitizeHeaders(source: Headers): Headers {
	const headers = new Headers(source)
	headers.delete("x-api-key")
	headers.delete("X-Api-Key")
	headers.delete("Authorization")
	headers.delete("authorization")

	for (const [key, value] of [...headers.entries()]) {
		if (value.includes(PLACEHOLDER_API_KEY)) {
			headers.delete(key)
		}
	}
	return headers
}

function headersFrom(
	input: string | URL | Request,
	init?: RequestInit,
): Headers {
	if (init?.headers) return new Headers(init.headers)
	if (input instanceof Request) return new Headers(input.headers)
	return new Headers()
}

// =============================================================================
// SELECTOR INPUTS
// =============================================================================

function buildSelectorAccounts(
	data: StoreData,
	providerConfig: ProviderConfig,
): SelectorAccount[] {
	const entries = Object.entries(data.accounts)
	return entries.map(([label, account], insertionIndex) => {
		const cfg = providerConfig.accounts.find((a) => a.label === label)
		let state = account.state
		if (cfg?.disabled) {
			state = "disabled"
		}
		return {
			label,
			priority: effectivePriority(label, providerConfig, insertionIndex),
			state,
			resetAt: account.resetAt,
			lastExhaustedAt: account.lastExhaustedAt,
			addedAt: account.addedAt,
		}
	})
}

// =============================================================================
// CLASSIFY / NOTIFY HELPERS
// =============================================================================

async function responseToLike(response: Response): Promise<ResponseLike> {
	const like: ResponseLike = {
		status: response.status,
		headers: response.headers,
	}
	// Mid-stream rule: only read a clone for non-2xx (classification may need body)
	if (response.status >= 400) {
		try {
			const text = await response.clone().text()
			if (text) {
				try {
					like.body = JSON.parse(text) as unknown
				} catch {
					// non-JSON
				}
			}
		} catch {
			// unreadable
		}
	}
	return like
}

function formatResetTime(resetAt: number | null): string {
	if (resetAt == null) return "unknown"
	try {
		return new Date(resetAt).toISOString()
	} catch {
		return String(resetAt)
	}
}

function syntheticAllExhaustedResponse(
	earliestResetAt: number | null,
): Response {
	const body = JSON.stringify({
		type: "error",
		error: {
			type: "rate_limit_error",
			message: `all accounts exhausted; earliest reset at ${formatResetTime(earliestResetAt)}`,
		},
	})
	return new Response(body, {
		status: 429,
		headers: { "content-type": "application/json" },
	})
}

function earliestResetFromStore(
	data: StoreData,
	providerConfig: ProviderConfig,
): number | null {
	const accounts = buildSelectorAccounts(data, providerConfig)
	// All labels excluded → select reports earliest among cooling_down
	const allLabels = new Set(accounts.map((a) => a.label))
	const result = select(
		accounts,
		{ stickyWithinSession: false },
		Date.now(),
		{ exclude: allLabels },
	)
	return result.ok ? null : result.earliestResetAt
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a `fetch`-compatible function that multiplexes multi-auth accounts.
 */
export function createFetchWrapper(
	options: CreateFetchWrapperOptions,
): FetchLike {
	const {
		store,
		adapter,
		providerConfig,
		sessionId: _sessionId,
		notify,
		logger = console,
		fetchImpl = globalThis.fetch.bind(globalThis),
	} = options

	const apiOrigins = adapter.apiOrigins
	const failover = providerConfig.failover

	/** Last label that successfully served a request (stickyWithinSession). */
	let sessionAffinity: string | undefined

	const log = {
		debug: (...args: unknown[]) => {
			const msg = args.map(String).join(" ")
			;(logger.debug ?? logger.log)?.(redact(msg))
		},
		info: (...args: unknown[]) => {
			const msg = args.map(String).join(" ")
			;(logger.info ?? logger.log)?.(redact(msg))
		},
		warn: (...args: unknown[]) => {
			const msg = args.map(String).join(" ")
			;(logger.warn ?? logger.log)?.(redact(msg))
		},
		error: (...args: unknown[]) => {
			const msg = args.map(String).join(" ")
			;(logger.error ?? logger.log)?.(redact(msg))
		},
	}

	function emitNotify(message: string): void {
		const safe = redact(message)
		const mode = failover.notify
		if (mode === "silent") return
		if (mode === "log") {
			log.info(safe)
			return
		}
		// toast
		if (notify) {
			notify(safe)
		} else {
			log.info(safe)
		}
	}

	async function persistTokens(label: string, tokens: TokenSet): Promise<void> {
		await store.mutate((data) => {
			const account = data.accounts[label]
			if (!account) {
				throw new Error(`Unknown account label: ${JSON.stringify(label)}`)
			}
			account.access = tokens.access
			account.refresh = tokens.refresh
			account.expires = tokens.expires
		})
	}

	async function doRefresh(label: string, account: OAuthAccount) {
		return refreshAccount({
			label,
			refreshToken: account.refresh,
			attempt: (rt) => adapter.refresh(rt),
			persist: (tokens) => persistTokens(label, tokens),
		})
	}

	async function markNeedsReauth(label: string): Promise<void> {
		await store.setState(label, "needs_reauth", null)
		log.info(`account ${label} marked needs_reauth`)
	}

	async function markExhausted(
		label: string,
		classification: Extract<Classification, { kind: "exhausted" }>,
		now: number,
	): Promise<void> {
		const resetAt =
			classification.resetAtMs ??
			(classification.cooldownSeconds > 0
				? now + classification.cooldownSeconds * 1000
				: now + providerConfig.defaultCooldownSeconds * 1000)
		await store.mutate((data) => {
			const account = data.accounts[label]
			if (!account) return
			account.state = "cooling_down"
			account.resetAt = resetAt
			account.lastExhaustedAt = now
		})
		log.info(
			`account ${label} cooling_down until ${formatResetTime(resetAt)} (${classification.reason})`,
		)
	}

	async function markTransientRefreshCooldown(
		label: string,
		now: number,
	): Promise<void> {
		const resetAt = now + TRANSIENT_REFRESH_COOLDOWN_MS
		await store.setState(label, "cooling_down", resetAt)
		log.info(
			`account ${label} transient refresh cooldown until ${formatResetTime(resetAt)}`,
		)
	}

	/**
	 * Ensure access token is fresh. Returns access string, or null if account
	 * should be skipped (needs_reauth / transient cooldown already applied).
	 * Sets `justRefreshed` out-param via object.
	 */
	async function ensureFreshAccess(
		label: string,
		account: OAuthAccount,
		now: number,
		state: { justRefreshed: boolean },
	): Promise<string | null> {
		const skewMs = providerConfig.refreshSkewSeconds * 1000
		if (account.expires >= now + skewMs) {
			return account.access
		}

		log.info(`refreshing token for account ${label}`)
		const result = await doRefresh(label, account)

		if (result.outcome === "ok") {
			state.justRefreshed = true
			return result.access
		}
		if (result.outcome === "needs_reauth") {
			await markNeedsReauth(label)
			return null
		}
		await markTransientRefreshCooldown(label, now)
		return null
	}

	const wrappedFetch: FetchLike = async (input, init) => {
		const url = requestUrl(input)
		let origin: string
		try {
			origin = originOf(url)
		} catch {
			return fetchImpl(input, init)
		}

		const allowlisted = isAllowlistedOrigin(origin, apiOrigins)

		// F1: non-allowlisted — strip credentials, no fallback, pass through
		if (!allowlisted) {
			const headers = sanitizeHeaders(headersFrom(input, init))
			if (input instanceof Request) {
				return fetchImpl(url, {
					method: init?.method ?? input.method,
					headers,
					body: init?.body !== undefined ? init.body : input.body,
					redirect: init?.redirect ?? input.redirect,
					signal: init?.signal ?? input.signal,
				})
			}
			return fetchImpl(url, { ...init, headers })
		}

		// --- Allowlisted: full multi-auth path ---

		const baseHeaders = sanitizeHeaders(headersFrom(input, init))
		const method =
			(init?.method ??
				(input instanceof Request ? input.method : "GET") ??
				"GET") as string

		const baseRequest =
			input instanceof Request
				? input
				: new Request(url, { ...init, method, headers: baseHeaders })

		const bodyPrep = await prepareRequestBody(
			baseRequest,
			init,
			failover.maxReplayBodyBytes,
		)

		if (bodyPrep.singleAttempt) {
			log.info(
				`single-attempt request: ${bodyPrep.singleAttemptReason ?? "non_replayable"} (no failover replay)`,
			)
		}

		const exclude = new Set<string>()
		let attempts = 0
		let lastResponse: Response | null = null
		let lastExhaustedResponse: Response | null = null
		/** Prefer this label next (auth_stale same-account retry). */
		let preferLabel: string | null = null
		const refreshState = { justRefreshed: false }

		const maxAttempts = Math.max(1, failover.maxAttemptsPerRequest)

		while (attempts < maxAttempts) {
			const now = Date.now()
			const data = await store.readCached()
			refreshState.justRefreshed = false

			let label: string
			let account: OAuthAccount

			if (preferLabel && data.accounts[preferLabel] && !exclude.has(preferLabel)) {
				label = preferLabel
				account = data.accounts[preferLabel]!
				preferLabel = null
				refreshState.justRefreshed = true // coming from auth_stale refresh
			} else {
				preferLabel = null
				const selectorAccounts = buildSelectorAccounts(data, providerConfig)
				const selected = select(
					selectorAccounts,
					{ stickyWithinSession: providerConfig.stickyWithinSession },
					now,
					{
						sessionAffinity: providerConfig.stickyWithinSession
							? sessionAffinity
							: undefined,
						exclude,
					},
				)

				if (!selected.ok) {
					const n = Object.keys(data.accounts).length
					const msg = `all ${n} accounts exhausted, earliest reset at ${formatResetTime(selected.earliestResetAt)}`
					emitNotify(msg)
					log.warn(msg)
					return (
						lastExhaustedResponse ??
						lastResponse ??
						syntheticAllExhaustedResponse(selected.earliestResetAt)
					)
				}

				label = selected.account.label
				const acct = data.accounts[label]
				if (!acct) {
					exclude.add(label)
					continue
				}
				account = acct
			}

			const access = await ensureFreshAccess(label, account, now, refreshState)
			if (access == null) {
				exclude.add(label)
				continue
			}

			// Dispatch
			const headers = new Headers(baseHeaders)
			headers.set("Authorization", `Bearer ${access}`)

			for (const [key, value] of [...headers.entries()]) {
				if (value.includes(PLACEHOLDER_API_KEY)) {
					if (key.toLowerCase() === "authorization") {
						headers.set("Authorization", `Bearer ${access}`)
					} else {
						headers.delete(key)
					}
				}
			}

			let body: BodyInit | undefined
			if (bodyPrep.bytes) {
				body = bodyPrep.bytes.slice()
			} else if (bodyPrep.passthrough && attempts === 0) {
				body = bodyPrep.passthrough
			}

			const reqInit: RequestInit = {
				method,
				headers,
				body,
				redirect: "manual",
			}

			let response: Response
			try {
				response = await fetchImpl(url, reqInit)
			} catch (err) {
				log.warn(
					`network error on account ${label}: ${err instanceof Error ? err.message : "error"}`,
				)
				throw err
			}

			attempts += 1
			lastResponse = response

			// F1: 3xx — surface as error, never follow
			if (response.status >= 300 && response.status < 400) {
				log.warn(
					`credentialed request returned redirect ${response.status}; not following`,
				)
				const err = new Error(
					`multi-auth: unexpected redirect ${response.status} from credentialed request (redirect:manual)`,
				)
				;(err as Error & { response: Response }).response = response
				throw err
			}

			// Success
			if (response.status >= 200 && response.status < 300) {
				await store.touchLastUsed(label, now)
				sessionAffinity = label
				log.debug(`account ${label} served request successfully`)
				return response
			}

			// Classify
			const like = await responseToLike(response)
			const classification = classifyAnthropic(like, {
				justRefreshed: refreshState.justRefreshed,
				defaultCooldownSeconds: providerConfig.defaultCooldownSeconds,
				maxCooldownSeconds: providerConfig.maxCooldownSeconds,
				now,
			})

			if (classification.kind === "none" || classification.kind === "transient") {
				if (classification.kind === "transient") {
					log.info(
						`transient response ${response.status} on account ${label}; passing through`,
					)
				}
				return response
			}

			if (classification.kind === "auth_stale") {
				log.info(`auth_stale on account ${label}; refreshing once`)
				const freshData = await store.readCached()
				const freshAcct = freshData.accounts[label]
				if (!freshAcct) {
					exclude.add(label)
					continue
				}
				const rr = await doRefresh(label, freshAcct)
				if (rr.outcome === "ok") {
					preferLabel = label
					// Do not exclude; retry same account with justRefreshed
					// Count against maxAttempts via attempts already incremented
					if (bodyPrep.singleAttempt) {
						// still allow same-account auth retry? Spec: single-attempt is about
						// failover body replay. Auth refresh on same account is OK once.
					}
					continue
				}
				if (rr.outcome === "needs_reauth") {
					await markNeedsReauth(label)
				} else {
					await markTransientRefreshCooldown(label, now)
				}
				exclude.add(label)
				if (bodyPrep.singleAttempt) return response
				continue
			}

			if (classification.kind === "needs_reauth") {
				await markNeedsReauth(label)
				emitNotify(`account ${label} needs re-authentication`)
				exclude.add(label)
				if (bodyPrep.singleAttempt) return response
				continue
			}

			// exhausted
			if (classification.kind === "exhausted") {
				await markExhausted(label, classification, now)
				lastExhaustedResponse = response
				const reason = classification.reason as RetryReason
				emitNotify(
					`account ${label} exhausted (${reason}); reset at ${formatResetTime(classification.resetAtMs)}`,
				)
				exclude.add(label)

				const canFailover =
					!bodyPrep.singleAttempt &&
					attempts < maxAttempts &&
					failover.retryOn.includes(reason)

				if (!canFailover) {
					// Exhaustion recorded; if no more attempts or single-attempt, may still
					// try to see if loop ends — for single-attempt return immediately.
					if (bodyPrep.singleAttempt || attempts >= maxAttempts) {
						// Check whether any accounts remain; if not, notify all-exhausted
						const after = await store.readCached()
						const remaining = select(
							buildSelectorAccounts(after, providerConfig),
							{ stickyWithinSession: false },
							Date.now(),
							{ exclude },
						)
						if (!remaining.ok) {
							const n = Object.keys(after.accounts).length
							const msg = `all ${n} accounts exhausted, earliest reset at ${formatResetTime(remaining.earliestResetAt)}`
							emitNotify(msg)
							log.warn(msg)
						}
						return response
					}
					// reason not in retryOn — return this response (don't burn other accounts for non-retry reasons)
					if (!failover.retryOn.includes(reason)) {
						return response
					}
				}
				continue
			}

			return response
		}

		// Max attempts
		const data = await store.readCached()
		const n = Object.keys(data.accounts).length
		const earliest = earliestResetFromStore(data, providerConfig)
		const msg = `all ${n} accounts exhausted, earliest reset at ${formatResetTime(earliest)}`
		emitNotify(msg)
		log.warn(msg)
		return (
			lastExhaustedResponse ??
			lastResponse ??
			syntheticAllExhaustedResponse(earliest)
		)
	}

	return wrappedFetch
}

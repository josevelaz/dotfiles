/**
 * Anthropic Claude Pro/Max OAuth adapter (PKCE + token refresh).
 *
 * Endpoints/client ID match opencode-anthropic-auth / Claude Code OAuth:
 * - authorize: https://claude.ai/oauth/authorize
 * - token:     https://console.anthropic.com/v1/oauth/token
 * - client_id: 9d1c250a-e61b-44d9-88ed-5944d1962f5e
 * - redirect (manual): https://console.anthropic.com/oauth/code/callback
 * - scopes: org:create_api_key user:profile user:inference
 *
 * F1: API origins are a frozen hardcoded constant.
 * F5: S256 PKCE, ≥256-bit CSPRNG verifier, single-use constant-time state,
 *     127.0.0.1 loopback with exact-match redirect URI, manual code never logged.
 *
 * @module multi-auth/adapters/anthropic
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import * as http from "node:http"
import { URL } from "node:url"
import { TimeoutError, withTimeout } from "../../kdco-primitives/with-timeout"
import type {
	AuthorizeDeps,
	AuthorizeResult,
	FetchLike,
	ProviderAdapter,
	RefreshDeps,
	RefreshResult,
	TokenSet,
} from "./types"

// =============================================================================
// F1 — HARDCODED ORIGIN ALLOWLIST (non-configurable)
// =============================================================================

/** F1: frozen API origins — never extend via config or function params. */
export const ANTHROPIC_API_ORIGINS = Object.freeze([
	"https://api.anthropic.com",
] as const)

// =============================================================================
// OAUTH CONSTANTS (production defaults)
// =============================================================================

export const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
export const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
export const ANTHROPIC_TOKEN_URL =
	"https://console.anthropic.com/v1/oauth/token"
/** Manual-code mode redirect (registered with Anthropic OAuth client). */
export const ANTHROPIC_MANUAL_REDIRECT_URI =
	"https://console.anthropic.com/oauth/code/callback"
export const ANTHROPIC_SCOPES =
	"org:create_api_key user:profile user:inference"

const LOOPBACK_PATH = "/oauth/callback"
const DEFAULT_AUTHORIZE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_TOKEN_TIMEOUT_MS = 15_000

/**
 * Authorization code format (optional `#state` suffix as used by Claude OAuth).
 * Deliberately strict so garbage paste is rejected before any network call.
 */
export const AUTH_CODE_RE =
	/^[A-Za-z0-9._~-]{8,512}(?:#[A-Za-z0-9._~-]{8,512})?$/

// =============================================================================
// PKCE / CRYPTO HELPERS (F5)
// =============================================================================

function base64url(buf: Buffer): string {
	return buf.toString("base64url")
}

/** CSPRNG code verifier with ≥256 bits entropy (32 bytes → base64url). */
export function generateCodeVerifier(): string {
	return base64url(randomBytes(32))
}

/** S256 code_challenge = BASE64URL(SHA256(verifier)). */
export function s256Challenge(verifier: string): string {
	return base64url(createHash("sha256").update(verifier, "utf8").digest())
}

/** CSPRNG single-use OAuth `state` (≥256 bits). */
export function generateState(): string {
	return base64url(randomBytes(32))
}

/**
 * Constant-time string compare. Returns false when lengths differ
 * (length is not secret for our random state tokens).
 */
export function constantTimeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a, "utf8")
	const bb = Buffer.from(b, "utf8")
	if (ba.length !== bb.length) return false
	return timingSafeEqual(ba, bb)
}

export function isValidAuthCodeFormat(code: string): boolean {
	return AUTH_CODE_RE.test(code)
}

// =============================================================================
// LOOPBACK LISTENER (F5)
// =============================================================================

type LoopbackResult =
	| { ok: true; code: string; state: string }
	| { ok: false; reason: string }

type LoopbackServer = {
	redirectUri: string
	port: number
	wait: () => Promise<LoopbackResult>
	close: () => Promise<void>
}

/**
 * Bind an HTTP listener to 127.0.0.1 (never 0.0.0.0) on an ephemeral port.
 * Accepts exactly one valid callback; enforces exact-match redirect URI
 * (host + port + path) and single-use state.
 */
export function startLoopbackListener(expectedState: string): Promise<LoopbackServer> {
	return new Promise((resolve, reject) => {
		let settled = false
		let stateConsumed = false
		let resolveWait: ((r: LoopbackResult) => void) | null = null
		let result: LoopbackResult | null = null

		const server = http.createServer((req, res) => {
			try {
				const host = req.headers.host ?? `127.0.0.1:${port}`
				const url = new URL(req.url ?? "/", `http://${host}`)

				// Exact-match redirect URI: path must be LOOPBACK_PATH; host must be 127.0.0.1
				const requestOrigin = `http://${host}`
				const expectedOrigin = `http://127.0.0.1:${port}`
				if (
					url.pathname !== LOOPBACK_PATH ||
					requestOrigin !== expectedOrigin
				) {
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("Invalid redirect URI")
					// Do not settle wait on wrong path — attacker probe
					return
				}

				if (stateConsumed || settled) {
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("State already used")
					if (!settled) {
						settled = true
						const r: LoopbackResult = {
							ok: false,
							reason: "state_reused",
						}
						result = r
						resolveWait?.(r)
					}
					return
				}

				const code = url.searchParams.get("code")
				const state = url.searchParams.get("state")
				const err = url.searchParams.get("error")

				if (err) {
					stateConsumed = true
					settled = true
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("Authorization denied")
					const r: LoopbackResult = {
						ok: false,
						reason: "authorization_denied",
					}
					result = r
					resolveWait?.(r)
					return
				}

				if (!code || !state) {
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("Missing code or state")
					return
				}

				if (!constantTimeEqual(state, expectedState)) {
					// Do not consume state on mismatch (CSRF probe) — but reject this request
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("Invalid state")
					if (!settled) {
						settled = true
						const r: LoopbackResult = {
							ok: false,
							reason: "state_mismatch",
						}
						result = r
						resolveWait?.(r)
					}
					return
				}

				if (!isValidAuthCodeFormat(code)) {
					res.writeHead(400, { "Content-Type": "text/plain" })
					res.end("Invalid code format")
					if (!settled) {
						settled = true
						const r: LoopbackResult = {
							ok: false,
							reason: "invalid_code_format",
						}
						result = r
						resolveWait?.(r)
					}
					return
				}

				stateConsumed = true
				settled = true
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
				res.end(
					"<!doctype html><title>Authorized</title><body>You may close this window.</body>",
				)
				const r: LoopbackResult = { ok: true, code, state }
				result = r
				resolveWait?.(r)
			} catch {
				res.writeHead(500, { "Content-Type": "text/plain" })
				res.end("Internal error")
			}
		})

		let port = 0

		server.on("error", (err) => {
			reject(err)
		})

		// F5: bind to 127.0.0.1 only — never 0.0.0.0
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address()
			if (!addr || typeof addr === "string") {
				server.close()
				reject(new Error("Failed to bind loopback listener"))
				return
			}
			port = addr.port
			const redirectUri = `http://127.0.0.1:${port}${LOOPBACK_PATH}`

			resolve({
				redirectUri,
				port,
				wait: () =>
					new Promise<LoopbackResult>((res) => {
						if (result) {
							res(result)
							return
						}
						resolveWait = res
					}),
				close: () =>
					new Promise<void>((res) => {
						server.close(() => res())
					}),
			})
		})
	})
}

// =============================================================================
// TOKEN EXCHANGE
// =============================================================================

type TokenJson = {
	access_token?: string
	refresh_token?: string
	expires_in?: number
	error?: string
	error_description?: string
}

async function parseTokenResponse(
	response: Response,
): Promise<
	| { ok: true; tokens: TokenSet }
	| {
			ok: false
			outcome: "needs_reauth" | "transient"
			error?: string
	  }
> {
	let body: TokenJson = {}
	const text = await response.text()
	try {
		body = text ? (JSON.parse(text) as TokenJson) : {}
	} catch {
		// non-JSON body
	}

	const errorCode =
		typeof body.error === "string" ? body.error : undefined

	// F4: only explicit invalid_grant → needs_reauth
	if (errorCode === "invalid_grant") {
		return { ok: false, outcome: "needs_reauth", error: "invalid_grant" }
	}

	if (!response.ok) {
		// 5xx / unknown error codes → transient (caller may retry)
		return {
			ok: false,
			outcome: "transient",
			error: errorCode
				? `token_error:${errorCode}`
				: `http_${response.status}`,
		}
	}

	if (
		typeof body.access_token !== "string" ||
		typeof body.refresh_token !== "string" ||
		typeof body.expires_in !== "number"
	) {
		return {
			ok: false,
			outcome: "transient",
			error: "malformed_token_response",
		}
	}

	return {
		ok: true,
		tokens: {
			access: body.access_token,
			refresh: body.refresh_token,
			expires: Date.now() + body.expires_in * 1000,
		},
	}
}

async function exchangeAuthorizationCode(opts: {
	code: string
	state: string
	codeVerifier: string
	redirectUri: string
	tokenUrl: string
	clientId: string
	fetchImpl: FetchLike
	timeoutMs: number
}): Promise<AuthorizeResult> {
	// Split optional code#state paste form; never log either part
	const splits = opts.code.split("#")
	const codeOnly = splits[0]!
	const stateFromCode = splits[1]

	// If paste included state, prefer it only when it matches (constant-time)
	const state = stateFromCode ?? opts.state
	if (stateFromCode && !constantTimeEqual(stateFromCode, opts.state)) {
		return { type: "failed", reason: "state_mismatch" }
	}

	try {
		const response = await withTimeout(
			opts.fetchImpl(opts.tokenUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					code: codeOnly,
					state,
					grant_type: "authorization_code",
					client_id: opts.clientId,
					redirect_uri: opts.redirectUri,
					code_verifier: opts.codeVerifier,
				}),
			}),
			opts.timeoutMs,
			"Token exchange timed out",
		)

		const parsed = await parseTokenResponse(response)
		if (!parsed.ok) {
			return {
				type: "failed",
				reason: parsed.error ?? parsed.outcome,
			}
		}
		return {
			type: "success",
			label: "", // filled by caller
			...parsed.tokens,
		}
	} catch (err) {
		if (err instanceof TimeoutError) {
			return { type: "failed", reason: "timeout" }
		}
		return { type: "failed", reason: "network_error" }
	}
}

// =============================================================================
// BUILD AUTHORIZE URL
// =============================================================================

export function buildAuthorizeUrl(opts: {
	authorizeUrl: string
	clientId: string
	redirectUri: string
	scopes: string
	codeChallenge: string
	state: string
}): string {
	const url = new URL(opts.authorizeUrl)
	url.searchParams.set("code", "true")
	url.searchParams.set("client_id", opts.clientId)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("redirect_uri", opts.redirectUri)
	url.searchParams.set("scope", opts.scopes)
	url.searchParams.set("code_challenge", opts.codeChallenge)
	url.searchParams.set("code_challenge_method", "S256")
	url.searchParams.set("state", opts.state)
	return url.toString()
}

// =============================================================================
// ADAPTER
// =============================================================================

export type AnthropicAdapterOptions = {
	/** Default fetch for authorize/refresh (injectable). */
	fetch?: FetchLike
}

export function createAnthropicAdapter(
	options: AnthropicAdapterOptions = {},
): ProviderAdapter {
	const defaultFetch: FetchLike = options.fetch ?? globalThis.fetch.bind(globalThis)

	const adapter: ProviderAdapter = {
		providerId: "anthropic",
		apiOrigins: ANTHROPIC_API_ORIGINS,

		async authorize(
			input: { label: string },
			deps: AuthorizeDeps = {},
		): Promise<AuthorizeResult> {
			const label = input.label?.trim()
			if (!label) {
				return { type: "failed", reason: "label_required" }
			}

			const fetchImpl = deps.fetch ?? defaultFetch
			const timeoutMs = deps.timeoutMs ?? DEFAULT_AUTHORIZE_TIMEOUT_MS
			const ep = deps._endpoints ?? {}

			const authorizeUrl = ep.authorizeUrl ?? ANTHROPIC_AUTHORIZE_URL
			const tokenUrl = ep.tokenUrl ?? ANTHROPIC_TOKEN_URL
			const clientId = ep.clientId ?? ANTHROPIC_CLIENT_ID
			const scopes = ep.scopes ?? ANTHROPIC_SCOPES
			const manualOnly = ep.manualOnly === true

			const verifier = generateCodeVerifier()
			const challenge = s256Challenge(verifier)
			const state = generateState()

			let loopback: LoopbackServer | null = null
			let redirectUri: string

			try {
				if (manualOnly) {
					redirectUri = ep.redirectUri ?? ANTHROPIC_MANUAL_REDIRECT_URI
				} else {
					loopback = await startLoopbackListener(state)
					redirectUri = ep.redirectUri ?? loopback.redirectUri
				}

				const url = buildAuthorizeUrl({
					authorizeUrl,
					clientId,
					redirectUri,
					scopes,
					codeChallenge: challenge,
					state,
				})

				await deps.onReady?.({
					authorizeUrl: url,
					redirectUri,
					state,
					codeChallenge: challenge,
					codeChallengeMethod: "S256",
				})

				if (deps.openUrl) {
					await deps.openUrl(url)
				}

				// Race: loopback callback vs manual code paste
				const codePromise = (async (): Promise<
					| { source: "loopback"; code: string; state: string }
					| { source: "manual"; code: string }
					| { source: "fail"; reason: string }
				> => {
					const tasks: Promise<
						| { source: "loopback"; code: string; state: string }
						| { source: "manual"; code: string }
						| { source: "fail"; reason: string }
					>[] = []

					if (loopback) {
						tasks.push(
							loopback.wait().then((r) => {
								if (r.ok) {
									return {
										source: "loopback" as const,
										code: r.code,
										state: r.state,
									}
								}
								return {
									source: "fail" as const,
									reason: r.reason,
								}
							}),
						)
					}

					if (deps.promptCode) {
						tasks.push(
							deps.promptCode().then((pasted) => {
								if (pasted === null || pasted === undefined) {
									return {
										source: "fail" as const,
										reason: "manual_cancelled",
									}
								}
								const trimmed = pasted.trim()
								// F5: validate format before use; never log the code
								if (!isValidAuthCodeFormat(trimmed)) {
									return {
										source: "fail" as const,
										reason: "invalid_code_format",
									}
								}
								return {
									source: "manual" as const,
									code: trimmed,
								}
							}),
						)
					}

					if (tasks.length === 0) {
						return {
							source: "fail",
							reason: "no_code_source",
						}
					}

					// First successful code wins; failures from one path don't cancel the other
					// until timeout. Use Promise.any-like with filter.
					return await new Promise((resolve) => {
						let pending = tasks.length
						let lastFail = "no_code_source"
						for (const t of tasks) {
							void t.then((r) => {
								if (r.source === "fail") {
									lastFail = r.reason
									pending -= 1
									if (pending === 0) {
										resolve({
											source: "fail",
											reason: lastFail,
										})
									}
									return
								}
								resolve(r)
							})
						}
					})
				})()

				const raced = await withTimeout(
					codePromise,
					timeoutMs,
					"Authorization timed out",
				).catch((err) => {
					if (err instanceof TimeoutError) {
						return {
							source: "fail" as const,
							reason: "timeout",
						}
					}
					return {
						source: "fail" as const,
						reason: "authorize_error",
					}
				})

				if (raced.source === "fail") {
					return { type: "failed", reason: raced.reason }
				}

				// Manual mode uses the registered console redirect when not loopback
				const exchangeRedirect =
					raced.source === "manual" && manualOnly
						? redirectUri
						: redirectUri

				const exchanged = await exchangeAuthorizationCode({
					code: raced.code,
					state:
						raced.source === "loopback" ? raced.state : state,
					codeVerifier: verifier,
					redirectUri: exchangeRedirect,
					tokenUrl,
					clientId,
					fetchImpl,
					timeoutMs: DEFAULT_TOKEN_TIMEOUT_MS,
				})

				if (exchanged.type === "failed") {
					return exchanged
				}

				return {
					type: "success",
					label,
					access: exchanged.access,
					refresh: exchanged.refresh,
					expires: exchanged.expires,
				}
			} catch (err) {
				const msg =
					err instanceof Error ? err.message : "authorize_error"
				// Never include potential secrets from error messages that might echo codes
				return {
					type: "failed",
					reason: msg.includes("timed out") ? "timeout" : "authorize_error",
				}
			} finally {
				if (loopback) {
					await loopback.close().catch(() => {})
				}
			}
		},

		async refresh(
			refreshToken: string,
			deps: RefreshDeps = {},
		): Promise<RefreshResult> {
			if (!refreshToken || typeof refreshToken !== "string") {
				return {
					outcome: "needs_reauth",
					error: "missing_refresh_token",
				}
			}

			const fetchImpl = deps.fetch ?? defaultFetch
			const timeoutMs = deps.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS
			const ep = deps._endpoints ?? {}
			const tokenUrl = ep.tokenUrl ?? ANTHROPIC_TOKEN_URL
			const clientId = ep.clientId ?? ANTHROPIC_CLIENT_ID

			try {
				const response = await withTimeout(
					fetchImpl(tokenUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							grant_type: "refresh_token",
							refresh_token: refreshToken,
							client_id: clientId,
						}),
					}),
					timeoutMs,
					"Token refresh timed out",
				)

				const parsed = await parseTokenResponse(response)
				if (!parsed.ok) {
					if (parsed.outcome === "needs_reauth") {
						return {
							outcome: "needs_reauth",
							error: parsed.error,
						}
					}
					return {
						outcome: "transient",
						error: parsed.error,
						attempts: 1,
					}
				}
				return {
					outcome: "ok",
					...parsed.tokens,
				}
			} catch (err) {
				if (err instanceof TimeoutError) {
					return {
						outcome: "transient",
						error: "timeout",
						attempts: 1,
					}
				}
				return {
					outcome: "transient",
					error: "network_error",
					attempts: 1,
				}
			}
		},
	}

	return adapter
}

/** Default singleton adapter instance. */
export const anthropicAdapter = createAnthropicAdapter()

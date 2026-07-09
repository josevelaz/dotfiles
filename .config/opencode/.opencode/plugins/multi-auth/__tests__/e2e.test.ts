/**
 * End-to-end integration: real createFetchWrapper + MultiAuthStore + parseConfig
 * against a fake Anthropic-shaped HTTP server (Bun.serve on 127.0.0.1).
 *
 * Scenario matrix
 * ---------------
 * 1. Priority order — fresh state → requests go to acct-a (priority 1).
 * 2. Fallback — server 429s acct-a (retry-after: 2s) → same request succeeds
 *    via acct-b; store shows acct-a cooling_down with resetAt ≈ now + 2s.
 * 3. Cooldown persistence — subsequent requests keep using acct-b while
 *    acct-a is cooling_down.
 * 4. Failback after reset — sleep past resetAt + server stops 429ing → next
 *    request goes back to acct-a. (No `_now` inject on fetch-wrapper; real sleep.)
 * 5. All exhausted — server 429s both tokens → wrapper returns 429; both
 *    accounts cooling_down; notify fired with earliest reset.
 * 6. Byte-identical replay — POST body; on fallback the server receives
 *    identical bytes on both attempts.
 *
 * Constraints: no production code changes; adapter is a ProviderAdapter
 * object literal with apiOrigins frozen to the fake server origin (createAnthropicAdapter
 * has no origin override). Tokens are non-expiring so refresh is never hit.
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { ProviderAdapter } from "../adapters/types"
import { parseConfig } from "../config"
import { createFetchWrapper, PLACEHOLDER_API_KEY } from "../fetch-wrapper"
import { MultiAuthStore, type OAuthAccount } from "../store"

// =============================================================================
// CONSTANTS
// =============================================================================

const TOKEN_A = "access-token-acct-a-e2e-SECRET"
const TOKEN_B = "access-token-acct-b-e2e-SECRET"
const RETRY_AFTER_SECONDS = 2
/** Tolerance for resetAt ≈ now + retry-after (ms). */
const RESET_AT_TOLERANCE_MS = 1_500

// =============================================================================
// FAKE ANTHROPIC SERVER
// =============================================================================

type CapturedServerRequest = {
	method: string
	path: string
	authorization: string | null
	bearer: string | null
	body: Uint8Array
	bodyText: string
}

type FakeServer = {
	origin: string
	url: (p: string) => string
	requests: CapturedServerRequest[]
	/** Tokens that should receive 429 after `afterCount` successful-or-any hits. */
	setRateLimit: (token: string, opts: { afterCount?: number; retryAfterSeconds?: number }) => void
	clearRateLimit: (token?: string) => void
	/** When true, every request for listed tokens is 429 (ignores afterCount). */
	rateLimitAlways: (tokens: string[], retryAfterSeconds?: number) => void
	stop: () => Promise<void>
}

type RateLimitRule = {
	/** 429 starting at this 1-based request count for the token (inclusive). */
	afterCount: number
	retryAfterSeconds: number
	/** If true, always 429 regardless of count. */
	always: boolean
	hitCount: number
}

function successBody(): string {
	return JSON.stringify({
		id: "msg_e2e_ok",
		type: "message",
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		model: "claude-e2e",
		stop_reason: "end_turn",
		usage: { input_tokens: 1, output_tokens: 1 },
	})
}

function rateLimitBody(): string {
	return JSON.stringify({
		type: "error",
		error: {
			type: "rate_limit_error",
			message: "Rate limited (e2e fake)",
		},
	})
}

function extractBearer(auth: string | null): string | null {
	if (!auth) return null
	const m = /^Bearer\s+(\S+)/i.exec(auth)
	return m?.[1] ?? null
}

async function startFakeAnthropicServer(): Promise<FakeServer> {
	const requests: CapturedServerRequest[] = []
	const rules = new Map<string, RateLimitRule>()

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url)
			const authorization = req.headers.get("authorization")
			const bearer = extractBearer(authorization)
			const bodyBuf = new Uint8Array(await req.arrayBuffer())
			const bodyText = new TextDecoder().decode(bodyBuf)

			requests.push({
				method: req.method,
				path: url.pathname,
				authorization,
				bearer,
				body: bodyBuf,
				bodyText,
			})

			// Only /v1/messages is the API surface under test
			if (url.pathname !== "/v1/messages") {
				return new Response(JSON.stringify({ error: "not_found" }), {
					status: 404,
					headers: { "content-type": "application/json" },
				})
			}

			if (bearer) {
				const rule = rules.get(bearer)
				if (rule) {
					rule.hitCount += 1
					const should429 =
						rule.always || rule.hitCount >= rule.afterCount
					if (should429) {
						const resetEpochSec = Math.floor(
							Date.now() / 1000 + rule.retryAfterSeconds,
						)
						return new Response(rateLimitBody(), {
							status: 429,
							headers: {
								"content-type": "application/json",
								"retry-after": String(rule.retryAfterSeconds),
								"anthropic-ratelimit-unified-reset": String(resetEpochSec),
								"anthropic-ratelimit-unified-status": "rejected",
							},
						})
					}
				}
			}

			return new Response(successBody(), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		},
	})

	const origin = `http://127.0.0.1:${server.port}`

	return {
		origin,
		url: (p: string) => `${origin}${p.startsWith("/") ? p : `/${p}`}`,
		requests,
		setRateLimit(token, opts = {}) {
			rules.set(token, {
				afterCount: opts.afterCount ?? 1,
				retryAfterSeconds: opts.retryAfterSeconds ?? RETRY_AFTER_SECONDS,
				always: false,
				hitCount: 0,
			})
		},
		clearRateLimit(token) {
			if (token) rules.delete(token)
			else rules.clear()
		},
		rateLimitAlways(tokens, retryAfterSeconds = RETRY_AFTER_SECONDS) {
			for (const t of tokens) {
				rules.set(t, {
					afterCount: 1,
					retryAfterSeconds,
					always: true,
					hitCount: 0,
				})
			}
		},
		async stop() {
			server.stop(true)
		},
	}
}

// =============================================================================
// FIXTURE HELPERS
// =============================================================================

const tempDirs: string[] = []
const servers: FakeServer[] = []

afterEach(async () => {
	while (servers.length > 0) {
		const s = servers.pop()
		if (s) await s.stop().catch(() => {})
	}
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
	}
})

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-auth-e2e-"))
	tempDirs.push(dir)
	return dir
}

function oauthAccount(access: string, addedAt: number): OAuthAccount {
	return {
		type: "oauth",
		access,
		refresh: `refresh-${access}`,
		// Far future — never triggers refresh skew
		expires: Date.now() + 365 * 24 * 3_600_000,
		state: "available",
		resetAt: null,
		addedAt,
		lastUsedAt: null,
		lastExhaustedAt: null,
	}
}

/**
 * Test adapter: ProviderAdapter object literal with apiOrigins pinned to the
 * fake server. Does not use createAnthropicAdapter (no origin override hook).
 */
function testAdapter(apiOrigin: string): ProviderAdapter {
	return {
		providerId: "anthropic",
		apiOrigins: Object.freeze([apiOrigin]),
		authorize: async () => ({ type: "failed", reason: "not_used_in_e2e" }),
		refresh: async () => ({
			outcome: "transient",
			error: "refresh_not_expected_in_e2e",
			attempts: 1,
		}),
	}
}

async function setupHarness(): Promise<{
	server: FakeServer
	store: MultiAuthStore
	fetch: ReturnType<typeof createFetchWrapper>
	notifications: string[]
	messagesUrl: string
}> {
	const server = await startFakeAnthropicServer()
	servers.push(server)

	const baseDir = await makeTempDir()
	const store = new MultiAuthStore("anthropic", { baseDir })
	await store.upsertAccount("acct-a", oauthAccount(TOKEN_A, 1_000))
	await store.upsertAccount("acct-b", oauthAccount(TOKEN_B, 2_000))

	const resolved = parseConfig({
		providers: {
			anthropic: {
				enabled: true,
				// Disable sticky so failback after reset is priority-pure and
				// independent of session affinity from intermediate successes.
				// (Sticky still prefers higher priority when affinity is lower.)
				stickyWithinSession: false,
				accounts: [
					{ label: "acct-a", priority: 1 },
					{ label: "acct-b", priority: 2 },
				],
				failover: {
					maxAttemptsPerRequest: 3,
					retryOn: ["quota", "rate_limit"],
					notify: "toast",
				},
			},
		},
	})
	const providerConfig = resolved.providers.anthropic!
	expect(providerConfig).toBeDefined()

	const notifications: string[] = []
	const fetch = createFetchWrapper({
		store,
		adapter: testAdapter(server.origin),
		providerConfig,
		notify: (m) => notifications.push(m),
		// Real global fetch → Bun.serve (no fetchImpl mock)
	})

	return {
		server,
		store,
		fetch,
		notifications,
		messagesUrl: server.url("/v1/messages"),
	}
}

function postInit(body: string | object = { model: "claude-e2e", max_tokens: 16 }): RequestInit {
	const bodyStr = typeof body === "string" ? body : JSON.stringify(body)
	return {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": PLACEHOLDER_API_KEY,
			Authorization: `Bearer ${PLACEHOLDER_API_KEY}`,
			"anthropic-version": "2023-06-01",
		},
		body: bodyStr,
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function expectResetAtApprox(resetAt: number | null, fromMs: number, seconds: number): void {
	expect(resetAt).not.toBeNull()
	const expected = fromMs + seconds * 1000
	expect(Math.abs((resetAt as number) - expected)).toBeLessThanOrEqual(RESET_AT_TOLERANCE_MS)
}

function bodiesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) return false
	for (let i = 0; i < a.byteLength; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

// =============================================================================
// SCENARIOS
// =============================================================================

describe("e2e multi-auth vs fake Anthropic server", () => {
	test("1. priority order: fresh state uses acct-a (priority 1)", async () => {
		const { server, fetch, messagesUrl } = await setupHarness()

		const res = await fetch(messagesUrl, postInit())
		expect(res.status).toBe(200)
		const json = (await res.json()) as { type?: string }
		expect(json.type).toBe("message")

		expect(server.requests).toHaveLength(1)
		expect(server.requests[0]!.bearer).toBe(TOKEN_A)
		expect(server.requests[0]!.path).toBe("/v1/messages")
	})

	test("2. fallback: 429 on acct-a → success via acct-b; acct-a cooling_down", async () => {
		const { server, store, fetch, messagesUrl, notifications } = await setupHarness()

		// 429 every request with TOKEN_A
		server.setRateLimit(TOKEN_A, {
			afterCount: 1,
			retryAfterSeconds: RETRY_AFTER_SECONDS,
		})
		// Force always so the single attempt for A is 429
		server.rateLimitAlways([TOKEN_A], RETRY_AFTER_SECONDS)

		const before = Date.now()
		const res = await fetch(messagesUrl, postInit({ model: "claude-e2e", n: 2 }))
		expect(res.status).toBe(200)

		expect(server.requests.length).toBeGreaterThanOrEqual(2)
		expect(server.requests[0]!.bearer).toBe(TOKEN_A)
		expect(server.requests[1]!.bearer).toBe(TOKEN_B)

		const acctA = await store.getAccount("acct-a")
		expect(acctA?.state).toBe("cooling_down")
		expectResetAtApprox(acctA?.resetAt ?? null, before, RETRY_AFTER_SECONDS)
		expect(acctA?.lastExhaustedAt).not.toBeNull()

		const acctB = await store.getAccount("acct-b")
		expect(acctB?.state).toBe("available")
		expect(acctB?.lastUsedAt).not.toBeNull()

		// Exhaustion notify for acct-a
		expect(notifications.some((n) => /acct-a/i.test(n) && /exhaust/i.test(n))).toBe(true)
	})

	test("3. cooldown persistence: keep using acct-b while acct-a cooling_down", async () => {
		const { server, store, fetch, messagesUrl } = await setupHarness()

		server.rateLimitAlways([TOKEN_A], RETRY_AFTER_SECONDS)

		// First request: failover A→B
		const res1 = await fetch(messagesUrl, postInit({ step: 1 }))
		expect(res1.status).toBe(200)
		expect(server.requests.at(-1)!.bearer).toBe(TOKEN_B)

		const afterFailover = await store.getAccount("acct-a")
		expect(afterFailover?.state).toBe("cooling_down")

		// Subsequent requests must not touch A
		const beforeLen = server.requests.length
		const res2 = await fetch(messagesUrl, postInit({ step: 2 }))
		const res3 = await fetch(messagesUrl, postInit({ step: 3 }))
		expect(res2.status).toBe(200)
		expect(res3.status).toBe(200)

		const newReqs = server.requests.slice(beforeLen)
		expect(newReqs.length).toBe(2)
		for (const r of newReqs) {
			expect(r.bearer).toBe(TOKEN_B)
		}

		const stillCooling = await store.getAccount("acct-a")
		expect(stillCooling?.state).toBe("cooling_down")
	})

	test("4. failback after reset: past resetAt + server healthy → acct-a again", async () => {
		const { server, store, fetch, messagesUrl } = await setupHarness()

		// 429 A only for the first hit, then healthy (afterCount: 2 means first is OK...
		// We need first request to 429 A. Use always, then clear after cooldown.)
		server.rateLimitAlways([TOKEN_A], RETRY_AFTER_SECONDS)

		const before = Date.now()
		const res1 = await fetch(messagesUrl, postInit({ phase: "failover" }))
		expect(res1.status).toBe(200)
		expect(server.requests.some((r) => r.bearer === TOKEN_B)).toBe(true)

		const acctA = await store.getAccount("acct-a")
		expect(acctA?.state).toBe("cooling_down")
		const resetAt = acctA!.resetAt!
		expectResetAtApprox(resetAt, before, RETRY_AFTER_SECONDS)

		// Stop 429ing A and wait until past resetAt
		server.clearRateLimit(TOKEN_A)
		const waitMs = Math.max(0, resetAt - Date.now()) + 50
		await sleep(waitMs)

		const beforeFailback = server.requests.length
		const res2 = await fetch(messagesUrl, postInit({ phase: "failback" }))
		expect(res2.status).toBe(200)

		const failbackReqs = server.requests.slice(beforeFailback)
		expect(failbackReqs).toHaveLength(1)
		expect(failbackReqs[0]!.bearer).toBe(TOKEN_A)
	}, 15_000)

	test("5. all exhausted: both 429 → surface 429; both cooling_down; notify earliest reset", async () => {
		const { server, store, fetch, messagesUrl, notifications } = await setupHarness()

		server.rateLimitAlways([TOKEN_A, TOKEN_B], RETRY_AFTER_SECONDS)

		const res = await fetch(messagesUrl, postInit({ phase: "all-exhausted" }))
		expect(res.status).toBe(429)

		const a = await store.getAccount("acct-a")
		const b = await store.getAccount("acct-b")
		expect(a?.state).toBe("cooling_down")
		expect(b?.state).toBe("cooling_down")
		expect(a?.resetAt).not.toBeNull()
		expect(b?.resetAt).not.toBeNull()

		const joined = notifications.join("\n")
		expect(joined.toLowerCase()).toMatch(/exhaust/)
		expect(joined).toMatch(/reset/i)
		// No raw tokens in notify
		expect(joined).not.toContain(TOKEN_A)
		expect(joined).not.toContain(TOKEN_B)
		expect(joined).not.toContain("Bearer ")

		// Both tokens were attempted
		const bearers = new Set(server.requests.map((r) => r.bearer))
		expect(bearers.has(TOKEN_A)).toBe(true)
		expect(bearers.has(TOKEN_B)).toBe(true)
	})

	test("6. byte-identical replay: POST body identical on A and B attempts", async () => {
		const { server, fetch, messagesUrl } = await setupHarness()

		server.rateLimitAlways([TOKEN_A], RETRY_AFTER_SECONDS)

		const payload = {
			model: "claude-e2e",
			max_tokens: 32,
			messages: [{ role: "user", content: "replay-me-byte-for-byte" }],
			metadata: { marker: "e2e-identical-body", n: 42 },
		}
		const bodyStr = JSON.stringify(payload)
		const expectedBytes = new TextEncoder().encode(bodyStr)

		const res = await fetch(messagesUrl, postInit(bodyStr))
		expect(res.status).toBe(200)

		expect(server.requests.length).toBeGreaterThanOrEqual(2)
		const attemptA = server.requests.find((r) => r.bearer === TOKEN_A)
		const attemptB = server.requests.find((r) => r.bearer === TOKEN_B)
		expect(attemptA).toBeDefined()
		expect(attemptB).toBeDefined()

		expect(bodiesEqual(attemptA!.body, expectedBytes)).toBe(true)
		expect(bodiesEqual(attemptB!.body, expectedBytes)).toBe(true)
		expect(bodiesEqual(attemptA!.body, attemptB!.body)).toBe(true)
		expect(attemptA!.bodyText).toBe(bodyStr)
		expect(attemptB!.bodyText).toBe(bodyStr)
	})
})

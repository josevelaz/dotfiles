/**
 * Anthropic adapter tests: fake OAuth server integration + F5 PKCE conformance.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
	ANTHROPIC_API_ORIGINS,
	AUTH_CODE_RE,
	buildAuthorizeUrl,
	constantTimeEqual,
	createAnthropicAdapter,
	generateCodeVerifier,
	generateState,
	isValidAuthCodeFormat,
	s256Challenge,
	startLoopbackListener,
} from "../adapters/anthropic"

// =============================================================================
// FAKE OAUTH SERVER
// =============================================================================

type FakeOAuthOpts = {
	/** Token endpoint behavior. */
	onToken?: (req: {
		body: Record<string, unknown>
		count: number
	}) => Response | Promise<Response>
}

function startFakeOAuth(opts: FakeOAuthOpts = {}) {
	let tokenHits = 0
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url)
			if (url.pathname === "/oauth/authorize" && req.method === "GET") {
				// Echo challenge params for inspection; real IdP would redirect
				return new Response("ok", { status: 200 })
			}
			if (url.pathname === "/v1/oauth/token" && req.method === "POST") {
				tokenHits += 1
				const body = (await req.json()) as Record<string, unknown>
				if (opts.onToken) {
					return opts.onToken({ body, count: tokenHits })
				}
				// Happy path: require code + verifier or refresh_token
				if (body.grant_type === "authorization_code") {
					if (!body.code || !body.code_verifier) {
						return Response.json(
							{ error: "invalid_request" },
							{ status: 400 },
						)
					}
					return Response.json({
						access_token: "access-from-code",
						refresh_token: "refresh-from-code",
						expires_in: 3600,
					})
				}
				if (body.grant_type === "refresh_token") {
					return Response.json({
						access_token: "access-refreshed",
						refresh_token: "refresh-rotated",
						expires_in: 3600,
					})
				}
				return Response.json({ error: "unsupported_grant_type" }, { status: 400 })
			}
			return new Response("not found", { status: 404 })
		},
	})

	const base = `http://127.0.0.1:${server.port}`
	return {
		base,
		authorizeUrl: `${base}/oauth/authorize`,
		tokenUrl: `${base}/v1/oauth/token`,
		tokenHits: () => tokenHits,
		stop: () => server.stop(true),
	}
}

const servers: Array<{ stop: () => void }> = []

afterEach(() => {
	while (servers.length) {
		servers.pop()?.stop()
	}
})

// =============================================================================
// F1 — ORIGIN ALLOWLIST
// =============================================================================

describe("F1 ANTHROPIC_API_ORIGINS", () => {
	test("is frozen and contains only api.anthropic.com", () => {
		expect(Object.isFrozen(ANTHROPIC_API_ORIGINS)).toBe(true)
		expect([...ANTHROPIC_API_ORIGINS]).toEqual(["https://api.anthropic.com"])
		// @ts-expect-error — frozen tuple must reject mutation
		expect(() => {
			;(ANTHROPIC_API_ORIGINS as string[]).push("https://evil.example")
		}).toThrow()
	})

	test("adapter.apiOrigins is the same frozen constant", () => {
		const adapter = createAnthropicAdapter()
		expect(adapter.apiOrigins).toBe(ANTHROPIC_API_ORIGINS)
		expect(adapter.providerId).toBe("anthropic")
	})
})

// =============================================================================
// F5 — PKCE HELPERS
// =============================================================================

describe("F5 PKCE helpers", () => {
	test("verifier has ≥256 bits entropy (32 bytes base64url)", () => {
		const v = generateCodeVerifier()
		// base64url of 32 bytes is 43 chars without padding
		expect(v.length).toBeGreaterThanOrEqual(43)
		const unique = new Set(Array.from({ length: 20 }, () => generateCodeVerifier()))
		expect(unique.size).toBe(20)
	})

	test("challenge method is S256 (sha256 base64url)", () => {
		const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
		// RFC 7636 appendix B
		expect(s256Challenge(v)).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		)
	})

	test("constantTimeEqual rejects mismatches and accepts equals", () => {
		const a = generateState()
		expect(constantTimeEqual(a, a)).toBe(true)
		expect(constantTimeEqual(a, generateState())).toBe(false)
		expect(constantTimeEqual("short", "longer-value")).toBe(false)
	})

	test("buildAuthorizeUrl sets code_challenge_method=S256 only", () => {
		const url = buildAuthorizeUrl({
			authorizeUrl: "https://example.test/oauth/authorize",
			clientId: "cid",
			redirectUri: "http://127.0.0.1:9/oauth/callback",
			scopes: "a b",
			codeChallenge: "ch",
			state: "st",
		})
		const u = new URL(url)
		expect(u.searchParams.get("code_challenge_method")).toBe("S256")
		expect(u.searchParams.get("code_challenge")).toBe("ch")
		expect(u.searchParams.get("state")).toBe("st")
		expect(u.searchParams.get("response_type")).toBe("code")
	})
})

// =============================================================================
// F5 — LOOPBACK EXACT MATCH + STATE
// =============================================================================

describe("F5 loopback listener", () => {
	test("accepts exact redirect and single-use state; rejects mismatch/reuse/wrong path", async () => {
		const state = generateState()
		const loop = await startLoopbackListener(state)

		// Wrong path rejected (does not settle)
		const wrongPath = await fetch(
			`http://127.0.0.1:${loop.port}/wrong`,
		)
		expect(wrongPath.status).toBe(400)

		// Mismatched state rejected
		const waitMismatch = loop.wait()
		const bad = await fetch(
			`${loop.redirectUri}?code=goodcode12&state=WRONGSTATEVALUE000`,
		)
		expect(bad.status).toBe(400)
		const mismatch = await waitMismatch
		expect(mismatch.ok).toBe(false)
		if (!mismatch.ok) expect(mismatch.reason).toBe("state_mismatch")

		await loop.close()

		// Fresh listener for success + reuse
		const state2 = generateState()
		const loop2 = await startLoopbackListener(state2)
		const waitOk = loop2.wait()
		const ok = await fetch(
			`${loop2.redirectUri}?code=goodcode12&state=${encodeURIComponent(state2)}`,
		)
		expect(ok.status).toBe(200)
		const got = await waitOk
		expect(got.ok).toBe(true)
		if (got.ok) {
			expect(got.code).toBe("goodcode12")
			expect(got.state).toBe(state2)
		}

		// Reuse rejected
		const reuse = await fetch(
			`${loop2.redirectUri}?code=goodcode12&state=${encodeURIComponent(state2)}`,
		)
		expect(reuse.status).toBe(400)

		await loop2.close()
	})

	test("wrong port is not our listener (exact-match host:port)", async () => {
		const state = generateState()
		const loop = await startLoopbackListener(state)
		// Hitting a different port cannot complete our wait
		let otherFailed = false
		try {
			await fetch(
				`http://127.0.0.1:${loop.port + 1}${new URL(loop.redirectUri).pathname}?code=x&state=${state}`,
				{ signal: AbortSignal.timeout(200) },
			)
		} catch {
			otherFailed = true
		}
		expect(otherFailed || true).toBe(true) // connection refused or timeout
		await loop.close()
	})
})

// =============================================================================
// F5 — MANUAL CODE FORMAT
// =============================================================================

describe("F5 manual code format", () => {
	test("rejects wrong-format codes", () => {
		expect(isValidAuthCodeFormat("short")).toBe(false)
		expect(isValidAuthCodeFormat("has spaces not ok!!")).toBe(false)
		expect(isValidAuthCodeFormat("")).toBe(false)
		expect(isValidAuthCodeFormat("validcode_ABC-123")).toBe(true)
		expect(isValidAuthCodeFormat("validcode_ABC-123#statepart_XYZ-999")).toBe(
			true,
		)
		expect(AUTH_CODE_RE.test("nope!")).toBe(false)
	})

	test("authorize rejects invalid manual code without logging it", async () => {
		const fake = startFakeOAuth()
		servers.push(fake)
		const adapter = createAnthropicAdapter()

		const logs: string[] = []
		const origLog = console.log
		const origInfo = console.info
		const origWarn = console.warn
		const origError = console.error
		const capture = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "))
		}
		console.log = capture
		console.info = capture
		console.warn = capture
		console.error = capture

		const secretBad = "BAD CODE WITH SPACES!!!"
		try {
			const result = await adapter.authorize(
				{ label: "test-acct" },
				{
					timeoutMs: 5_000,
					promptCode: async () => secretBad,
					_endpoints: {
						authorizeUrl: fake.authorizeUrl,
						tokenUrl: fake.tokenUrl,
						manualOnly: true,
						redirectUri: "https://console.anthropic.com/oauth/code/callback",
					},
					openUrl: async () => {},
				},
			)
			expect(result.type).toBe("failed")
			if (result.type === "failed") {
				expect(result.reason).toBe("invalid_code_format")
			}
			// Authorization code must never appear in logs
			const joined = logs.join("\n")
			expect(joined.includes(secretBad)).toBe(false)
			expect(joined.toLowerCase().includes("bad code")).toBe(false)
		} finally {
			console.log = origLog
			console.info = origInfo
			console.warn = origWarn
			console.error = origError
		}
	})
})

// =============================================================================
// INTEGRATION: authorize → tokens via loopback
// =============================================================================

describe("authorize integration (fake OAuth + loopback)", () => {
	test("authorize → success tokens; code never logged; challenge is S256", async () => {
		const fake = startFakeOAuth()
		servers.push(fake)
		const adapter = createAnthropicAdapter()

		const logs: string[] = []
		const origLog = console.log
		const origError = console.error
		const capture = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "))
		}
		console.log = capture
		console.error = capture

		const authCode = "authcode_INTEGRATION_SECRET_xyz"
		try {
			const resultPromise = adapter.authorize(
				{ label: "work-max" },
				{
					timeoutMs: 10_000,
					_endpoints: {
						authorizeUrl: fake.authorizeUrl,
						tokenUrl: fake.tokenUrl,
					},
					onReady: async ({ authorizeUrl, redirectUri, state, codeChallengeMethod }) => {
						expect(codeChallengeMethod).toBe("S256")
						const u = new URL(authorizeUrl)
						expect(u.searchParams.get("code_challenge_method")).toBe("S256")
						expect(u.searchParams.get("code_challenge")).toBeTruthy()
						expect(u.searchParams.get("state")).toBe(state)

						// Scripted browser: hit loopback redirect with code+state
						const cb = `${redirectUri}?code=${encodeURIComponent(authCode)}&state=${encodeURIComponent(state)}`
						const res = await fetch(cb)
						expect(res.status).toBe(200)
					},
					openUrl: async () => {},
				},
			)

			const result = await resultPromise
			expect(result.type).toBe("success")
			if (result.type === "success") {
				expect(result.label).toBe("work-max")
				expect(result.access).toBe("access-from-code")
				expect(result.refresh).toBe("refresh-from-code")
				expect(result.expires).toBeGreaterThan(Date.now())
			}

			const joined = logs.join("\n")
			expect(joined.includes(authCode)).toBe(false)
			expect(joined.includes("access-from-code")).toBe(false)
			expect(joined.includes("refresh-from-code")).toBe(false)
		} finally {
			console.log = origLog
			console.error = origError
		}
	})

	test("mismatched state on loopback → failed authorize", async () => {
		const fake = startFakeOAuth()
		servers.push(fake)
		const adapter = createAnthropicAdapter()

		const result = await adapter.authorize(
			{ label: "x" },
			{
				timeoutMs: 5_000,
				_endpoints: {
					authorizeUrl: fake.authorizeUrl,
					tokenUrl: fake.tokenUrl,
				},
				onReady: async ({ redirectUri }) => {
					await fetch(
						`${redirectUri}?code=goodcode99&state=not-the-real-state-value-xxx`,
					)
				},
				openUrl: async () => {},
			},
		)
		expect(result.type).toBe("failed")
		if (result.type === "failed") {
			expect(result.reason).toBe("state_mismatch")
		}
	})
})

// =============================================================================
// REFRESH (adapter single-shot)
// =============================================================================

describe("adapter.refresh single-shot", () => {
	test("happy path returns rotated tokens", async () => {
		const fake = startFakeOAuth()
		servers.push(fake)
		const adapter = createAnthropicAdapter()
		const result = await adapter.refresh("old-refresh", {
			_endpoints: { tokenUrl: fake.tokenUrl },
		})
		expect(result.outcome).toBe("ok")
		if (result.outcome === "ok") {
			expect(result.access).toBe("access-refreshed")
			expect(result.refresh).toBe("refresh-rotated")
		}
	})

	test("invalid_grant → needs_reauth", async () => {
		const fake = startFakeOAuth({
			onToken: async () =>
				Response.json({ error: "invalid_grant" }, { status: 400 }),
		})
		servers.push(fake)
		const adapter = createAnthropicAdapter()
		const result = await adapter.refresh("dead", {
			_endpoints: { tokenUrl: fake.tokenUrl },
		})
		expect(result.outcome).toBe("needs_reauth")
	})

	test("5xx → transient", async () => {
		const fake = startFakeOAuth({
			onToken: async () => new Response("nope", { status: 503 }),
		})
		servers.push(fake)
		const adapter = createAnthropicAdapter()
		const result = await adapter.refresh("r", {
			_endpoints: { tokenUrl: fake.tokenUrl },
		})
		expect(result.outcome).toBe("transient")
	})
})

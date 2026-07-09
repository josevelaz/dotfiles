/**
 * Plugin entry + status wiring tests.
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import {
	MultiAuthPlugin,
	PLACEHOLDER_API_KEY,
	buildAuthHook,
	extractMultiAuthRaw,
	type MultiAuthPluginOptions,
} from "../../multi-auth"
import { createAnthropicAdapter } from "../adapters/anthropic"
import { parseConfig } from "../config"
import { MultiAuthStore } from "../store"
import { createStatus } from "../status"
import { redact } from "../fetch-wrapper"

// =============================================================================
// HELPERS
// =============================================================================

const tempDirs: string[] = []
const servers: Array<{ stop: () => void }> = []

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-auth-plugin-"))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	while (servers.length) {
		servers.pop()?.stop()
	}
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
	}
})

function startFakeOAuth() {
	let tokenHits = 0
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url)
			if (url.pathname === "/oauth/authorize" && req.method === "GET") {
				return new Response("ok", { status: 200 })
			}
			if (url.pathname === "/v1/oauth/token" && req.method === "POST") {
				tokenHits += 1
				const body = (await req.json()) as Record<string, unknown>
				if (body.grant_type === "authorization_code") {
					return Response.json({
						access_token: `access-tok-${tokenHits}`,
						refresh_token: `refresh-tok-${tokenHits}`,
						expires_in: 3600,
					})
				}
				return Response.json({ error: "unsupported_grant_type" }, { status: 400 })
			}
			return new Response("not found", { status: 404 })
		},
	})
	const base = `http://127.0.0.1:${server.port}`
	const handle = {
		authorizeUrl: `${base}/oauth/authorize`,
		tokenUrl: `${base}/v1/oauth/token`,
		stop: () => server.stop(true),
	}
	servers.push(handle)
	return handle
}

function fakePluginInput(
	overrides: Partial<PluginInput> = {},
): PluginInput {
	return {
		client: {
			app: {
				log: async () => ({ data: true }),
			},
			tui: {
				showToast: async () => ({ data: true }),
			},
		},
		project: { id: "test", worktree: "/tmp", name: "test" },
		directory: "/tmp",
		worktree: "/tmp",
		experimental_workspace: { register: () => {} },
		serverUrl: new URL("http://127.0.0.1:0"),
		$: {} as PluginInput["$"],
		...overrides,
	} as PluginInput
}

// =============================================================================
// extractMultiAuthRaw
// =============================================================================

describe("extractMultiAuthRaw", () => {
	test("reads providers from plugin options", () => {
		const raw = extractMultiAuthRaw({
			providers: { anthropic: { enabled: true } },
		})
		expect(raw).toEqual({ providers: { anthropic: { enabled: true } } })
	})

	test("reads nested multi-auth key from options", () => {
		const raw = extractMultiAuthRaw({
			"multi-auth": { providers: { anthropic: { enabled: false } } },
		})
		expect(raw).toEqual({ providers: { anthropic: { enabled: false } } })
	})
})

// =============================================================================
// INERT WITHOUT CONFIG
// =============================================================================

describe("plugin inert without config", () => {
	test("empty options → no auth hook, no store dir created", async () => {
		const baseDir = await makeTempDir()
		const hooks = await MultiAuthPlugin(fakePluginInput(), {
			storeBaseDir: baseDir,
		} as MultiAuthPluginOptions)

		expect(hooks.auth).toBeUndefined()
		// Only storeBaseDir was passed — no providers → inert
		const entries = await fs.readdir(baseDir)
		expect(entries).toEqual([])
	})

	test("undefined options → empty hooks", async () => {
		const hooks = await MultiAuthPlugin(fakePluginInput())
		expect(hooks.auth).toBeUndefined()
		expect(hooks.config).toBeUndefined()
	})

	test("enabled:false → inert", async () => {
		const baseDir = await makeTempDir()
		const hooks = await MultiAuthPlugin(fakePluginInput(), {
			providers: { anthropic: { enabled: false } },
			storeBaseDir: baseDir,
		} as MultiAuthPluginOptions)
		expect(hooks.auth).toBeUndefined()
		const entries = await fs.readdir(baseDir)
		expect(entries).toEqual([])
	})
})

// =============================================================================
// AUTHORIZE → TWO LABELED ACCOUNTS
// =============================================================================

describe("authorize appends labeled accounts", () => {
	test("two authorize() runs create two labeled accounts; each callback returns success", async () => {
		const baseDir = await makeTempDir()
		const oauth = startFakeOAuth()
		const adapter = createAnthropicAdapter()

		const configRef = {
			current: parseConfig({
				providers: { anthropic: { enabled: true } },
			}),
		}

		const logs: string[] = []
		const logger = {
			info: (m: string) => logs.push(String(m)),
			warn: (m: string) => logs.push(String(m)),
			debug: (m: string) => logs.push(String(m)),
			error: (m: string) => logs.push(String(m)),
			log: (m: string) => logs.push(String(m)),
		}

		const auth = buildAuthHook({
			providerId: "anthropic",
			configRef,
			storeBaseDir: baseDir,
			adapter,
			authorizeDeps: {
				_endpoints: {
					manualOnly: true,
					authorizeUrl: oauth.authorizeUrl,
					tokenUrl: oauth.tokenUrl,
					clientId: "test-client",
					redirectUri: "https://console.anthropic.com/oauth/code/callback",
				},
				promptCode: async () => "goodcode12",
			},
			logger,
		})

		const method = auth.methods[0]
		expect(method?.type).toBe("oauth")
		if (!method || method.type !== "oauth") throw new Error("expected oauth method")

		// First account
		const flow1 = await method.authorize({ label: "work-max", priority: "1" })
		expect(flow1.url).toContain("/oauth/authorize")
		expect(flow1.method).toBe("auto")
		const result1 = await flow1.callback()
		expect(result1.type).toBe("success")
		if (result1.type !== "success") throw new Error("expected success")
		expect(result1.access).toBeTruthy()
		expect(result1.refresh).toBeTruthy()
		expect(typeof result1.expires).toBe("number")

		// Second account
		const flow2 = await method.authorize({ label: "personal-pro", priority: "2" })
		const result2 = await flow2.callback()
		expect(result2.type).toBe("success")
		if (result2.type !== "success") throw new Error("expected success")
		expect(result2.access).not.toBe(result1.access)

		const store = new MultiAuthStore("anthropic", { baseDir })
		const accounts = await store.listAccounts()
		expect(accounts).toHaveLength(2)
		const labels = accounts.map((a) => a.label).sort()
		expect(labels).toEqual(["personal-pro", "work-max"])

		const work = await store.getAccount("work-max")
		expect(work?.meta?.priority).toBe(1)
		expect(work?.access).toMatch(/^access-tok-/)
		// Logs must not contain raw tokens
		const joined = logs.join("\n")
		expect(joined).toContain("work-max")
		expect(joined).not.toContain("access-tok-")
		expect(joined).not.toContain("refresh-tok-")
	})

	test("missing label prompt generates unique account-N labels", async () => {
		const baseDir = await makeTempDir()
		const oauth = startFakeOAuth()
		const configRef = {
			current: parseConfig({
				providers: { anthropic: { enabled: true } },
			}),
		}
		const auth = buildAuthHook({
			providerId: "anthropic",
			configRef,
			storeBaseDir: baseDir,
			adapter: createAnthropicAdapter(),
			authorizeDeps: {
				_endpoints: {
					manualOnly: true,
					authorizeUrl: oauth.authorizeUrl,
					tokenUrl: oauth.tokenUrl,
					clientId: "test-client",
					redirectUri: "https://console.anthropic.com/oauth/code/callback",
				},
				promptCode: async () => "goodcode12",
			},
			logger: {
				info: () => {},
				warn: () => {},
				debug: () => {},
				error: () => {},
				log: () => {},
			},
		})
		const method = auth.methods[0]
		if (!method || method.type !== "oauth") throw new Error("expected oauth")

		const r1 = await (await method.authorize({})).callback()
		const r2 = await (await method.authorize({})).callback()
		expect(r1.type).toBe("success")
		expect(r2.type).toBe("success")

		const store = new MultiAuthStore("anthropic", { baseDir })
		const labels = (await store.listAccounts()).map((a) => a.label).sort()
		expect(labels).toEqual(["account-1", "account-2"])
	})
})

// =============================================================================
// LOADER
// =============================================================================

describe("loader", () => {
	test("returns placeholder apiKey and callable fetch", async () => {
		const baseDir = await makeTempDir()
		const hooks = await MultiAuthPlugin(fakePluginInput(), {
			providers: { anthropic: { enabled: true } },
			storeBaseDir: baseDir,
		} as MultiAuthPluginOptions)

		expect(hooks.auth).toBeDefined()
		expect(hooks.auth?.provider).toBe("anthropic")
		expect(hooks.auth?.loader).toBeTypeOf("function")

		const loaded = await hooks.auth!.loader!(
			async () =>
				({
					type: "oauth",
					access: "x",
					refresh: "y",
					expires: Date.now() + 60_000,
				}) as never,
			{ id: "anthropic", name: "Anthropic", env: [], models: {} } as never,
		)

		expect(loaded.apiKey).toBe(PLACEHOLDER_API_KEY)
		expect(loaded.apiKey).toBe("multi-auth-placeholder")
		expect(typeof loaded.fetch).toBe("function")
		// Wrapped fetch is callable (signature only — no network)
		expect(loaded.fetch).toBeInstanceOf(Function)
		expect((loaded.fetch as Function).length).toBeGreaterThanOrEqual(1)
	})
})

// =============================================================================
// PLUGIN WITH ENABLED CONFIG
// =============================================================================

describe("plugin with enabled config", () => {
	test("registers auth + config hooks when anthropic enabled", async () => {
		const hooks = await MultiAuthPlugin(fakePluginInput(), {
			providers: {
				anthropic: {
					enabled: true,
					failover: { notify: "log" },
				},
			},
		} as MultiAuthPluginOptions)

		expect(hooks.auth?.provider).toBe("anthropic")
		expect(hooks.auth?.methods?.[0]?.type).toBe("oauth")
		expect(hooks.auth?.methods?.[0]?.label).toBe("Multi-account (add account)")
		// prompts present at 1.17.x
		const method = hooks.auth?.methods?.[0]
		if (method && method.type === "oauth") {
			expect(method.prompts?.length).toBeGreaterThanOrEqual(2)
			expect(method.prompts?.map((p) => p.key)).toContain("label")
			expect(method.prompts?.map((p) => p.key)).toContain("priority")
		}
		expect(hooks.config).toBeTypeOf("function")
	})
})

// =============================================================================
// STATUS
// =============================================================================

describe("createStatus", () => {
	test("log mode writes redacted label-only lines; no token material", () => {
		const lines: string[] = []
		const status = createStatus({
			mode: "log",
			logger: {
				info: (m: string) => lines.push(String(m)),
				log: (m: string) => lines.push(String(m)),
			},
		})

		status.accountAdded("work-max")
		status.fallback("work-max", "personal-pro")
		status.allExhausted(2, Date.UTC(2026, 0, 1))
		status.notify(
			"account work-max exhausted; Bearer sk-ant-secretTOKEN123456 and access-ABCDEFGH12345678",
		)

		const joined = lines.join("\n")
		expect(joined).toContain("work-max")
		expect(joined).toContain("personal-pro")
		expect(joined).toContain("fallback from")
		expect(joined).toContain("all 2 accounts exhausted")
		expect(joined).not.toMatch(/sk-ant-secretTOKEN123456/)
		expect(joined).not.toMatch(/access-ABCDEFGH12345678/)
		expect(joined).toContain("[REDACTED]")
	})

	test("silent mode emits nothing", () => {
		const lines: string[] = []
		const status = createStatus({
			mode: "silent",
			logger: { info: (m: string) => lines.push(String(m)) },
		})
		status.notify("should not appear")
		status.accountAdded("x")
		expect(lines).toEqual([])
	})

	test("toast mode uses client.tui.showToast when available", async () => {
		const toasts: Array<{ message: string }> = []
		const status = createStatus({
			mode: "toast",
			client: {
				tui: {
					showToast: async ({ body }) => {
						toasts.push({ message: body.message })
						return true
					},
				},
			},
		})
		status.notify("fallback from a to b")
		// allow microtask for void promise
		await Promise.resolve()
		expect(toasts.length).toBe(1)
		expect(toasts[0]!.message).toContain("fallback from a to b")
	})

	test("toast mode degrades to log when showToast missing", () => {
		const lines: string[] = []
		const status = createStatus({
			mode: "toast",
			client: {},
			logger: { info: (m: string) => lines.push(String(m)) },
		})
		status.notify("hello label-only")
		expect(lines.some((l) => l.includes("hello label-only"))).toBe(true)
	})

	test("redact helper strips secrets", () => {
		expect(redact("Bearer abc.def.ghi")).toContain("[REDACTED]")
		expect(redact(`key=${PLACEHOLDER_API_KEY}`)).toContain("[REDACTED]")
	})
})

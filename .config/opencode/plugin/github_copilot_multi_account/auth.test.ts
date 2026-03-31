import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildCopilotAuthOverride } from "./auth"
import { createEmptyRegistry, saveRegistry, loadRegistry } from "./storage"
import type { CapabilityGateEvidence, SecretStore, StoredCredentials } from "./types"

class MemorySecretStore implements SecretStore {
	private store = new Map<string, StoredCredentials>()

	private key(ref: string, version: number): string {
		return `${ref}:v${version}`
	}

	async upsert(ref: string, version: number, value: StoredCredentials): Promise<void> {
		this.store.set(this.key(ref, version), value)
	}

	async read(ref: string, version: number): Promise<StoredCredentials> {
		const value = this.store.get(this.key(ref, version))
		if (!value) throw new Error("missing secret ref")
		return value
	}

	async listVersions(ref: string): Promise<number[]> {
		return [...this.store.keys()]
			.filter((key) => key.startsWith(`${ref}:v`))
			.map((key) => Number.parseInt(key.split(":v")[1], 10))
			.sort((left, right) => left - right)
	}

	async removeVersion(ref: string, version: number): Promise<void> {
		this.store.delete(this.key(ref, version))
	}

	async removeAll(ref: string): Promise<void> {
		for (const version of await this.listVersions(ref)) {
			this.store.delete(this.key(ref, version))
		}
	}
}

function gate(goNoGo: "go" | "stop" = "go"): CapabilityGateEvidence {
	return {
		authMethodShape: "shape",
		loaderShape: "shape",
		opencodeVersion: "local",
		pluginVersion: "local",
		providerId: "github-copilot",
		authMethodId: "method",
		validationCommand: "bun probe.ts",
		probeScript: "probe.ts",
		validationDate: "2026-03-28",
		providerContractSummary: "summary",
		refreshContractSummary: "summary",
		requestFixtureHash: "request",
		responseFixtureHash: "response",
		replayProof: "proof",
		persistenceProof: "proof",
		transportOverrideProof: "proof",
		canInspectResponse: true,
		canReplayBufferedRequest: true,
		canPersistDuringRequest: true,
		canOverrideTransport: true,
		goNoGo,
	}
}

async function seedRegistry(baseDir: string, store: MemorySecretStore) {
	const registry = createEmptyRegistry()
	registry.accounts.push({
		id: "copilot-acct-first1111",
		identityKey: "identity-first",
		label: "Account A",
		secretRef: "secret-first",
		credentialVersion: 1,
		status: "active",
		expiresAt: Date.now() + 120_000,
		cooldownUntil: null,
		modelCooldowns: {},
		preferred: true,
		lastUsedAt: null,
		lastSwitchReason: null,
		recentFailureReason: null,
		recentFailureAt: null,
		recoverableError: null,
		schemaVersion: 1,
	})
	registry.activeAccountId = "copilot-acct-first1111"
	registry.accounts.push({
		id: "copilot-acct-second22",
		identityKey: "identity-second",
		label: "Account B",
		secretRef: "secret-second",
		credentialVersion: 1,
		status: "active",
		expiresAt: Date.now() + 120_000,
		cooldownUntil: null,
		modelCooldowns: {},
		preferred: false,
		lastUsedAt: null,
		lastSwitchReason: null,
		recentFailureReason: null,
		recentFailureAt: null,
		recoverableError: null,
		schemaVersion: 1,
	})
	await store.upsert("secret-first", 1, {
		accessToken: "token-a",
		refreshToken: "refresh-a",
		expiresAt: Date.now() + 120_000,
	})
	await store.upsert("secret-second", 1, {
		accessToken: "token-b",
		refreshToken: "refresh-b",
		expiresAt: Date.now() + 120_000,
	})
	await saveRegistry(registry, baseDir)
}

function createClient() {
	return {
		app: {
			log: async () => ({ data: true }),
		},
	}
}

test("healthy sticky routing uses the active account", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const store = new MemorySecretStore()
	await seedRegistry(baseDir, store)

	const override = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir,
		secretStore: store,
		fetchImpl: async (_input, init) => new Response(String(new Headers(init?.headers).get("authorization"))),
		capabilityGate: gate(),
	})

	const response = await (override.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(await response.text()).toBe("Bearer token-a")
})

test("expired token refreshes once then succeeds", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const store = new MemorySecretStore()
	await seedRegistry(baseDir, store)
	const registry = await loadRegistry(baseDir)
	registry.accounts[0].expiresAt = Date.now() - 1_000
	await saveRegistry(registry, baseDir)

	let refreshCount = 0
	const override = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir,
		secretStore: store,
		refreshAccount: async () => {
			refreshCount += 1
			return { accessToken: "token-a-refreshed", refreshToken: "refresh-a", expiresAt: Date.now() + 60_000 }
		},
		fetchImpl: async (_input, init) => new Response(String(new Headers(init?.headers).get("authorization"))),
		capabilityGate: gate(),
	})

	const response = await (override.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(await response.text()).toBe("Bearer token-a-refreshed")
	expect(refreshCount).toBe(1)
})

test("account-scoped 429 rotates and ambiguous 429 fails fast without rotation", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const store = new MemorySecretStore()
	await seedRegistry(baseDir, store)

	let calls = 0
	const override = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir,
		secretStore: store,
		fetchImpl: async (_input, init) => {
			calls += 1
			const authHeader = String(new Headers(init?.headers).get("authorization"))
			if (calls === 1) {
				return new Response(`account-scoped throttle:${authHeader}`, {
					status: 429,
					headers: { "retry-after": "60", "x-ratelimit-scope": "account" },
				})
			}
			return new Response(authHeader)
		},
		capabilityGate: gate(),
	})

	const rotated = await (override.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(await rotated.text()).toBe("Bearer token-b")

	const secondBaseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const secondStore = new MemorySecretStore()
	await seedRegistry(secondBaseDir, secondStore)
	const failFastOverride = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir: secondBaseDir,
		secretStore: secondStore,
		fetchImpl: async () => new Response("shared throttle", { status: 429, headers: { "retry-after": "30" } }),
		capabilityGate: gate(),
	})
	const failFast = await (failFastOverride.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(failFast.status).toBe(429)
	expect(failFast.headers.get("x-opencode-earliest-retry")).toBeNull()
})

test("403 org restriction does not rotate and transport failures retry once then rotate", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const store = new MemorySecretStore()
	await seedRegistry(baseDir, store)

	let restrictionCalls = 0
	const noRotate = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir,
		secretStore: store,
		fetchImpl: async (_input, init) => {
			restrictionCalls += 1
			return new Response(`restricted:${new Headers(init?.headers).get("authorization")}`, { status: 403 })
		},
		capabilityGate: gate(),
	})
	const restricted = await (noRotate.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(restrictionCalls).toBe(1)
	expect(restricted.status).toBe(403)

	const secondBaseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const secondStore = new MemorySecretStore()
	await seedRegistry(secondBaseDir, secondStore)
	let transportCalls = 0
	const rotateAfterRetry = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir: secondBaseDir,
		secretStore: secondStore,
		fetchImpl: async (_input, init) => {
			transportCalls += 1
			const authHeader = String(new Headers(init?.headers).get("authorization"))
			if (transportCalls <= 2) throw new Error(`socket hang up:${authHeader}`)
			return new Response(authHeader)
		},
		capabilityGate: gate(),
	})
	const rotated = await (rotateAfterRetry.fetch as typeof fetch)("https://example.com/chat", { method: "POST" })
	expect(await rotated.text()).toBe("Bearer token-b")
})

test("capability gate hard-stops and importDeclined preserves pass-through runtime", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
	const store = new MemorySecretStore()
	await saveRegistry({
		...createEmptyRegistry(),
		importDeclined: true,
	}, baseDir)

	await expect(
		buildCopilotAuthOverride({
			client: createClient(),
			getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
			provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
			baseDir,
			secretStore: store,
			capabilityGate: gate("stop"),
		}),
	).rejects.toThrow("stop v1 and return to design")

	const override = await buildCopilotAuthOverride({
		client: createClient(),
		getAuth: async () => ({ type: "oauth", access: "native", refresh: "native", expires: Date.now() + 60_000 }),
		provider: { id: "github-copilot", name: "GitHub Copilot", source: "test", models: {} } as any,
		baseDir,
		secretStore: store,
		fetchImpl: async () => new Response("native pass-through"),
		capabilityGate: gate(),
	})

	expect(await (override.fetch as typeof fetch)("https://example.com/chat", { method: "POST" }).then((response) => response.text())).toBe(
		"native pass-through",
	)
	const loaded = await loadRegistry(baseDir)
	expect(loaded.importDeclined).toBeTrue()
	})

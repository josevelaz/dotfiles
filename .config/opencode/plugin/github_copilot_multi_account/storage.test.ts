import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { stat } from "node:fs/promises"

import { createSecretStore } from "./keychain"
import { reconcileRegistry, saveRegistry, loadRegistry, mutateRegistry, tombstoneAccount, getRegistryPath } from "./storage"
import { createEmptyRegistry } from "./storage"

test("save and load registry with strict permissions", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-storage-"))
	const registry = createEmptyRegistry()
	registry.accounts.push({
		id: "copilot-acct-aaaa1111bbbb",
		identityKey: "identity-1",
		label: "Account 1",
		secretRef: "secret-1",
		credentialVersion: 1,
		status: "active",
		expiresAt: null,
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

	await saveRegistry(registry, baseDir)
	const loaded = await loadRegistry(baseDir)
	const mode = (await stat(getRegistryPath(baseDir))).mode & 0o777

	expect(loaded.accounts).toHaveLength(1)
	expect(mode).toBe(0o600)
})

test("mutateRegistry serializes concurrent updates and increments revision", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-storage-"))
	await Promise.all([
		mutateRegistry((registry) => {
			registry.accounts.push({
				id: "copilot-acct-first111111",
				identityKey: "identity-1",
				label: "Account 1",
				secretRef: "secret-1",
				credentialVersion: 1,
				status: "active",
				expiresAt: null,
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
			return registry
		}, baseDir),
		mutateRegistry((registry) => {
			registry.importDeclined = true
			return registry
		}, baseDir),
	])

	const loaded = await loadRegistry(baseDir)
	expect(loaded.revision).toBe(2)
	expect(loaded.importDeclined).toBeTrue()
	expect(loaded.accounts).toHaveLength(1)
})

test("reconcile marks missing secrets as recoverable and clears expired shared backoff", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-storage-"))
	const registry = createEmptyRegistry()
	registry.sharedBackoffUntil = Date.now() - 5_000
	registry.sharedBackoffScope = "provider"
	registry.sharedBackoffReason = "shared-429"
	registry.accounts.push({
		id: "copilot-acct-recover111",
		identityKey: "identity-2",
		label: "Account 2",
		secretRef: "secret-2",
		credentialVersion: 3,
		status: "active",
		expiresAt: null,
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
	await saveRegistry(registry, baseDir)

	const secretStore = {
		async upsert() {},
		async read() {
			throw new Error("missing secret ref")
		},
		async listVersions() {
			return [1, 2, 3]
		},
		async removeVersion() {},
		async removeAll() {},
	}

	const reconciled = await reconcileRegistry(secretStore, baseDir)
	expect(reconciled.sharedBackoffUntil).toBeNull()
	expect(reconciled.accounts[0].status).toBe("reauth_required")
	expect(reconciled.accounts[0].recoverableError?.requiresReauth).toBeTrue()
})

test("tombstoned accounts remain removed after reload", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-storage-"))
	const registry = createEmptyRegistry()
	registry.accounts.push({
		id: "copilot-acct-remove1111",
		identityKey: "identity-3",
		label: "Account 3",
		secretRef: "secret-3",
		credentialVersion: 1,
		status: "active",
		expiresAt: null,
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
	await saveRegistry(registry, baseDir)
	await tombstoneAccount("copilot-acct-remove1111", baseDir)

	const loaded = await loadRegistry(baseDir)
	expect(loaded.accounts[0].status).toBe("removed")
	expect(loaded.activeAccountId).toBeNull()
})

test("keychain metadata tracks only this plugin's secret versions", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-storage-"))
	const store = createSecretStore({
		platform: "darwin",
		baseDir,
		runner: async () => ({
			exitCode: 0,
			stdout: '{"accessToken":"a","refreshToken":"r","expiresAt":null}',
			stderr: "",
		}),
	})

	await store.upsert("secret-abc", 10, { accessToken: "a", refreshToken: "r", expiresAt: null })
	await store.upsert("secret-abc", 2, { accessToken: "a", refreshToken: "r", expiresAt: null })
	await store.upsert("other-secret", 5, { accessToken: "b", refreshToken: "r", expiresAt: null })

	expect(await store.listVersions("secret-abc")).toEqual([2, 10])
	await store.removeVersion("secret-abc", 2)
	expect(await store.listVersions("secret-abc")).toEqual([10])
})

test("secret store rejects unsupported platforms", () => {
	expect(() => createSecretStore({ platform: "linux" })).toThrow("supported secret store")
})

import { expect, test } from "bun:test"
import { mkdtemp, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
	applyAccountCooldown,
	applySharedBackoff,
	earliestRetryAt,
	mergeImportedAccount,
	pickEligibleAccount,
} from "./accounts"
import { getLeaseFilePath, withRefreshLease } from "./locks"
import { createEmptyRegistry } from "./storage"

test("mergeImportedAccount updates in place and preserves opaque ids", () => {
	const registry = createEmptyRegistry()
	mergeImportedAccount(registry, {
		identityKey: "identity-1",
		label: "Account 1",
		secretRef: "secret-1",
		credentialVersion: 1,
		expiresAt: null,
		preferred: true,
	})
	const firstId = registry.accounts[0].id

	mergeImportedAccount(registry, {
		identityKey: "identity-1",
		label: "Account 1 updated",
		secretRef: "secret-1b",
		credentialVersion: 2,
		expiresAt: 123,
		preferred: true,
	})

	expect(registry.accounts).toHaveLength(1)
	expect(registry.accounts[0].id).toBe(firstId)
	expect(registry.accounts[0].label).toBe("Account 1 updated")
	expect(firstId.startsWith("copilot-acct-")).toBeTrue()
})

test("pickEligibleAccount walks deterministically after the sticky account", () => {
	const now = Date.now()
	const registry = createEmptyRegistry()
	mergeImportedAccount(registry, {
		identityKey: "identity-a",
		label: "A",
		secretRef: "secret-a",
		credentialVersion: 1,
		expiresAt: null,
		preferred: true,
	})
	mergeImportedAccount(registry, {
		identityKey: "identity-b",
		label: "B",
		secretRef: "secret-b",
		credentialVersion: 1,
		expiresAt: null,
	})
	applyAccountCooldown(registry, registry.activeAccountId!, now + 10_000, "429")

	expect(pickEligibleAccount(registry, now)?.label).toBe("B")
})

test("shared backoff blocks rotation and surfaces earliest retry", () => {
	const now = Date.now()
	const registry = createEmptyRegistry()
	mergeImportedAccount(registry, {
		identityKey: "identity-a",
		label: "A",
		secretRef: "secret-a",
		credentialVersion: 1,
		expiresAt: null,
		preferred: true,
	})
	applySharedBackoff(registry, now + 15_000, "shared-429")

	expect(pickEligibleAccount(registry, now)).toBeNull()
	expect(earliestRetryAt(registry, now)).toBe(now + 15_000)
})

test("same-account refresh lease yields newer credentials to followers", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-lease-"))
	let credentialVersion = 1
	let runCount = 0

	const first = withRefreshLease({
		baseDir,
		accountId: "copilot-acct-lease1111",
		expectedCredentialVersion: 1,
		reloadCurrentVersion: async () => credentialVersion,
		run: async () => {
			runCount += 1
			await new Promise((resolve) => setTimeout(resolve, 50))
			credentialVersion = 2
			return "refreshed"
		},
	})

	await new Promise((resolve) => setTimeout(resolve, 10))
	const second = await withRefreshLease({
		baseDir,
		accountId: "copilot-acct-lease1111",
		expectedCredentialVersion: 1,
		reloadCurrentVersion: async () => credentialVersion,
		run: async () => "unexpected",
	})

	const firstResult = await first
	expect(firstResult).toEqual({ type: "acquired", value: "refreshed" })
	expect(second).toEqual({ type: "newer_credentials_visible", credentialVersion: 2 })
	expect(runCount).toBe(1)
})

test("lease files are created with strict permissions", async () => {
	const baseDir = await mkdtemp(path.join(os.tmpdir(), "copilot-lease-"))
	let leaseMode = 0

	await withRefreshLease({
		baseDir,
		accountId: "copilot-acct-lease2222",
		expectedCredentialVersion: 1,
		reloadCurrentVersion: async () => 1,
		run: async () => {
			leaseMode = (await stat(getLeaseFilePath("copilot-acct-lease2222", baseDir))).mode & 0o777
			return "ok"
		},
	})

	expect(leaseMode).toBe(0o600)
})

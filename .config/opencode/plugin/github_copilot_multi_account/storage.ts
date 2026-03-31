import { constants as fsConstants } from "node:fs"
import { access, chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { Mutex } from "./mutex"

import { accountRegistrySchema } from "./schema"
import {
	LEASE_DIRECTORY_NAME,
	PLUGIN_ID,
	REGISTRY_FILE_NAME,
	type AccountRegistry,
	type CopilotAccountRecord,
	type RecoverableErrorState,
	type SecretStore,
} from "./types"

const registryMutex = new Mutex()

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getUserScopedStateRoot(baseDir?: string): string {
	if (baseDir) return baseDir
	const home = os.homedir()
	if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "opencode", "plugins")
	if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "opencode", "plugins")
	return path.join(home, ".local", "share", "opencode", "plugins")
}

export function getPluginStateDir(baseDir?: string): string {
	return path.join(getUserScopedStateRoot(baseDir), PLUGIN_ID)
}

export function getRegistryPath(baseDir?: string): string {
	return path.join(getPluginStateDir(baseDir), REGISTRY_FILE_NAME)
}

export function getRegistryLockPath(baseDir?: string): string {
	return path.join(getPluginStateDir(baseDir), "registry.lock")
}

export function getLeaseDirectory(baseDir?: string): string {
	return path.join(getPluginStateDir(baseDir), LEASE_DIRECTORY_NAME)
}

export async function ensureStateDirectories(baseDir?: string): Promise<void> {
	const pluginStateDir = getPluginStateDir(baseDir)
	const leaseDir = getLeaseDirectory(baseDir)
	await mkdir(pluginStateDir, { recursive: true, mode: 0o700 })
	await mkdir(leaseDir, { recursive: true, mode: 0o700 })
	await chmod(pluginStateDir, 0o700)
	await chmod(leaseDir, 0o700)
}

export function createEmptyRegistry(): AccountRegistry {
	return {
		version: 1,
		revision: 0,
		importDeclined: false,
		activeAccountId: null,
		sharedBackoffUntil: null,
		sharedBackoffScope: null,
		sharedBackoffReason: null,
		accounts: [],
	}
}

async function acquireRegistryLock(baseDir?: string, timeoutMs = 2_000): Promise<() => Promise<void>> {
	await ensureStateDirectories(baseDir)
	const lockPath = getRegistryLockPath(baseDir)
	const deadline = Date.now() + timeoutMs

	while (true) {
		try {
			const handle = await open(lockPath, "wx", 0o600)
			await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
			await handle.close()
			await chmod(lockPath, 0o600)
			return async () => {
				await rm(lockPath, { force: true })
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
			try {
				const currentStat = await stat(lockPath)
				if (Date.now() - currentStat.mtimeMs > 5_000) {
					await rm(lockPath, { force: true })
					continue
				}
			} catch {
				continue
			}
			if (Date.now() >= deadline) throw new Error("Timed out waiting for registry lock")
			await sleep(50)
		}
	}
}

async function writeRegistryFile(filePath: string, registry: AccountRegistry): Promise<void> {
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
	await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
	await chmod(tmpPath, 0o600)
	await rename(tmpPath, filePath)
	await chmod(filePath, 0o600)
}

export async function loadRegistry(baseDir?: string): Promise<AccountRegistry> {
	await ensureStateDirectories(baseDir)
	const filePath = getRegistryPath(baseDir)
	try {
		await access(filePath, fsConstants.F_OK)
	} catch {
		return createEmptyRegistry()
	}
	const raw = await readFile(filePath, "utf8")
	return accountRegistrySchema.parse(JSON.parse(raw)) as AccountRegistry
}

export async function saveRegistry(registry: AccountRegistry, baseDir?: string): Promise<AccountRegistry> {
	await ensureStateDirectories(baseDir)
	const parsed = accountRegistrySchema.parse(registry) as AccountRegistry
	await writeRegistryFile(getRegistryPath(baseDir), parsed)
	return parsed
}

export async function mutateRegistry(
	mutator: (registry: AccountRegistry) => AccountRegistry | Promise<AccountRegistry>,
	baseDir?: string,
): Promise<AccountRegistry> {
	return registryMutex.runExclusive(async () => {
		const release = await acquireRegistryLock(baseDir)
		try {
			const current = await loadRegistry(baseDir)
			const next = await mutator(structuredClone(current))
			next.revision = current.revision + 1
			return await saveRegistry(next, baseDir)
		} finally {
			await release()
		}
	})
}

function createRecoverableError(message: string): RecoverableErrorState {
	return {
		code: "secret_missing",
		message,
		detectedAt: Date.now(),
		requiresReauth: true,
	}
}

export async function reconcileRegistry(secretStore: SecretStore, baseDir?: string): Promise<AccountRegistry> {
	return mutateRegistry(async (registry) => {
		const now = Date.now()
		if (registry.sharedBackoffUntil !== null && registry.sharedBackoffUntil <= now) {
			registry.sharedBackoffUntil = null
			registry.sharedBackoffScope = null
			registry.sharedBackoffReason = null
		}

		const nextAccounts: CopilotAccountRecord[] = []
		for (const account of registry.accounts) {
			if (account.status === "removed") {
				nextAccounts.push(account)
				continue
			}

			try {
				await secretStore.read(account.secretRef, account.credentialVersion)
				account.recoverableError = null
				const versions = await secretStore.listVersions(account.secretRef)
				for (const version of versions) {
					if (version < account.credentialVersion) await secretStore.removeVersion(account.secretRef, version)
				}
			} catch (error) {
				account.recoverableError = createRecoverableError((error as Error).message)
				account.status = "reauth_required"
			}

			nextAccounts.push(account)
		}

		registry.accounts = nextAccounts
		return registry
	}, baseDir)
}

export async function tombstoneAccount(accountId: string, baseDir?: string): Promise<AccountRegistry> {
	return mutateRegistry((registry) => {
		registry.accounts = registry.accounts.map((account) => {
			if (account.id !== accountId) return account
			return {
				...account,
				status: "removed",
				preferred: false,
				cooldownUntil: null,
			}
		})
		if (registry.activeAccountId === accountId) registry.activeAccountId = null
		return registry
	}, baseDir)
}

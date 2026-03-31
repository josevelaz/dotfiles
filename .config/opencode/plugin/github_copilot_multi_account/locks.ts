import { chmod, open, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { LEASE_POLL_MS, LEASE_TIMEOUT_MS, LEASE_TTL_MS, type RefreshLease, type RefreshLeaseOutcome } from "./types"
import { ensureStateDirectories, getLeaseDirectory } from "./storage"

type LeaseOptions<T> = {
	baseDir?: string
	accountId: string
	expectedCredentialVersion: number
	reloadCurrentVersion: () => Promise<number>
	run: () => Promise<T>
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

const OWNER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(16).slice(2, 10)}`

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getLeaseFilePath(accountId: string, baseDir?: string): string {
	return path.join(getLeaseDirectory(baseDir), `${accountId}.lease.json`)
}

async function readLease(filePath: string): Promise<RefreshLease | null> {
	try {
		const raw = await readFile(filePath, "utf8")
		return JSON.parse(raw) as RefreshLease
	} catch {
		return null
	}
}

async function tryAcquireLease(
	filePath: string,
	lease: RefreshLease,
	now: () => number,
): Promise<"acquired" | "retry"> {
	try {
		const handle = await open(filePath, "wx", 0o600)
		await handle.writeFile(`${JSON.stringify(lease)}\n`)
		await handle.close()
		await chmod(filePath, 0o600)
		return "acquired"
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
		const current = await readLease(filePath)
		if (!current) return "retry"
		if (current.expiresAt <= now()) {
			await rm(filePath, { force: true })
			return "retry"
		}
		return "retry"
	}
}

export function assertCredentialVersion(expected: number, current: number): void {
	if (current < expected) throw new Error(`Credential version regressed from ${expected} to ${current}`)
}

export async function withRefreshLease<T>(options: LeaseOptions<T>): Promise<RefreshLeaseOutcome<T>> {
	const now = options.now ?? Date.now
	const sleep = options.sleep ?? defaultSleep
	await ensureStateDirectories(options.baseDir)
	const filePath = getLeaseFilePath(options.accountId, options.baseDir)
	const deadline = now() + LEASE_TIMEOUT_MS

	while (now() < deadline) {
		const currentVersion = await options.reloadCurrentVersion()
		if (currentVersion > options.expectedCredentialVersion) {
			assertCredentialVersion(options.expectedCredentialVersion, currentVersion)
			return { type: "newer_credentials_visible", credentialVersion: currentVersion }
		}

		const lease: RefreshLease = {
			accountId: options.accountId,
			ownerId: OWNER_ID,
			expiresAt: now() + LEASE_TTL_MS,
			expectedCredentialVersion: options.expectedCredentialVersion,
		}
		const acquired = await tryAcquireLease(filePath, lease, now)
		if (acquired === "acquired") {
			try {
				return { type: "acquired", value: await options.run() }
			} finally {
				await rm(filePath, { force: true })
			}
		}

		const existingLease = await readLease(filePath)
		if (existingLease && existingLease.expiresAt <= now()) {
			await rm(filePath, { force: true })
			return { type: "retry" }
		}

		await sleep(Math.min(LEASE_POLL_MS, Math.max(0, deadline - now())))
	}

	const currentVersion = await options.reloadCurrentVersion()
	if (currentVersion > options.expectedCredentialVersion) {
		assertCredentialVersion(options.expectedCredentialVersion, currentVersion)
		return { type: "newer_credentials_visible", credentialVersion: currentVersion }
	}

	return { type: "timed_out" }
}

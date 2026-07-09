/**
 * Multi-account credential store for the multi-auth plugin.
 *
 * Per-provider JSON at `~/.local/share/opencode/multi-auth/<provider>.json`
 * with 0600 files, 0700 directory, atomic writes, and advisory cross-process
 * locking. Tokens live only in the store file — lock files never carry them.
 *
 * @module multi-auth/store
 */

import { randomBytes } from "node:crypto"
import * as fsSync from "node:fs"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

// =============================================================================
// CONSTANTS
// =============================================================================

/** File mode for all token-bearing and hygiene-sensitive artifacts (F3). */
export const FILE_MODE = 0o600

/** Directory mode for the multi-auth base directory. */
export const DIR_MODE = 0o700

const STORE_VERSION = 1

const ACCOUNT_STATES = ["available", "cooling_down", "needs_reauth", "disabled"] as const

const DEFAULT_LOCK_STALE_MS = 30_000
const DEFAULT_LOCK_MAX_ATTEMPTS = 50
const DEFAULT_LOCK_BASE_DELAY_MS = 10
const DEFAULT_LOCK_MAX_DELAY_MS = 200

const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

// =============================================================================
// TYPES
// =============================================================================

export type AccountState = (typeof ACCOUNT_STATES)[number]

/** OAuth account record stored under a user-chosen label. */
export type OAuthAccount = {
	type: "oauth"
	access: string
	refresh: string
	expires: number
	state: AccountState
	resetAt: number | null
	addedAt: number
	lastUsedAt: number | null
	lastExhaustedAt: number | null
	meta?: Record<string, unknown>
}

/** Versioned multi-account store document. */
export type StoreData = {
	version: number
	accounts: Record<string, OAuthAccount>
}

export type MultiAuthStoreOptions = {
	/** Override base directory (injectable for tests). Default: ~/.local/share/opencode/multi-auth */
	baseDir?: string
	/** Age after which a lock is considered stale (ms). */
	lockStaleMs?: number
	/** Max lock acquisition attempts before giving up. */
	lockMaxAttempts?: number
	/** Initial backoff delay for lock retries (ms). */
	lockBaseDelayMs?: number
	/** Cap on lock retry backoff (ms). */
	lockMaxDelayMs?: number
}

export type AtomicWriteOptions = {
	/**
	 * Test hook: invoked after the temp file is written and closed, before rename.
	 * Throwing leaves the temp file in place (crash simulation).
	 * @internal
	 */
	_beforeRename?: (tempPath: string) => void | Promise<void>
}

export type LockInfo = {
	pid: number
	hostname: string
	timestamp: number
}

// =============================================================================
// ERRORS
// =============================================================================

export class StorePermissionError extends Error {
	readonly path: string
	readonly mode: number

	constructor(filePath: string, mode: number) {
		const octal = (mode & 0o777).toString(8).padStart(3, "0")
		super(
			`Refusing to read multi-auth store at ${filePath}: mode 0${octal} is group/world-accessible (must be 0600)`,
		)
		this.name = "StorePermissionError"
		this.path = filePath
		this.mode = mode
	}
}

export class StoreLockError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "StoreLockError"
	}
}

export class StoreSchemaError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "StoreSchemaError"
	}
}

// =============================================================================
// PATHS / EMPTY STORE
// =============================================================================

/** Default base directory: ~/.local/share/opencode/multi-auth */
export function defaultBaseDir(): string {
	return path.join(os.homedir(), ".local", "share", "opencode", "multi-auth")
}

/** Empty versioned store document. */
export function emptyStore(): StoreData {
	return { version: STORE_VERSION, accounts: {} }
}

function assertProviderId(provider: string): string {
	if (!provider || !PROVIDER_ID_RE.test(provider)) {
		throw new Error(
			`Invalid multi-auth provider id ${JSON.stringify(provider)}: use alphanumeric, dot, underscore, or hyphen`,
		)
	}
	return provider
}

// =============================================================================
// SCHEMA / MIGRATION
// =============================================================================

function isAccountState(value: unknown): value is AccountState {
	return typeof value === "string" && (ACCOUNT_STATES as readonly string[]).includes(value)
}

function parseOAuthAccount(label: string, raw: unknown): OAuthAccount {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)} is not an object`)
	}
	const a = raw as Record<string, unknown>
	if (a.type !== "oauth") {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: unsupported type ${JSON.stringify(a.type)}`)
	}
	if (typeof a.access !== "string" || typeof a.refresh !== "string") {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: access/refresh must be strings`)
	}
	if (typeof a.expires !== "number" || !Number.isFinite(a.expires)) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: expires must be a number`)
	}
	if (!isAccountState(a.state)) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: invalid state ${JSON.stringify(a.state)}`)
	}
	if (a.resetAt !== null && (typeof a.resetAt !== "number" || !Number.isFinite(a.resetAt))) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: resetAt must be number|null`)
	}
	if (typeof a.addedAt !== "number" || !Number.isFinite(a.addedAt)) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: addedAt must be a number`)
	}
	if (a.lastUsedAt !== null && (typeof a.lastUsedAt !== "number" || !Number.isFinite(a.lastUsedAt))) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: lastUsedAt must be number|null`)
	}
	if (
		a.lastExhaustedAt !== null &&
		(typeof a.lastExhaustedAt !== "number" || !Number.isFinite(a.lastExhaustedAt))
	) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: lastExhaustedAt must be number|null`)
	}
	if (a.meta !== undefined && (typeof a.meta !== "object" || a.meta === null || Array.isArray(a.meta))) {
		throw new StoreSchemaError(`Account ${JSON.stringify(label)}: meta must be an object when present`)
	}

	const account: OAuthAccount = {
		type: "oauth",
		access: a.access,
		refresh: a.refresh,
		expires: a.expires,
		state: a.state,
		resetAt: a.resetAt as number | null,
		addedAt: a.addedAt,
		lastUsedAt: a.lastUsedAt as number | null,
		lastExhaustedAt: a.lastExhaustedAt as number | null,
	}
	if (a.meta !== undefined) {
		account.meta = { ...(a.meta as Record<string, unknown>) }
	}
	return account
}

/**
 * Migrate a parsed JSON value to the current store schema.
 * Version 1 is a passthrough; unknown future versions throw.
 */
export function migrate(raw: unknown): StoreData {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new StoreSchemaError("Store root must be an object")
	}
	const doc = raw as Record<string, unknown>
	const version = doc.version

	if (typeof version !== "number" || !Number.isInteger(version)) {
		throw new StoreSchemaError(`Invalid store version: ${JSON.stringify(version)}`)
	}

	switch (version) {
		case 1: {
			if (!doc.accounts || typeof doc.accounts !== "object" || Array.isArray(doc.accounts)) {
				throw new StoreSchemaError("Store accounts must be an object")
			}
			const accounts: Record<string, OAuthAccount> = {}
			for (const [label, value] of Object.entries(doc.accounts as Record<string, unknown>)) {
				accounts[label] = parseOAuthAccount(label, value)
			}
			return { version: 1, accounts }
		}
		default:
			throw new StoreSchemaError(`Unsupported store version ${version}; expected 1`)
	}
}

// =============================================================================
// PERMISSIONS / ATOMIC I/O
// =============================================================================

/** True when mode has any group/other permission bits set. */
export function isGroupOrWorldAccessible(mode: number): boolean {
	return (mode & 0o077) !== 0
}

/**
 * Refuse to use a file that is group- or world-accessible.
 * Missing files are allowed (caller handles ENOENT).
 */
export async function assertSecureFile(filePath: string): Promise<void> {
	let st: fsSync.Stats
	try {
		st = await fs.stat(filePath)
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code
		if (code === "ENOENT") return
		throw err
	}
	if (!st.isFile()) {
		throw new StorePermissionError(filePath, st.mode)
	}
	if (isGroupOrWorldAccessible(st.mode)) {
		throw new StorePermissionError(filePath, st.mode)
	}
}

/**
 * Write `content` via temp file opened with explicit mode 0600 (O_CREAT|O_EXCL|O_WRONLY),
 * then rename over `targetPath`. Never relies on process umask for the final mode (F3).
 */
export async function writeFileAtomic(
	targetPath: string,
	content: string,
	options?: AtomicWriteOptions,
): Promise<void> {
	const dir = path.dirname(targetPath)
	const token = randomBytes(8).toString("hex")
	const tempPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${token}.tmp`)

	const flags = fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_WRONLY
	const handle = await fs.open(tempPath, flags, FILE_MODE)
	try {
		await handle.writeFile(content, "utf8")
		await handle.sync()
	} catch (err) {
		await handle.close().catch(() => {})
		await fs.unlink(tempPath).catch(() => {})
		throw err
	}
	await handle.close()

	// Crash-simulation path: if _beforeRename throws, leave the temp file (0600) in place.
	let crashSimulated = false
	try {
		if (options?._beforeRename) {
			try {
				await options._beforeRename(tempPath)
			} catch (err) {
				crashSimulated = true
				throw err
			}
		}
		await fs.rename(tempPath, targetPath)
	} catch (err) {
		if (!crashSimulated) {
			await fs.unlink(tempPath).catch(() => {})
		}
		throw err
	}
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function lockPayload(): LockInfo {
	return {
		pid: process.pid,
		hostname: os.hostname(),
		timestamp: Date.now(),
	}
}

function parseLockInfo(raw: string): LockInfo | null {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>
		if (
			typeof parsed.pid === "number" &&
			Number.isInteger(parsed.pid) &&
			typeof parsed.hostname === "string" &&
			typeof parsed.timestamp === "number"
		) {
			return {
				pid: parsed.pid,
				hostname: parsed.hostname,
				timestamp: parsed.timestamp,
			}
		}
		return null
	} catch {
		return null
	}
}

function isPidAlive(pid: number): boolean {
	if (pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

// =============================================================================
// STORE
// =============================================================================

/**
 * Plugin-owned multi-account credential store for one provider.
 *
 * ```ts
 * const store = new MultiAuthStore("anthropic", { baseDir: tmp })
 * await store.upsertAccount("work", account)
 * const data = await store.read()
 * await store.mutate((d) => { d.accounts["work"].state = "cooling_down" })
 * ```
 */
export class MultiAuthStore {
	readonly provider: string
	readonly baseDir: string
	readonly storePath: string
	readonly lockPath: string

	private readonly lockStaleMs: number
	private readonly lockMaxAttempts: number
	private readonly lockBaseDelayMs: number
	private readonly lockMaxDelayMs: number

	/** Optional mtime-based cache for cheap per-request re-reads. */
	private cache: { mtimeMs: number; data: StoreData } | null = null

	constructor(provider: string, options: MultiAuthStoreOptions = {}) {
		this.provider = assertProviderId(provider)
		this.baseDir = options.baseDir ?? defaultBaseDir()
		this.storePath = path.join(this.baseDir, `${this.provider}.json`)
		this.lockPath = `${this.storePath}.lock`
		this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS
		this.lockMaxAttempts = options.lockMaxAttempts ?? DEFAULT_LOCK_MAX_ATTEMPTS
		this.lockBaseDelayMs = options.lockBaseDelayMs ?? DEFAULT_LOCK_BASE_DELAY_MS
		this.lockMaxDelayMs = options.lockMaxDelayMs ?? DEFAULT_LOCK_MAX_DELAY_MS
	}

	/** Invalidate the mtime cache (e.g. after external mutation). */
	invalidateCache(): void {
		this.cache = null
	}

	/**
	 * Read the store. Missing file → empty versioned document.
	 * Corrupt JSON/schema → backup (0600) + empty store written.
	 * Group/world-readable store → StorePermissionError.
	 */
	async read(): Promise<StoreData> {
		return this.readUnlocked()
	}

	/**
	 * Cheap re-read: returns cached data when mtime is unchanged.
	 * Still enforces permission checks when the file is (re)loaded.
	 */
	async readCached(): Promise<StoreData> {
		let st: fsSync.Stats | null = null
		try {
			st = await fs.stat(this.storePath)
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				this.cache = null
				return emptyStore()
			}
			throw err
		}

		if (this.cache && this.cache.mtimeMs === st.mtimeMs) {
			return structuredClone(this.cache.data)
		}

		const data = await this.readUnlocked()
		this.cache = { mtimeMs: st.mtimeMs, data: structuredClone(data) }
		return data
	}

	/**
	 * Read-modify-write under the advisory lock.
	 * Always re-reads after acquiring the lock before invoking `fn`.
	 */
	async mutate<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
		const release = await this.acquireLock()
		try {
			const data = await this.readUnlocked()
			const result = await fn(data)
			await this.writeUnlocked(data)
			this.invalidateCache()
			return result
		} finally {
			await release()
		}
	}

	async getAccount(label: string): Promise<OAuthAccount | null> {
		const data = await this.read()
		const account = data.accounts[label]
		return account ? structuredClone(account) : null
	}

	async listAccounts(): Promise<Array<{ label: string } & OAuthAccount>> {
		const data = await this.read()
		return Object.entries(data.accounts).map(([label, account]) => ({
			label,
			...structuredClone(account),
		}))
	}

	async upsertAccount(label: string, account: OAuthAccount): Promise<void> {
		if (!label || typeof label !== "string") {
			throw new Error("Account label is required")
		}
		// Validate shape via migrate path
		parseOAuthAccount(label, account)
		await this.mutate((data) => {
			data.accounts[label] = structuredClone(account)
		})
	}

	async removeAccount(label: string): Promise<boolean> {
		return this.mutate((data) => {
			if (!(label in data.accounts)) return false
			delete data.accounts[label]
			return true
		})
	}

	async setState(
		label: string,
		state: AccountState,
		resetAt: number | null = null,
	): Promise<void> {
		if (!isAccountState(state)) {
			throw new Error(`Invalid account state: ${JSON.stringify(state)}`)
		}
		await this.mutate((data) => {
			const account = data.accounts[label]
			if (!account) {
				throw new Error(`Unknown account label: ${JSON.stringify(label)}`)
			}
			account.state = state
			account.resetAt = resetAt
			if (state === "cooling_down") {
				account.lastExhaustedAt = Date.now()
			}
		})
	}

	async touchLastUsed(label: string, at: number = Date.now()): Promise<void> {
		await this.mutate((data) => {
			const account = data.accounts[label]
			if (!account) {
				throw new Error(`Unknown account label: ${JSON.stringify(label)}`)
			}
			account.lastUsedAt = at
		})
	}

	// ---------------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------------

	private async ensureDir(): Promise<void> {
		await fs.mkdir(this.baseDir, { recursive: true, mode: DIR_MODE })
		// mkdir recursive may not apply mode on an existing tree — enforce 0700.
		await fs.chmod(this.baseDir, DIR_MODE)
	}

	private async readUnlocked(): Promise<StoreData> {
		try {
			await assertSecureFile(this.storePath)
			const raw = await fs.readFile(this.storePath, "utf8")
			try {
				const parsed: unknown = JSON.parse(raw)
				return migrate(parsed)
			} catch (err) {
				// Corrupt JSON or schema — backup + reset.
				await this.recoverCorrupt(raw)
				return emptyStore()
			}
		} catch (err) {
			if (err instanceof StorePermissionError) throw err
			const code = (err as NodeJS.ErrnoException).code
			if (code === "ENOENT") {
				return emptyStore()
			}
			throw err
		}
	}

	private async writeUnlocked(data: StoreData): Promise<void> {
		// Re-validate before persist
		const normalized = migrate(data)
		await this.ensureDir()
		const payload = `${JSON.stringify(normalized, null, 2)}\n`
		await writeFileAtomic(this.storePath, payload)
		// Enforce 0600 post-rename in case the target existed with looser mode
		// and the platform preserved destination mode on replace (defensive).
		await fs.chmod(this.storePath, FILE_MODE)
	}

	/**
	 * Move corrupt content to `<store>.bak-<timestamp>` with explicit 0600,
	 * then write a fresh empty store.
	 */
	private async recoverCorrupt(raw: string): Promise<void> {
		await this.ensureDir()
		const bakPath = `${this.storePath}.bak-${Date.now()}`
		await writeFileAtomic(bakPath, raw)
		await fs.chmod(bakPath, FILE_MODE).catch(() => {})
		const empty = emptyStore()
		const payload = `${JSON.stringify(empty, null, 2)}\n`
		await writeFileAtomic(this.storePath, payload)
		await fs.chmod(this.storePath, FILE_MODE).catch(() => {})
		this.invalidateCache()
	}

	/**
	 * Acquire advisory lock via O_EXCL lock file containing only {pid,hostname,timestamp}.
	 * Returns a release function that unlinks the lock file.
	 */
	async acquireLock(): Promise<() => Promise<void>> {
		await this.ensureDir()

		for (let attempt = 0; attempt < this.lockMaxAttempts; attempt++) {
			try {
				const flags =
					fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_WRONLY
				const handle = await fs.open(this.lockPath, flags, FILE_MODE)
				try {
					const info = lockPayload()
					await handle.writeFile(`${JSON.stringify(info)}\n`, "utf8")
				} finally {
					await handle.close().catch(() => {})
				}

				return async () => {
					await fs.unlink(this.lockPath).catch(() => {})
				}
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code
				if (code !== "EEXIST") throw err

				const stale = await this.tryClearStaleLock()
				if (!stale) {
					const delay = Math.min(
						this.lockMaxDelayMs,
						this.lockBaseDelayMs * 2 ** Math.min(attempt, 6),
					)
					// Jitter to reduce thundering herd
					const jitter = Math.floor(Math.random() * delay * 0.25)
					await sleep(delay + jitter)
				}
			}
		}

		throw new StoreLockError(
			`Timed out acquiring multi-auth store lock at ${this.lockPath} after ${this.lockMaxAttempts} attempts`,
		)
	}

	/** Returns true if a stale lock was removed. */
	private async tryClearStaleLock(): Promise<boolean> {
		let raw: string
		try {
			raw = await fs.readFile(this.lockPath, "utf8")
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code
			if (code === "ENOENT") return true
			return false
		}

		const info = parseLockInfo(raw)
		const now = Date.now()

		let stale = false
		if (!info) {
			// Unparseable lock — treat as stale after age check via mtime
			try {
				const st = await fs.stat(this.lockPath)
				stale = now - st.mtimeMs > this.lockStaleMs
			} catch {
				stale = true
			}
		} else {
			const age = now - info.timestamp
			const deadPid = info.hostname === os.hostname() && !isPidAlive(info.pid)
			stale = deadPid || age > this.lockStaleMs
		}

		if (!stale) return false

		try {
			await fs.unlink(this.lockPath)
			return true
		} catch {
			return false
		}
	}
}

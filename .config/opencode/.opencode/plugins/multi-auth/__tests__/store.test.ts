/**
 * Unit tests for multi-auth credential store (locking, permissions, F3).
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
	FILE_MODE,
	MultiAuthStore,
	StorePermissionError,
	emptyStore,
	migrate,
	writeFileAtomic,
	type OAuthAccount,
} from "../store"

// =============================================================================
// HELPERS
// =============================================================================

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "multi-auth-store-"))
	tempDirs.push(dir)
	return dir
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
	}
})

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
		meta: { email_hint: "j***@work.com" },
		...overrides,
	}
}

function modeOf(filePath: string): Promise<number> {
	return fs.stat(filePath).then((st) => st.mode & 0o777)
}

// =============================================================================
// BASIC CRUD / SCHEMA
// =============================================================================

describe("MultiAuthStore basics", () => {
	test("read missing file returns empty versioned store", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		const data = await store.read()
		expect(data).toEqual(emptyStore())
		expect(data.version).toBe(1)
	})

	test("upsertAccount + read round-trip", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		const account = sampleAccount({ access: "tok-1", refresh: "ref-1" })
		await store.upsertAccount("work-max", account)

		const data = await store.read()
		expect(data.version).toBe(1)
		expect(data.accounts["work-max"]?.access).toBe("tok-1")
		expect(data.accounts["work-max"]?.refresh).toBe("ref-1")
		expect(await modeOf(store.storePath)).toBe(FILE_MODE)
		expect(await modeOf(baseDir)).toBe(0o700)
	})

	test("setState and touchLastUsed", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await store.upsertAccount("a", sampleAccount())

		const resetAt = Date.now() + 60_000
		await store.setState("a", "cooling_down", resetAt)
		const usedAt = 1_750_001_000_000
		await store.touchLastUsed("a", usedAt)

		const account = await store.getAccount("a")
		expect(account?.state).toBe("cooling_down")
		expect(account?.resetAt).toBe(resetAt)
		expect(account?.lastUsedAt).toBe(usedAt)
		expect(account?.lastExhaustedAt).toBeNumber()
	})

	test("removeAccount", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await store.upsertAccount("a", sampleAccount())
		expect(await store.removeAccount("a")).toBe(true)
		expect(await store.removeAccount("a")).toBe(false)
		expect(await store.getAccount("a")).toBeNull()
	})

	test("migrate version 1 passthrough; unknown version throws", () => {
		const raw = {
			version: 1,
			accounts: {
				x: sampleAccount({ access: "a", refresh: "r" }),
			},
		}
		const migrated = migrate(raw)
		expect(migrated.version).toBe(1)
		expect(migrated.accounts.x.access).toBe("a")
		expect(() => migrate({ version: 99, accounts: {} })).toThrow(/Unsupported store version/)
	})

	test("readCached returns same data until mtime changes", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await store.upsertAccount("a", sampleAccount({ access: "v1" }))

		const first = await store.readCached()
		const second = await store.readCached()
		expect(second.accounts.a.access).toBe(first.accounts.a.access)

		await store.upsertAccount("a", sampleAccount({ access: "v2" }))
		const third = await store.readCached()
		expect(third.accounts.a.access).toBe("v2")
	})
})

// =============================================================================
// CONCURRENT MUTATE
// =============================================================================

describe("concurrent mutate", () => {
	test("parallel mutations do not lose updates or corrupt JSON", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", {
			baseDir,
			lockStaleMs: 5_000,
			lockMaxAttempts: 100,
			lockBaseDelayMs: 5,
			lockMaxDelayMs: 50,
		})

		const N = 24
		await Promise.all(
			Array.from({ length: N }, (_, i) =>
				store.mutate((data) => {
					// Counter in a reserved account meta — each mutation increments once.
					const key = "__counter__"
					const existing = data.accounts[key]
					const prev =
						existing && typeof existing.meta?.count === "number" ? existing.meta.count : 0
					data.accounts[key] = sampleAccount({
						access: `counter-access-${i}`,
						refresh: `counter-refresh-${i}`,
						meta: { count: prev + 1 },
					})
					// Also write a unique account so lost keys are visible
					data.accounts[`acc-${i}`] = sampleAccount({
						access: `access-${i}`,
						refresh: `refresh-${i}`,
					})
				}),
			),
		)

		const data = await store.read()
		// Valid JSON / schema
		expect(data.version).toBe(1)
		expect(data.accounts.__counter__?.meta?.count).toBe(N)
		for (let i = 0; i < N; i++) {
			expect(data.accounts[`acc-${i}`]).toBeDefined()
		}
		// File still secure
		expect(await modeOf(store.storePath)).toBe(FILE_MODE)
	})
})

// =============================================================================
// PERMISSION ENFORCEMENT
// =============================================================================

describe("permission enforcement", () => {
	test("read refuses group/world-readable store (0644)", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await store.upsertAccount("a", sampleAccount())

		await fs.chmod(store.storePath, 0o644)
		expect(await modeOf(store.storePath)).toBe(0o644)

		await expect(store.read()).rejects.toBeInstanceOf(StorePermissionError)
		await expect(store.read()).rejects.toThrow(/group\/world-accessible/)
	})

	test("mutate also refuses insecure store", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await store.upsertAccount("a", sampleAccount())
		await fs.chmod(store.storePath, 0o644)

		await expect(store.mutate((d) => d)).rejects.toBeInstanceOf(StorePermissionError)
	})
})

// =============================================================================
// CORRUPT-FILE RECOVERY
// =============================================================================

describe("corrupt-file recovery", () => {
	test("garbage JSON → backup created (0600) + fresh empty store", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })

		// Seed a real store so the path exists, then overwrite with garbage
		await store.upsertAccount("a", sampleAccount())
		await fs.writeFile(store.storePath, "{not-json!!!", { mode: FILE_MODE })
		await fs.chmod(store.storePath, FILE_MODE)

		const data = await store.read()
		expect(data).toEqual(emptyStore())

		const entries = await fs.readdir(baseDir)
		const bak = entries.find((e) => e.startsWith("anthropic.json.bak-"))
		expect(bak).toBeDefined()

		const bakPath = path.join(baseDir, bak!)
		expect(await modeOf(bakPath)).toBe(FILE_MODE)
		const bakContent = await fs.readFile(bakPath, "utf8")
		expect(bakContent).toBe("{not-json!!!")

		// Store file is valid empty document
		const onDisk = JSON.parse(await fs.readFile(store.storePath, "utf8"))
		expect(onDisk).toEqual(emptyStore())
		expect(await modeOf(store.storePath)).toBe(FILE_MODE)
	})

	test("schema-invalid JSON also recovers", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })
		await fs.mkdir(baseDir, { recursive: true, mode: 0o700 })
		await fs.writeFile(
			store.storePath,
			JSON.stringify({ version: 1, accounts: { bad: { type: "nope" } } }),
			{ mode: FILE_MODE },
		)
		await fs.chmod(store.storePath, FILE_MODE)

		const data = await store.read()
		expect(data.accounts).toEqual({})
		const entries = await fs.readdir(baseDir)
		expect(entries.some((e) => e.includes(".bak-"))).toBe(true)
	})
})

// =============================================================================
// F3: EXPLICIT 0600 REGARDLESS OF UMASK
// =============================================================================

describe("F3 file modes (umask-independent)", () => {
	test("temp/backup/store files are 0600 under permissive umask", async () => {
		const previous = process.umask(0o000)
		try {
			const baseDir = await makeTempDir()
			const store = new MultiAuthStore("anthropic", { baseDir })
			await store.upsertAccount("a", sampleAccount({ access: "secret-access", refresh: "secret-refresh" }))

			expect(await modeOf(store.storePath)).toBe(0o600)
			expect(await modeOf(baseDir)).toBe(0o700)

			// Force corrupt recovery to create a backup under permissive umask
			await fs.writeFile(store.storePath, "CORRUPT{{{", { mode: 0o666 })
			// Even if writeFile used 666, recovery backup must be 0600
			await store.read()

			const entries = await fs.readdir(baseDir)
			const bak = entries.find((e) => e.includes(".bak-"))
			expect(bak).toBeDefined()
			expect(await modeOf(path.join(baseDir, bak!))).toBe(0o600)
			expect(await modeOf(store.storePath)).toBe(0o600)
		} finally {
			process.umask(previous)
		}
	})

	test("simulated-crash temp residue is 0600", async () => {
		const previous = process.umask(0o000)
		try {
			const baseDir = await makeTempDir()
			const target = path.join(baseDir, "anthropic.json")
			await fs.mkdir(baseDir, { recursive: true, mode: 0o700 })

			let capturedTemp: string | undefined
			await expect(
				writeFileAtomic(target, JSON.stringify({ tokens: "SECRET_VALUE_xyz" }), {
					_beforeRename: async (tempPath) => {
						capturedTemp = tempPath
						expect(await modeOf(tempPath)).toBe(0o600)
						throw new Error("simulated crash before rename")
					},
				}),
			).rejects.toThrow(/simulated crash/)

			expect(capturedTemp).toBeDefined()
			// Temp residue still present with 0600
			const st = await fs.stat(capturedTemp!)
			expect(st.isFile()).toBe(true)
			expect(st.mode & 0o777).toBe(0o600)
			// Target must not have been replaced
			await expect(fs.stat(target)).rejects.toThrow()
		} finally {
			process.umask(previous)
		}
	})

	test("lock-file content never matches token patterns", async () => {
		const baseDir = await makeTempDir()
		const store = new MultiAuthStore("anthropic", { baseDir })

		const ACCESS = "sk-ant-api03-LOCKTEST-ACCESS-TOKEN-9f3c2a1b"
		const REFRESH = "refresh-LOCKTEST-REFRESH-TOKEN-d4e5f6a7"
		await store.upsertAccount(
			"work",
			sampleAccount({
				access: ACCESS,
				refresh: REFRESH,
			}),
		)

		// Hold the lock while reading its content
		const release = await store.acquireLock()
		try {
			const lockRaw = await fs.readFile(store.lockPath, "utf8")
			expect(lockRaw).not.toContain(ACCESS)
			expect(lockRaw).not.toContain(REFRESH)
			expect(lockRaw).not.toContain("sk-ant")
			expect(lockRaw).not.toMatch(/access|refresh|token/i)

			const info = JSON.parse(lockRaw) as { pid: number; hostname: string; timestamp: number }
			expect(info.pid).toBe(process.pid)
			expect(typeof info.hostname).toBe("string")
			expect(typeof info.timestamp).toBe("number")
			// Only those three keys
			expect(Object.keys(info).sort()).toEqual(["hostname", "pid", "timestamp"])

			expect(await modeOf(store.lockPath)).toBe(0o600)
		} finally {
			await release()
		}
	})
})

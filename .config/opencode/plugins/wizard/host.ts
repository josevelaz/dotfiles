import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const hostDirectory = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "opencode",
  "wizard",
)
const hostFile = join(hostDirectory, "host-id")

export async function wizardHostID(): Promise<string> {
  try {
    const value = (await readFile(hostFile, "utf8")).trim()
    if (/^[0-9a-f-]{36}$/.test(value)) return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  await mkdir(hostDirectory, { recursive: true, mode: 0o700 })
  const value = randomUUID()
  try {
    await writeFile(hostFile, `${value}\n`, { flag: "wx", mode: 0o600 })
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = (await readFile(hostFile, "utf8")).trim()
    if (!/^[0-9a-f-]{36}$/.test(existing)) {
      throw new Error("Wizard host ID is invalid.")
    }
    await chmod(hostFile, 0o600)
    return existing
  }
}

export async function acquireWizardLease(
  key: string,
): Promise<(() => Promise<void>) | undefined> {
  const leaseDirectory = join(hostDirectory, "leases")
  const lease = join(
    leaseDirectory,
    createHash("sha256").update(key).digest("hex"),
  )
  await mkdir(leaseDirectory, { recursive: true, mode: 0o700 })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lease, { mode: 0o700 })
      await writeFile(join(lease, "pid"), `${process.pid}\n`, { mode: 0o600 })
      return async () => {
        await rm(lease, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const owner = Number.parseInt(
        await readFile(join(lease, "pid"), "utf8").catch(() => ""),
        10,
      )
      if (!Number.isInteger(owner) || processIsRunning(owner)) return undefined
      await rm(lease, { recursive: true, force: true })
    }
  }
  return undefined
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

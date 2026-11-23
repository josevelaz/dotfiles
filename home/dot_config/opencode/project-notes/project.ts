import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { statSync } from "node:fs"
import { mkdir, readFile, rename, unlink, writeFile, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

export type ProjectNotes = {
  key: string
  name: string
  path: string
}

export function dataDir(): string {
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  return path.join(base, "opencode", "project-notes")
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
  return (cleaned || "project").slice(0, 80)
}

/** Readable name from a project key (git common dir, or a non-git directory). */
export function projectName(key: string): string {
  const base = path.basename(key)
  const parent = base === ".git" || base === ".bare" ? path.basename(path.dirname(key)) : base
  const stripped = parent.endsWith(".git") ? parent.slice(0, -4) : parent
  return sanitizeName(stripped)
}

export function shortHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8)
}

export function notesPath(key: string, dir = dataDir()): string {
  return path.join(dir, `${projectName(key)}-${shortHash(key)}.md`)
}

function stripSlash(value: string): string {
  if (value.length > 1 && value.endsWith(path.sep)) return value.slice(0, -1)
  return value
}

async function gitCommonDir(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: directory,
      timeout: 5_000,
    })
    const value = stdout.trim()
    if (!value) return undefined
    return stripSlash(path.resolve(directory, value))
  } catch {
    return undefined
  }
}

async function directoryKey(directory: string): Promise<string> {
  try {
    return stripSlash(await realpath(directory))
  } catch {
    return stripSlash(path.resolve(directory))
  }
}

export async function resolveProject(directory: string): Promise<ProjectNotes> {
  const key = (await gitCommonDir(directory)) ?? (await directoryKey(directory))
  return { key, name: projectName(key), path: notesPath(key) }
}

const writeTails = new Map<string, Promise<void>>()
const held = new Map<string, { text: string; mtimeMs: number }>()
const flushers = new Set<() => Promise<void>>()

function mtimeOf(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** Unsaved text that must survive a failed write or an unmounted view. */
export function holdText(file: string, text: string) {
  const current = held.get(file)
  if (current?.text === text) return
  held.set(file, { text, mtimeMs: mtimeOf(file) })
}

export function heldText(file: string): string | undefined {
  return held.get(file)?.text
}

/** A successful write drops any hold for this path, even if the text differs. */
export function clearHold(file: string) {
  held.delete(file)
}

export function trackFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush)
  return () => { flushers.delete(flush) }
}

/** Editor and disk text match once CR/LF differences are ignored. */
export function sameNotesText(left: string, right: string): boolean {
  return left.replace(/\r\n/g, "\n").replace(/\r/g, "\n") === right.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function flushAll(): Promise<void> {
  return (async () => {
    await Promise.all([...flushers].map((flush) => flush().catch(() => undefined)))
    let guard = 0
    while (writeTails.size > 0 && guard < 8) {
      await Promise.all([...writeTails.values()].map((tail) => tail.catch(() => undefined)))
      guard++
    }
  })()
}

/** Wait until every write queued for this path has finished. */
export function settle(file: string): Promise<void> {
  return writeTails.get(file) ?? Promise.resolve()
}

function enqueueWrite(file: string, task: () => Promise<void>): Promise<void> {
  const prev = writeTails.get(file) ?? Promise.resolve()
  const run = prev.then(task, task)
  const done = run.finally(() => {
    if (writeTails.get(file) === done) writeTails.delete(file)
  })
  writeTails.set(file, done)
  return run
}

export type LoadedNotes = {
  text: string
  disk: string
  /** True when a hold was dropped because the file changed on disk. */
  discarded: boolean
}

export async function readNotes(file: string): Promise<LoadedNotes> {
  await settle(file)
  let disk = ""
  try {
    disk = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const pending = held.get(file)
  if (!pending) return { text: disk, disk, discarded: false }
  if (mtimeOf(file) !== pending.mtimeMs) {
    held.delete(file)
    return { text: disk, disk, discarded: true }
  }
  return { text: pending.text, disk, discarded: false }
}

export async function atomicWrite(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, text)
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

export type Saver = {
  /** Replace any pending text and restart the timer. Always. */
  schedule(text: string): void
  flush(): Promise<void>
  /** Stop tracking this saver. Call only after flush has settled. */
  untrack(): void
  failed(): boolean
}

/** Debounced atomic save. Failed writes report an error and leave the caller holding the text. */
export function createSaver(
  file: string,
  hooks: {
    onStart?: () => void
    onSuccess?: (text: string) => void
    onError?: (message: string) => void
  },
  delay = 500,
  disk = "",
): Saver {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: string | undefined
  let known = disk
  let chain = Promise.resolve()
  let stop = () => {}
  let failed = false

  function enqueue(text: string): Promise<void> {
    chain = chain.then(() => write(text))
    return chain
  }

  function succeed(text: string, wrote: boolean) {
    if (wrote) known = text
    clearHold(file)
    failed = false
    hooks.onSuccess?.(text)
  }

  function write(text: string): Promise<void> {
    if (sameNotesText(text, known)) {
      succeed(text, false)
      return Promise.resolve()
    }
    holdText(file, text)
    return enqueueWrite(file, async () => {
      hooks.onStart?.()
      try {
        await atomicWrite(file, text)
        succeed(text, true)
      } catch (error) {
        failed = true
        holdText(file, text)
        hooks.onError?.(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const saver: Saver = {
    schedule(text: string) {
      pending = text
      if (sameNotesText(text, known)) clearHold(file)
      else holdText(file, text)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const next = pending
        pending = undefined
        timer = undefined
        if (next !== undefined) void enqueue(next)
      }, delay)
    },
    flush() {
      clearTimeout(timer)
      timer = undefined
      const next = pending
      pending = undefined
      if (next !== undefined) return enqueue(next)
      return chain
    },
    untrack() {
      stop()
    },
    failed() {
      return failed
    },
  }
  stop = trackFlush(() => saver.flush())
  return saver
}

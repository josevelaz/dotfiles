import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

import { Cron } from "croner"

export type Routine = {
  readonly id: string
  readonly name: string
  readonly schedule: string
  readonly timezone?: string
  readonly prompt: string
  readonly directory: string
  readonly agent?: string
  readonly model?: string
  readonly enabled: boolean
  readonly createdAt: number
  readonly scheduleSince: number
}

export type RunTrigger = "schedule" | "manual"

export type RunRecord = {
  readonly firedAt: number
  readonly trigger: RunTrigger
  readonly sessionID?: string
  readonly error?: string
}

export type RunState = {
  readonly lastCheckedAt?: number
  readonly lastFiredAt?: number
  readonly lastSessionID?: string
  readonly lastError?: string
  readonly failingSince?: number
  readonly history?: readonly RunRecord[]
}

export const HISTORY_LIMIT = 20

export const STATE_ROOT = process.env.OPENCODE_ROUTINES_DIR ?? join(homedir(), ".local", "state", "opencode-routines")
const ROUTINES_DIR = join(STATE_ROOT, "routines")
const RUNS_DIR = join(STATE_ROOT, "runs")
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "")
  if (!slug) throw new Error(`Cannot make an ID from the name ${JSON.stringify(name)}. Use letters or digits.`)
  return slug
}

function checkID(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid routine ID ${JSON.stringify(id)}`)
  return id
}

function cron(schedule: string, timezone: string | undefined): Cron {
  return new Cron(schedule, { timezone, paused: true, mode: "5-part" })
}

export function checkSchedule(schedule: string, timezone: string | undefined): void {
  let next: Date | null
  try {
    next = cron(schedule, timezone).nextRun()
  } catch (error) {
    throw new Error(
      `Invalid schedule ${JSON.stringify(schedule)}${timezone ? ` in ${timezone}` : ""}: ${(error as Error).message.replace(/\.+$/, "")}. Use a 5-field cron expression (minute hour day-of-month month day-of-week) or a nickname such as @daily.`,
    )
  }
  if (next === null) throw new Error(`Schedule ${JSON.stringify(schedule)} never runs`)
}

export async function checkDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory)) throw new Error(`Directory must be an absolute path, got ${JSON.stringify(directory)}`)
  const info = await stat(directory).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`Directory ${directory} does not exist`)
}

export function parseModel(model: string): { providerID: string; id: string; variant?: string } {
  const match = /^([^/#\s]+)\/([^#\s]+)(?:#(\S+))?$/.exec(model)
  if (!match) throw new Error(`Model must look like "provider/model" or "provider/model#variant", got ${JSON.stringify(model)}`)
  return match[3] ? { providerID: match[1], id: match[2], variant: match[3] } : { providerID: match[1], id: match[2] }
}

export function nextRuns(routine: Pick<Routine, "schedule" | "timezone">, count: number, after = new Date()): Date[] {
  return cron(routine.schedule, routine.timezone).nextRuns(count, after)
}

export function dueSlot(routine: Routine, state: RunState, now: number): Date | undefined {
  if (!routine.enabled) return undefined
  const since = Math.max(routine.scheduleSince, state.lastCheckedAt ?? 0)
  const next = cron(routine.schedule, routine.timezone).nextRun(new Date(since))
  return next && next.getTime() <= now ? next : undefined
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw new Error(`Cannot read ${path}: ${(error as Error).message}`)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

export async function listRoutines(): Promise<Routine[]> {
  const names = await readdir(ROUTINES_DIR).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[]
    throw error
  })
  const routines: Routine[] = []
  for (const name of names.filter((file) => file.endsWith(".json")).sort()) {
    const routine = await readJson<Routine>(join(ROUTINES_DIR, name))
    if (routine) routines.push(routine)
  }
  return routines
}

export async function getRoutine(id: string): Promise<Routine> {
  const routine = await readJson<Routine>(join(ROUTINES_DIR, `${checkID(id)}.json`))
  if (!routine) {
    const known = (await listRoutines()).map((candidate) => candidate.id)
    throw new Error(`No routine with ID ${JSON.stringify(id)}. Known routines: ${known.join(", ") || "none"}`)
  }
  return routine
}

export async function routineExists(id: string): Promise<boolean> {
  return (await readJson<Routine>(join(ROUTINES_DIR, `${checkID(id)}.json`))) !== undefined
}

export async function saveRoutine(routine: Routine): Promise<void> {
  await mkdir(ROUTINES_DIR, { recursive: true })
  await writeJson(join(ROUTINES_DIR, `${checkID(routine.id)}.json`), routine)
}

export async function removeRoutine(id: string): Promise<void> {
  await rm(join(ROUTINES_DIR, `${checkID(id)}.json`), { force: true })
  await rm(join(RUNS_DIR, `${id}.json`), { force: true })
}

export async function getRunState(id: string): Promise<RunState> {
  return (await readJson<RunState>(join(RUNS_DIR, `${checkID(id)}.json`))) ?? {}
}

export async function saveRunState(id: string, state: RunState): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true })
  await writeJson(join(RUNS_DIR, `${checkID(id)}.json`), state)
}

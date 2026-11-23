import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import {
  dueSlot,
  getRunState,
  HISTORY_LIMIT,
  listRoutines,
  parseModel,
  saveRunState,
  type Routine,
  type RunRecord,
  type RunState,
  type RunTrigger,
} from "./store"

const run = promisify(execFile)
const API_TIMEOUT_MS = 60_000
const RETRY_WINDOW_MS = 10 * 60_000
const INSTALLED_CLI = join(homedir(), ".opencode", "bin", "opencode")
const CLI = process.env.OPENCODE_BIN ?? (existsSync(INSTALLED_CLI) ? INSTALLED_CLI : "opencode")

export const ROUTINE_METADATA_KEY = "routineID"

async function api(method: "get" | "post", path: string, body?: unknown): Promise<unknown> {
  const args = ["api", method, path, ...(body === undefined ? [] : ["--data", JSON.stringify(body)])]
  try {
    const { stdout } = await run(CLI, args, { timeout: API_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    return stdout.trim() ? JSON.parse(stdout) : undefined
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string }
    const detail = [failure.stdout, failure.stderr].map((text) => text?.trim()).filter(Boolean).join("\n")
    throw new Error(`opencode api ${method} ${path} failed: ${detail || failure.message}`)
  }
}

function runPrompt(routine: Routine, firedAt: Date): string {
  return [
    `This is an unattended run of the routine "${routine.name}" (ID ${routine.id}), started ${firedAt.toString()} on the schedule "${routine.schedule}".`,
    "No one is watching this session. Do the task without asking questions; if you cannot finish, say what blocked you.",
    "",
    routine.prompt,
  ].join("\n")
}

async function record(id: string, run: RunRecord, update: Partial<RunState>): Promise<void> {
  const state = await getRunState(id)
  const history = [run, ...(state.history ?? [])].slice(0, HISTORY_LIMIT)
  await saveRunState(id, { ...state, ...update, history })
}

export async function fire(routine: Routine, trigger: RunTrigger, firedAt = new Date()): Promise<string> {
  try {
    const created = (await api("post", "/api/session", {
      title: `Routine: ${routine.name}`,
      location: { directory: routine.directory },
      ...(routine.agent ? { agent: routine.agent } : {}),
      ...(routine.model ? { model: parseModel(routine.model) } : {}),
      metadata: { [ROUTINE_METADATA_KEY]: routine.id },
    })) as { data?: { id?: string } }
    const sessionID = created?.data?.id
    if (!sessionID) throw new Error(`opencode api post /api/session returned no session ID: ${JSON.stringify(created)}`)
    await api("post", `/api/session/${sessionID}/prompt`, { text: runPrompt(routine, firedAt) })
    await record(
      routine.id,
      { firedAt: firedAt.getTime(), trigger, sessionID },
      { lastFiredAt: firedAt.getTime(), lastSessionID: sessionID, lastError: undefined },
    )
    return sessionID
  } catch (error) {
    const message = (error as Error).message
    await record(routine.id, { firedAt: firedAt.getTime(), trigger, error: message }, { lastError: `${firedAt.toISOString()}: ${message}` })
    throw error
  }
}

export type TickReport = { readonly fired: string[]; readonly failed: string[]; readonly newFailures: string[] }

export async function tick(now = Date.now()): Promise<TickReport> {
  const report: TickReport = { fired: [], failed: [], newFailures: [] }
  for (const routine of await listRoutines()) {
    const before = await getRunState(routine.id)
    const slot = dueSlot(routine, before, now)
    if (!slot) continue
    try {
      const sessionID = await fire(routine, "schedule", new Date(now))
      await saveRunState(routine.id, { ...(await getRunState(routine.id)), lastCheckedAt: now, failingSince: undefined })
      report.fired.push(`${routine.id} (slot ${slot.toISOString()}) -> ${sessionID}`)
    } catch (error) {
      const failingSince = before.failingSince ?? now
      const gaveUp = now - failingSince >= RETRY_WINDOW_MS
      await saveRunState(routine.id, {
        ...(await getRunState(routine.id)),
        ...(gaveUp ? { lastCheckedAt: now, failingSince: undefined } : { failingSince }),
      })
      report.failed.push(`${routine.id} (slot ${slot.toISOString()}${gaveUp ? ", skipped after retries" : ", will retry"}): ${(error as Error).message}`)
      if (!before.lastError) report.newFailures.push(routine.name)
    }
  }
  return report
}

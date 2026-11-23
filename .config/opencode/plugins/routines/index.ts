import { Plugin } from "@opencode/plugin"
import { z } from "zod"

import { Routines, type RoutineView } from "./rpc"
import { fire, ROUTINE_METADATA_KEY } from "./runner"
import {
  checkDirectory,
  checkSchedule,
  getRoutine,
  getRunState,
  listRoutines,
  nextRuns,
  parseModel,
  removeRoutine,
  routineExists,
  saveRoutine,
  slugify,
  STATE_ROOT,
  type Routine,
} from "./store"

const NAMESPACE = "routines"
const MAX_PARENT_DEPTH = 10

const scheduleDescription =
  "5-field cron expression: minute hour day-of-month month day-of-week, such as \"0 9 * * 1-5\" for weekdays at 09:00. Nicknames like @daily and @hourly also work. Times use the timezone field, or the Mac's local time when it is omitted."

const createInput = z.object({
  name: z.string().min(1).max(80).describe("Short human name. The routine ID is derived from it."),
  schedule: z.string().min(1).describe(scheduleDescription),
  prompt: z
    .string()
    .min(1)
    .describe("Self-contained instructions for each run. Each run starts a fresh session with no chat history, so include every detail it needs."),
  directory: z.string().optional().describe("Absolute folder the run's session works in. Defaults to the current session's folder."),
  timezone: z.string().optional().describe("IANA timezone such as America/New_York. Defaults to the Mac's local timezone."),
  agent: z.string().optional().describe("Agent ID for each run, such as build. Defaults to the default agent."),
  model: z.string().optional().describe("Model as provider/model or provider/model#variant. Defaults to the default model."),
  enabled: z.boolean().optional().describe("Defaults to true."),
})

const idInput = z.object({ id: z.string().min(1).describe("Routine ID from routines.list") })

const updateInput = z.object({
  id: z.string().min(1).describe("Routine ID from routines.list"),
  name: z.string().min(1).max(80).optional(),
  schedule: z.string().min(1).optional().describe(scheduleDescription),
  prompt: z.string().min(1).optional(),
  directory: z.string().optional(),
  timezone: z.string().nullable().optional().describe("IANA timezone, or null to use local time"),
  agent: z.string().nullable().optional().describe("Agent ID, or null for the default agent"),
  model: z.string().nullable().optional().describe("provider/model#variant, or null for the default model"),
  enabled: z.boolean().optional(),
})

const ROUTINE_COMMAND_PROMPT = `The user wants a routine: a prompt that OpenCode runs on a cron schedule, each time in a fresh, unattended session.

Turn the request below into one routine with tools.routines.create, called inside execute. Search the routines namespace first if you need its signatures.

- Convert the timing into a 5-field cron expression in the Mac's local timezone unless the user names another one. Pick a sensible minute when the user gives only an hour.
- Write the prompt so it stands alone: each run has no chat history, no one is watching, and no one can answer questions. Include the goal, sources, where to put results, and what to do when there is nothing to report.
- Default the folder to this session's folder unless the request points elsewhere. Leave agent and model unset unless the user asks for them.
- If the timing or the task is too unclear to act on, ask one short question first instead of guessing.
- Runs approve every permission prompt on their own; only explicit deny rules still block. Warn the user if the task could do something risky without a human checking it.

After creating it, report the ID, the schedule in plain words, the next run times the tool returns, and the prompt you saved.

Request:
`

function formatDate(time: number | Date | undefined): string {
  if (time === undefined) return "never"
  return new Date(time).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}

async function view(routine: Routine): Promise<RoutineView> {
  const state = await getRunState(routine.id)
  return JSON.parse(
    JSON.stringify({
      ...routine,
      nextRuns: routine.enabled ? nextRuns(routine, 3).map((date) => date.getTime()) : [],
      lastError: state.lastError,
      history: state.history ?? [],
    }),
  ) as RoutineView
}

async function describe(routine: Routine, upcoming = 1): Promise<string> {
  const state = await getRunState(routine.id)
  const next = routine.enabled ? nextRuns(routine, upcoming).map(formatDate).join(", ") || "none" : "disabled"
  return [
    `${routine.id}: ${routine.name}${routine.enabled ? "" : " [disabled]"}`,
    `  schedule: ${routine.schedule}${routine.timezone ? ` (${routine.timezone})` : " (local time)"}`,
    `  next: ${next}`,
    `  last run: ${formatDate(state.lastFiredAt)}${state.lastSessionID ? ` in session ${state.lastSessionID}` : ""}`,
    ...(state.lastError ? [`  last error: ${state.lastError}`] : []),
    `  folder: ${routine.directory}`,
    `  agent: ${routine.agent ?? "default"}, model: ${routine.model ?? "default"}`,
    `  prompt: ${routine.prompt}`,
  ].join("\n")
}

export default Plugin.define({
  id: "local.routines",
  async setup(ctx) {
    const checkAgent = async (agent: string, directory: string) => {
      const agents = (await ctx.agent.list({ location: { directory } })).data
      if (!agents.some((candidate) => candidate.id === agent)) {
        throw new Error(`Unknown agent ${JSON.stringify(agent)}. Known agents: ${agents.filter((candidate) => !candidate.hidden).map((candidate) => candidate.id).join(", ")}`)
      }
    }

    const checkModel = async (model: string, directory: string) => {
      const ref = parseModel(model)
      const models = (await ctx.model.list({ location: { directory } })).data
      const found = models.find((candidate) => candidate.providerID === ref.providerID && candidate.id === ref.id)
      if (!found) throw new Error(`Unknown model ${ref.providerID}/${ref.id}`)
      if (ref.variant && !found.variants?.some((variant) => variant.id === ref.variant)) {
        throw new Error(`Model ${ref.providerID}/${ref.id} has no variant ${JSON.stringify(ref.variant)}. Variants: ${found.variants?.map((variant) => variant.id).join(", ") || "none"}`)
      }
    }

    const validate = async (routine: Routine) => {
      checkSchedule(routine.schedule, routine.timezone)
      await checkDirectory(routine.directory)
      if (routine.agent) await checkAgent(routine.agent, routine.directory)
      if (routine.model) await checkModel(routine.model, routine.directory)
    }

    const setEnabled = async (id: string, enabled: boolean): Promise<Routine> => {
      const current = await getRoutine(id)
      if (current.enabled === enabled) return current
      const routine: Routine = { ...current, enabled, scheduleSince: enabled ? Date.now() : current.scheduleSince }
      await saveRoutine(routine)
      return routine
    }

    const routineOfSession = new Map<string, Promise<string | undefined>>()
    const findRoutine = (sessionID: string, depth = 0): Promise<string | undefined> => {
      const known = routineOfSession.get(sessionID)
      if (known) return known
      const lookup = ctx.session.get({ sessionID }).then((session) => {
        const id = session.metadata?.[ROUTINE_METADATA_KEY]
        if (typeof id === "string") return id
        if (session.parentID && depth < MAX_PARENT_DEPTH) return findRoutine(session.parentID, depth + 1)
        return undefined
      })
      routineOfSession.set(sessionID, lookup)
      return lookup.catch(() => {
        routineOfSession.delete(sessionID)
        return undefined
      })
    }

    await ctx.permission.hook("evaluate", async (event) => {
      if (event.effect !== "ask") return
      const routineID = await findRoutine(event.sessionID)
      if (!routineID) return
      event.effect = "allow"
      event.message = `Approved automatically for routine ${routineID}`
    })

    await ctx.rpc.register(Routines, {
      list: async (_input, context) => {
        try {
          return { routines: await Promise.all((await listRoutines()).map(view)), stateDir: STATE_ROOT }
        } catch (error) {
          const reason = (error as Error).message
          return context.error("failed", reason, { reason })
        }
      },
      setEnabled: async ({ id, enabled }, context) => {
        try {
          return await view(await setEnabled(id, enabled))
        } catch (error) {
          const reason = (error as Error).message
          return context.error("failed", reason, { reason })
        }
      },
      run: async ({ id }, context) => {
        try {
          return { sessionID: await fire(await getRoutine(id), "manual") }
        } catch (error) {
          const reason = (error as Error).message
          return context.error("failed", reason, { reason })
        }
      },
      remove: async ({ id }, context) => {
        try {
          const routine = await getRoutine(id)
          await removeRoutine(routine.id)
          return { removed: routine.id }
        } catch (error) {
          const reason = (error as Error).message
          return context.error("failed", reason, { reason })
        }
      },
    })

    const toolOptions = { namespace: NAMESPACE, permission: NAMESPACE, codemode: true } as const

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: NAMESPACE,
        description: "Routines: prompts that run on a cron schedule, each in a fresh unattended session. Create, list, update, remove, or run them now.",
      })

      editor.add({
        name: "create",
        description: "Create a routine that runs a prompt on a cron schedule in a fresh session. Returns its ID and next run times.",
        input: createInput,
        options: { ...toolOptions, pinned: true },
        execute: async (raw, context) => {
          const input = createInput.parse(raw)
          const id = slugify(input.name)
          if (await routineExists(id)) throw new Error(`A routine with ID ${id} already exists. Pick another name, or use routines.update.`)
          const directory = input.directory ?? (await ctx.session.get({ sessionID: context.sessionID })).location.directory
          const now = Date.now()
          const routine: Routine = {
            id,
            name: input.name,
            schedule: input.schedule.trim(),
            ...(input.timezone ? { timezone: input.timezone } : {}),
            prompt: input.prompt,
            directory,
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.model ? { model: input.model } : {}),
            enabled: input.enabled ?? true,
            createdAt: now,
            scheduleSince: now,
          }
          await validate(routine)
          await saveRoutine(routine)
          return { content: `Created routine.\n${await describe(routine, 3)}` }
        },
      })

      editor.add({
        name: "list",
        description: "List routines with their schedules, next and last runs, last errors, and prompts.",
        input: z.object({}),
        options: { ...toolOptions, pinned: true },
        execute: async () => {
          const routines = await listRoutines()
          if (routines.length === 0) return { content: `No routines. They are stored in ${STATE_ROOT}/routines.` }
          return { content: (await Promise.all(routines.map((routine) => describe(routine)))).join("\n\n") }
        },
      })

      editor.add({
        name: "update",
        description: "Change a routine's name, schedule, timezone, prompt, folder, agent, model, or enabled state. Pass null to reset timezone, agent, or model to the default.",
        input: updateInput,
        options: toolOptions,
        execute: async (raw) => {
          const input = updateInput.parse(raw)
          const current = await getRoutine(input.id)
          const merged = {
            ...current,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.schedule !== undefined ? { schedule: input.schedule.trim() } : {}),
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(input.directory !== undefined ? { directory: input.directory } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone ?? undefined } : {}),
            ...(input.agent !== undefined ? { agent: input.agent ?? undefined } : {}),
            ...(input.model !== undefined ? { model: input.model ?? undefined } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          }
          const timingChanged =
            merged.schedule !== current.schedule || merged.timezone !== current.timezone || (merged.enabled && !current.enabled)
          const routine: Routine = { ...merged, scheduleSince: timingChanged ? Date.now() : current.scheduleSince }
          await validate(routine)
          await saveRoutine(JSON.parse(JSON.stringify(routine)) as Routine)
          return { content: `Updated routine.\n${await describe(routine, 3)}` }
        },
      })

      editor.add({
        name: "remove",
        description: "Delete a routine and its run history. Sessions from past runs stay.",
        input: idInput,
        options: toolOptions,
        execute: async (raw) => {
          const routine = await getRoutine(idInput.parse(raw).id)
          await removeRoutine(routine.id)
          return { content: `Removed routine ${routine.id} (${routine.name}).` }
        },
      })

      editor.add({
        name: "run",
        description: "Run a routine once now in a fresh session, without changing its schedule. Returns the new session ID.",
        input: idInput,
        options: toolOptions,
        execute: async (raw) => {
          const routine = await getRoutine(idInput.parse(raw).id)
          const sessionID = await fire(routine, "manual")
          return { content: `Started routine ${routine.id} in session ${sessionID} (${routine.directory}).` }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "routine",
        description: "Create a routine from a plain-language request, such as: every weekday at 9am, summarize my open PRs",
        execute: async ({ sessionID, prompt, delivery }) => {
          const request = prompt.text.trim()
          const text = request
            ? `${ROUTINE_COMMAND_PROMPT}${request}`
            : "List my routines with tools.routines.list inside execute, then ask what routine I want to create or change."
          await ctx.session.prompt({ ...prompt, sessionID, text, delivery })
        },
      })
    })
  },
})

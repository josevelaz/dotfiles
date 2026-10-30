import type { Plugin } from "@opencode/plugin"

const ENDPOINT = "https://opencode.ai/zen/v1/systemone"
const LADDER = ["minimal", "low", "medium", "high", "xhigh", "max"] as const
type Level = (typeof LADDER)[number]
const MAX_PROMPT_CHARS = 12_000

const LEVEL_TEXT: Record<Level, string> = {
  minimal: "Trivial: a single lookup or one obvious action. The answer needs no analysis.",
  low: "Simple: a few direct, well-specified steps with little ambiguity and a small scope.",
  medium: "Ordinary: several steps or files, some judgment calls, and a moderate scope.",
  high: "Hard: a multi-part investigation, nontrivial debugging, design trade-offs, or a careful review.",
  xhigh: "Very hard: deep analysis across many components, or subtle correctness or security reasoning.",
  max: "Extreme: open-ended research or proof-level rigor where any missed detail is costly.",
}

type Profile = { defaultWeight: number; levels: Partial<Record<Level, number>> }

const MODEL_PROFILES: Record<string, Profile> = {
  "claude-opus-5-5": { defaultWeight: 5, levels: { high: 0.6, xhigh: 0.2, max: 0 } },
  "claude-sonnet-5-5": { defaultWeight: 5, levels: { xhigh: 0.6, max: 0 } },
  "gpt-6.1-sol": { defaultWeight: 5, levels: { xhigh: 0.3, max: 0 } },
}

type Options = {
  enabled: boolean
  model: string
  defaultWeight: number
  minProbability: number
  timeoutMs: number
  agents?: ReadonlySet<string>
  profiles: Record<string, Profile>
}

type Record_ = { lastApplied?: string; manual?: boolean }

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.warn(`[local.subagent-reasoning] ${message}`, JSON.stringify(fields))

const isLevel = (value: string): value is Level => (LADDER as readonly string[]).includes(value)
const isWeight = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0

function parseProfiles(raw: unknown): Record<string, Profile> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const profiles: Record<string, Profile> = { ...MODEL_PROFILES }
  for (const [modelID, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined
    const { defaultWeight, levels } = entry as { defaultWeight?: unknown; levels?: unknown }
    const base = profiles[modelID] ?? { defaultWeight: Number.NaN, levels: {} }
    const profile: Profile = { defaultWeight: base.defaultWeight, levels: { ...base.levels } }
    if (defaultWeight !== undefined) {
      if (!isWeight(defaultWeight) || defaultWeight < 1) return undefined
      profile.defaultWeight = defaultWeight
    }
    if (levels !== undefined) {
      if (!levels || typeof levels !== "object" || Array.isArray(levels)) return undefined
      for (const [level, weight] of Object.entries(levels)) {
        if (!isLevel(level) || !isWeight(weight) || weight > 1) return undefined
        profile.levels[level] = weight
      }
    }
    profiles[modelID] = profile
  }
  return profiles
}

function parseOptions(raw: Readonly<Record<string, unknown>>): Options {
  const options: Options = { enabled: true, model: "jev-1.13-free", defaultWeight: 5, minProbability: 0.5, timeoutMs: 4000, profiles: MODEL_PROFILES }
  const bad = (key: string) => log("ignoring invalid option", { key })
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === "boolean") options.enabled = raw.enabled
    else bad("enabled")
  }
  if (raw.model !== undefined) {
    if (typeof raw.model === "string" && raw.model.trim()) options.model = raw.model.trim()
    else bad("model")
  }
  if (raw.defaultWeight !== undefined) {
    if (isWeight(raw.defaultWeight) && raw.defaultWeight >= 1) options.defaultWeight = raw.defaultWeight
    else bad("defaultWeight")
  }
  if (raw.minProbability !== undefined) {
    if (typeof raw.minProbability === "number" && raw.minProbability >= 0 && raw.minProbability <= 1) options.minProbability = raw.minProbability
    else bad("minProbability")
  }
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs === "number" && Number.isInteger(raw.timeoutMs) && raw.timeoutMs > 0) options.timeoutMs = raw.timeoutMs
    else bad("timeoutMs")
  }
  if (raw.agents !== undefined) {
    if (Array.isArray(raw.agents) && raw.agents.every((agent) => typeof agent === "string")) options.agents = new Set(raw.agents)
    else bad("agents")
  }
  if (raw.models !== undefined) {
    const profiles = parseProfiles(raw.models)
    if (profiles) options.profiles = profiles
    else bad("models")
  }
  return options
}

function profileFor(options: Options, modelID: string): Profile {
  const profile = options.profiles[modelID] ?? options.profiles[modelID.replace(/-fast$/, "")]
  if (!profile) return { defaultWeight: options.defaultWeight, levels: {} }
  return { defaultWeight: Number.isNaN(profile.defaultWeight) ? options.defaultWeight : profile.defaultWeight, levels: profile.levels }
}

async function judge(options: Options, levels: readonly Level[], state: unknown): Promise<number[] | undefined> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs),
    body: JSON.stringify({
      model: options.model,
      state,
      questions: {
        level: {
          type: "score",
          instructions:
            "How much reasoning effort does the work requested in `task.prompt` need for the agent described in `task.agent` to do it well? Judge the difficulty of the work itself, not the length of the prompt. `task.default_level` is the level the agent's configuration uses for its typical tasks.",
          criteria: levels.map((level) => LEVEL_TEXT[level]),
        },
      },
    }),
  })
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`)
  const body = (await response.json()) as { answers?: { level?: { probabilities?: Record<string, unknown> } } }
  const probabilities = body.answers?.level?.probabilities
  if (!probabilities) return undefined
  const values = levels.map((_, index) => probabilities[String(index)])
  if (!values.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)) return undefined
  return values
}

function pick(options: Options, profile: Profile, levels: readonly Level[], defaultIndex: number, probabilities: readonly number[]) {
  const kept = new Array<number>(levels.length).fill(0)
  const adjusted = new Array<number>(levels.length).fill(0)
  let carry = 0
  for (let index = levels.length - 1; index >= 0; index--) {
    const mass = probabilities[index] + carry
    const share = index === 0 || index === defaultIndex ? 1 : (profile.levels[levels[index]] ?? 1)
    kept[index] = mass * share
    adjusted[index] = index === defaultIndex ? probabilities[index] * profile.defaultWeight + carry : kept[index]
    carry = mass - kept[index]
  }
  let winner = defaultIndex
  adjusted.forEach((value, index) => {
    if (value > adjusted[winner]) winner = index
  })
  if (winner !== defaultIndex && kept[winner] < options.minProbability) winner = defaultIndex
  return { level: levels[winner], adjusted: adjusted[winner], probability: kept[winner] }
}

const queues = new Map<string, Promise<unknown>>()
async function serialized(id: string, run: () => Promise<void>) {
  const previous = queues.get(id) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(run)
  queues.set(id, next)
  try { await next } finally { if (queues.get(id) === next) queues.delete(id) }
}

const errorText = (error: unknown) => (error instanceof Error ? error.name + ": " + error.message : "unknown")

export default {
  id: "local.subagent-reasoning",
  async setup(ctx) {
    const options = parseOptions(ctx.options)
    if (!options.enabled) return

    const notifyParent = async (parentID: string, childID: string, agentID: string, from: string, to: string, configured: string) => {
      const reason = to === configured ? "configured level" : "Jev"
      try {
        await ctx.session.synthetic({
          sessionID: parentID,
          text: `[local.subagent-reasoning] Subagent ${agentID} (${childID}) reasoning level set to ${to}; configured level is ${configured}. Informational only; no action needed.`,
          description: `${agentID}: reasoning ${from} → ${to} (${reason})`,
          metadata: { source: "local.subagent-reasoning", childID, agent: agentID, from, to, configured },
          delivery: "steer",
          resume: false,
        })
      } catch (error) {
        log("could not post parent notice", { sessionID: childID, error: errorText(error) })
      }
    }

    const choose = async (sessionID: string, text: string) => {
      const session = await ctx.session.get({ sessionID })
      if (!session.parentID || session.fork || !session.agent || !session.model) return
      const agentID = session.agent
      if (options.agents && !options.agents.has(agentID)) return

      const location = { directory: session.location.directory }
      const { data: agent } = await ctx.agent.get({ agentID, location })
      const configured = agent.model
      const defaultVariant = configured?.variant
      if (!configured || !defaultVariant || !isLevel(defaultVariant)) return

      const current = session.model
      const key = `session/${sessionID}`
      const saved = ((await ctx.storage.get(key)) ?? {}) as Record_
      if (saved.manual) return
      const sameModel = current.providerID === configured.providerID && current.id === configured.id
      if (!sameModel || (current.variant !== defaultVariant && current.variant !== saved.lastApplied)) {
        await ctx.storage.set(key, { ...saved, manual: true })
        log("manual model choice detected; not adjusting", { sessionID, agentID })
        return
      }

      const { data: models } = await ctx.model.list({ location })
      const model = models.find((entry) => entry.providerID === current.providerID && entry.id === current.id)
      const offered = new Set<string>((model?.variants ?? []).map((variant) => variant.id))
      const levels = LADDER.filter((level) => offered.has(level))
      const defaultIndex = levels.indexOf(defaultVariant)
      if (defaultIndex < 0 || levels.length < 2) return

      const probabilities = await judge(options, levels, {
        task: {
          prompt: text.slice(0, MAX_PROMPT_CHARS),
          agent: { id: agentID, description: agent.description ?? "" },
          default_level: defaultVariant,
        },
      })
      if (!probabilities) {
        log("malformed Jev answer; keeping variant", { sessionID, agentID })
        return
      }
      const result = pick(options, profileFor(options, current.id), levels, defaultIndex, probabilities)
      log("judged", { sessionID, agentID, model: current.id, default: defaultVariant, chosen: result.level, adjusted: Number(result.adjusted.toFixed(3)) })
      if (result.level !== current.variant) {
        await ctx.session.switchModel({ sessionID, model: { providerID: current.providerID, id: current.id, variant: result.level } })
        await notifyParent(session.parentID, sessionID, agentID, current.variant ?? defaultVariant, result.level, defaultVariant)
      }
      await ctx.storage.set(key, { lastApplied: result.level })
    }

    await ctx.session.hook("prompt", async (event) => {
      try {
        await serialized(event.sessionID, () => choose(event.sessionID, event.prompt.text ?? ""))
      } catch (error) {
        log("keeping variant after error", { sessionID: event.sessionID, error: errorText(error) })
      }
    })
  },
} satisfies Plugin.Plugin

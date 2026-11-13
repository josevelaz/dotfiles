// Adds `claude-agent/auto`: each user message, Jev (OpenCode Zen) classifies the
// request and the turn is served by the Claude model and effort that
// "Which Claude model should you build with?" recommends. See router.ts.
// Every decision is stored and broadcast over RPC so the TUI part can show it.
import { Model, Plugin, Provider } from "@opencode/plugin"
import { ClaudeAuto, isRouteRecord, type RouteRecord } from "./rpc"
import {
  buildQuestions,
  decideRoute,
  DEFAULT_ROUTE,
  formatRoute,
  GENERATE_ROUTE,
  TITLE_ROUTE,
  type ClaudeModel,
  type DecisionAnswer,
  type Effort,
  type Route,
  type RouteDecision,
  type RoutingState,
} from "./router"

const PROVIDER = "claude-agent"
const AUTO = "auto"
// Jev takes 64k tokens per request and 32k per question (state plus one question); accuracy
// also falls as the state grows. These keep the state near 13k tokens at most, with room for
// the questions. A message over the cap keeps its head and tail. 40k characters covers every
// prompt seen so far (Grokbot webhooks under 1k, orchestrator subagent briefs up to ~26k).
const LATEST_CHARS = 40_000
const PREVIOUS_CHARS = 4_000

type Prompt = { messageID: string; text: string; attachments: string[] }

type SessionRoute = {
  latest?: Prompt
  previous?: Prompt
  // Bumped on every admitted prompt; a turn is routed once per value.
  seq: number
  routedSeq: number
  route?: Route
  restored: boolean
  pending?: Promise<Route>
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max / 2)}\n…\n${text.slice(-max / 2)}`

const storageKey = (sessionID: string) => `route/${sessionID}`

export default Plugin.define({
  id: "claude-auto",
  async setup(ctx) {
    const jevModel = typeof ctx.options.jevModel === "string" ? ctx.options.jevModel : "jev-1.13-free"
    const timeoutMs = typeof ctx.options.timeoutMs === "number" ? ctx.options.timeoutMs : 5000
    const sessions = new Map<string, SessionRoute>()
    const labels = new Map<string, string>()
    const session = (id: string) => {
      let s = sessions.get(id)
      if (!s) sessions.set(id, (s = { seq: 0, routedSeq: -1, restored: false }))
      return s
    }

    // `auto` is a clone of `opus` (modelID stays "opus"), so an unrouted request
    // still lands on the article's default. No variants: effort is routed too.
    await ctx.provider.transform((editor) => {
      const record = editor.get(PROVIDER)
      const opus = record?.models.get("opus")
      if (!record || !opus) return
      record.models.forEach((model, id) => labels.set(id, model.name))
      if (record.models.has(AUTO)) return
      editor.models.set(PROVIDER, [
        ...record.models.values(),
        { ...opus, id: Model.ID.make(AUTO), name: "Auto (Jev-routed)", variants: [] },
      ])
    })

    async function rootOf(sessionID: string): Promise<string> {
      let id = sessionID
      for (let depth = 0; depth < 8; depth++) {
        const info = await ctx.session.get({ sessionID: id }).catch(() => undefined)
        if (!info?.parentID) return id
        id = info.parentID
      }
      return id
    }

    const rpc = await ctx.rpc.register(ClaudeAuto, {
      get: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const stored = await ctx.storage.get(storageKey(sessionID))
        return { route: isRouteRecord(stored) ? stored : null }
      },
      family: async (input) => {
        const rootSessionID = await rootOf((input as { sessionID: string }).sessionID)
        const routes: RouteRecord[] = []
        let after: string | undefined
        do {
          const page = await ctx.storage.scan({ prefix: "route/", after, limit: 500 })
          for (const entry of page.entries)
            if (isRouteRecord(entry.value) && entry.value.rootSessionID === rootSessionID) routes.push(entry.value)
          after = page.next
        } while (after)
        return { rootSessionID, routes: routes.sort((a, b) => b.time - a.time) }
      },
    })

    async function publish(sessionID: string, agent: string, decision: RouteDecision) {
      const record: RouteRecord = {
        sessionID,
        rootSessionID: await rootOf(sessionID),
        agent,
        model: decision.route.model,
        label: labels.get(decision.route.model) ?? decision.route.model,
        effort: decision.route.effort,
        reason: decision.reason,
        time: Date.now(),
      }
      await ctx.storage.set(storageKey(sessionID), record)
      await rpc.events.emit("routed", record)
    }

    // After a restart, recover the last decision so follow-ups stay sticky.
    async function restore(sessionID: string, s: SessionRoute) {
      if (s.restored) return
      s.restored = true
      const stored = await ctx.storage.get(storageKey(sessionID)).catch(() => undefined)
      if (!s.route && isRouteRecord(stored)) s.route = { model: stored.model as ClaudeModel, effort: stored.effort as Effort }
    }

    await ctx.session.hook("prompt", (event) => {
      const s = session(event.sessionID)
      s.previous = s.latest
      s.latest = {
        messageID: event.messageID,
        text: event.prompt.text,
        attachments: (event.prompt.files ?? []).map((f) => ("mime" in f && typeof f.mime === "string" ? f.mime : "file")),
      }
      s.seq++
    })

    // After a restart the prompt hook has not seen this session yet.
    async function loadPrompts(sessionID: string, s: SessionRoute) {
      const messages = await ctx.session.context({ sessionID })
      const users = messages.filter((m) => m.type === "user")
      const toPrompt = (m: (typeof users)[number] | undefined): Prompt | undefined =>
        m && m.type === "user"
          ? { messageID: m.id, text: m.text, attachments: (m.files ?? []).map((f) => f.mime) }
          : undefined
      s.latest = toPrompt(users.at(-1))
      s.previous = toPrompt(users.at(-2))
      s.seq++
    }

    async function classify(agentID: string, s: SessionRoute): Promise<RouteDecision> {
      if (!s.latest) return { route: s.route ?? DEFAULT_ROUTE, reason: "no user message found" }
      const agent = await ctx.agent
        .get({ agentID })
        .then((r) => r.data)
        .catch(() => undefined)
      const state: RoutingState = {
        agent: { name: agent?.name ?? agentID, mode: agent?.mode ?? "primary", description: agent?.description },
        latest_user_message: clip(s.latest.text, LATEST_CHARS),
        attachments: s.latest.attachments,
      }
      if (s.route && s.previous) {
        state.previous_user_message = clip(s.previous.text, PREVIOUS_CHARS)
        state.previous_route = formatRoute(s.route)
      }
      const result = await ctx.experimental.generate.decisions(
        {
          model: { providerID: Provider.ID.make("opencode"), id: Model.ID.make(jevModel) },
          input: [{ type: "json", value: state }],
          questions: buildQuestions(state),
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      )
      return decideRoute(result.answers as readonly DecisionAnswer[], s.route)
    }

    async function routeTurn(sessionID: string, agentID: string): Promise<Route> {
      const s = session(sessionID)
      await restore(sessionID, s)
      if (!s.latest) await loadPrompts(sessionID, s).catch(() => undefined)
      if (s.route && s.routedSeq === s.seq) return s.route
      if (s.pending) return s.pending
      const seq = s.seq
      s.pending = classify(agentID, s)
        .catch((error: unknown): RouteDecision => {
          console.warn("[claude-auto] Jev routing failed:", error)
          return { route: s.route ?? DEFAULT_ROUTE, reason: "Jev unavailable, using fallback" }
        })
        .then(async (decision) => {
          s.route = decision.route
          s.routedSeq = seq
          await publish(sessionID, agentID, decision).catch((error: unknown) =>
            console.warn("[claude-auto] could not publish route:", error),
          )
          return decision.route
        })
        .finally(() => {
          s.pending = undefined
        })
      return s.pending
    }

    await ctx.session.hook(
      "experimental.model.resolve",
      async (event) => {
        if (event.model.id !== AUTO) return
        const route =
          event.kind === "title"
            ? TITLE_ROUTE
            : event.kind === "generate"
              ? GENERATE_ROUTE
              : event.kind === "compaction"
                ? // Summarize on the model that owns the prompt cache.
                  (sessions.get(event.sessionID)?.route ?? DEFAULT_ROUTE)
                : await routeTurn(event.sessionID, event.agent)
        event.model = {
          providerID: event.model.providerID,
          id: Model.ID.make(route.model),
          variant: Model.VariantID.make(route.effort),
        }
      },
      { providerID: Provider.ID.make(PROVIDER) },
    )

    return () => sessions.clear()
  },
})

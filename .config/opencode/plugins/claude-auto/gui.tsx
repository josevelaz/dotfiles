// OpenCode Desktop view of `claude-agent/auto`:
// - a toast when a routing decision changes the model or effort, for the session
//   you're viewing and its subagents;
// - a pill above the composer: the session's own route, plus +N running subagents;
// - a label in the session header, which also shows inside subagent sessions
//   (the app never shows composer pills there).
// Built to dist/gui-experimental.cjs by Vite.
import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  ComposerPill,
  createKeyed,
  Plugin,
  Slot,
  type ComposerPillView,
  type MountedSession,
} from "@opencode/plugin/gui"
import { ClaudeAuto, isRouteRecord, type RouteRecord } from "./rpc"

const describe = (r: RouteRecord) => `${r.label} · ${r.effort}`
const sameRoute = (a: RouteRecord, b: RouteRecord) => a.model === b.model && a.effort === b.effort

export default Plugin.define({
  setup(ctx) {
    const [state, setState] = createStore<{
      // Latest decision per session.
      latest: Record<string, RouteRecord>
      // Root session of each session we've seen, including roots that aren't routed themselves.
      root: Record<string, string>
    }>({ latest: {}, root: {} })

    const remember = (record: RouteRecord) => {
      setState("latest", record.sessionID, record)
      setState("root", record.sessionID, record.rootSessionID)
    }

    const rootOf = (sessionID: string) => state.root[sessionID] ?? sessionID
    const family = (rootID: string) =>
      Object.values(state.latest)
        .filter((r) => r.rootSessionID === rootID)
        .sort((a, b) => b.time - a.time)

    // Live decisions from the server hosting the routed session. RPC events are
    // live-only, so resubscribe whenever that server's client changes.
    createKeyed(
      () => ctx.sessions.current()?.server.client,
      (client) =>
        onCleanup(
          client.rpc(ClaudeAuto).events.on("routed", (event) => {
            const record = event.data
            if (!isRouteRecord(record)) return
            const previous = state.latest[record.sessionID]
            remember(record)
            if (previous && sameRoute(previous, record)) return
            const current = ctx.sessions.current()
            if (!current || rootOf(current.id) !== record.rootSessionID) return
            const subagent = record.sessionID !== record.rootSessionID
            ctx.toast.show({
              title: subagent ? `${record.agent} → ${describe(record)} effort` : `Auto → ${describe(record)} effort`,
              description: record.reason,
              icon: "models",
            })
          }),
        ),
    )

    // Load the whole family's stored decisions when a session is opened, so the
    // pill and header are right after a reload and for subagents that ran earlier.
    createKeyed(
      () => ctx.sessions.current(),
      (session: MountedSession) => {
        const { id, directory } = session
        void session.server.client
          .rpc(ClaudeAuto)
          .family({ sessionID: id }, { location: { directory } })
          .then((result) => {
            const { rootSessionID, routes } = result as { rootSessionID: string; routes: unknown[] }
            setState("root", id, rootSessionID)
            for (const route of routes) {
              if (!isRouteRecord(route)) continue
              const known = state.latest[route.sessionID]
              if (!known || known.time < route.time) remember(route)
            }
          })
          .catch(() => undefined)
      },
      { equals: (a, b) => a.key === b.key },
    )

    // Running subagents in this session's family; a finished one shows its model in its own session header.
    const runningSubagents = (session: MountedSession) =>
      family(rootOf(session.id)).filter(
        (r) => r.sessionID !== session.id && session.server.data.session.status(r.sessionID) === "running",
      )

    // One pill: this session's route, plus "+N" for its running auto-routed subagents.
    // Click it for each subagent's route.
    ctx.add(ComposerPill, {
      id: "route",
      show: (input): ComposerPillView | undefined => {
        const own = state.latest[input.session.id]
        const subagents = runningSubagents(input.session)
        const model = input.screen.composer.model()
        const isAuto = model?.providerID === "claude-agent" && model.modelID === "auto"
        if (!own && subagents.length === 0) {
          return isAuto
            ? { label: "Auto · picks on send", icon: "models", title: "Jev picks the model and effort for each message" }
            : undefined
        }
        const count = subagents.length ? `+${subagents.length}` : ""
        return {
          label: [own ? describe(own) : "", count].filter(Boolean).join(" · "),
          icon: own ? "models" : "task",
          title: own ? `Auto → ${describe(own)} effort — ${own.reason}` : "Running auto-routed subagents",
          // The session itself is the first item, then each running subagent.
          rows: subagents.length
            ? [...(own ? [own] : []), ...subagents].map((r) => ({
                id: r.sessionID,
                label:
                  r.sessionID === input.session.id ? `This session → ${describe(r)} effort` : `${r.agent} → ${describe(r)} effort`,
                detail: r.reason,
                icon: r.sessionID === input.session.id ? ("models" as const) : ("task" as const),
              }))
            : undefined,
        }
      },
    })

    ctx.add(Slot, {
      at: "session.header",
      render: (input) => {
        const record = () => state.latest[input.session.id]
        return (
          <Show when={record()}>
            {(r) => (
              <span title={`Auto-routed: ${r().reason}`} style={{ opacity: 0.7, "font-size": "0.85em", "white-space": "nowrap" }}>
                {`auto → ${describe(r())} effort`}
              </span>
            )}
          </Show>
        )
      },
    })
  },
})

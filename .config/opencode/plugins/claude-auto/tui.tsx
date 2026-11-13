// Shows what `claude-agent/auto` picked: a toast for each routing decision in the
// session you're viewing (and its subagents), plus a persistent prompt-footer
// indicator while `auto` is the selected model.
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, Show } from "solid-js"
import { ClaudeAuto, isRouteRecord, type RouteRecord } from "./rpc.js"

const describe = (r: RouteRecord) => `${r.label} · ${r.effort} effort`

export default Plugin.define({
  id: "claude-auto.tui",
  setup(context) {
    const [routes, setRoutes] = createSignal<Record<string, RouteRecord>>({})
    const remember = (record: RouteRecord) => setRoutes((previous) => ({ ...previous, [record.sessionID]: record }))
    const requested = new Set<string>()
    let disposed = false

    const viewing = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    let stopRouted: (() => void) | undefined
    function subscribe() {
      stopRouted?.()
      stopRouted = context.client.rpc(ClaudeAuto).events.on("routed", (event) => {
        const record = event.data
        if (disposed || !isRouteRecord(record)) return
        const previous = routes()[record.sessionID]
        remember(record)
        // Same model and effort as the last decision: the footer already says it.
        if (previous && previous.model === record.model && previous.effort === record.effort) return
        const current = viewing()
        if (!current || (record.sessionID !== current && context.data.session.root(current) !== record.rootSessionID)) return
        const subagent = record.sessionID !== current && record.sessionID !== record.rootSessionID
        context.ui.toast.show({
          title: subagent ? `Auto model · ${record.agent}` : "Auto model",
          message: `${describe(record)} — ${record.reason}`,
          variant: "info",
          duration: 5000,
          sessionID: record.sessionID,
        })
      })
    }
    // RPC events are live-only: resubscribe whenever the server connection returns.
    subscribe()
    const stopConnected = context.data.on("server.connected", () => {
      if (disposed) return
      requested.clear()
      subscribe()
    })

    async function load(sessionID: string) {
      if (requested.has(sessionID)) return
      requested.add(sessionID)
      const location = context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default()
      try {
        const result = (await context.client
          .rpc(ClaudeAuto)
          .family({ sessionID }, { location: { directory: location.directory }, signal: AbortSignal.timeout(5000) })) as {
          routes: unknown[]
        }
        if (disposed) return
        for (const route of result.routes) {
          if (!isRouteRecord(route)) continue
          const known = routes()[route.sessionID]
          if (!known || known.time < route.time) remember(route)
        }
      } catch {
        requested.delete(sessionID)
      }
    }

    function Status(props: { sessionID?: string }) {
      const selected = () => context.ui.model.current()
      const isAuto = () => selected()?.providerID === "claude-agent" && selected()?.modelID === "auto"
      const record = () => (props.sessionID ? routes()[props.sessionID] : undefined)
      const subagents = () => {
        const id = props.sessionID
        if (!id) return []
        const root = context.data.session.root(id)
        // Only running subagents; a finished one shows its model in its own session.
        return Object.values(routes()).filter(
          (r) => r.sessionID !== id && r.rootSessionID === root && context.data.session.status(r.sessionID) === "running",
        )
      }
      createEffect(() => {
        if (props.sessionID) void load(props.sessionID)
      })
      const text = () => {
        const own = record()
        const subs = subagents()
        const extra = subs.length ? ` · +${subs.length}` : ""
        if (own) return `auto → ${describe(own)}${extra}`
        if (subs.length) return extra.slice(3)
        return isAuto() ? "auto · routes on send" : ""
      }
      return (
        <Show when={text()}>
          <text fg={context.theme.text.muted}>{text()}</text>
        </Show>
      )
    }

    const stopSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <Status sessionID={props.sessionID} />,
    })

    return () => {
      disposed = true
      stopSlot()
      stopConnected()
      stopRouted?.()
    }
  },
})

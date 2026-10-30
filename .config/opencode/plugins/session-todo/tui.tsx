import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Plan } from "./plan.js"
import { SessionTodo } from "./rpc.js"
import { displayText, taskWindow, type TaskRow } from "./view.js"

type Location = NonNullable<Plugin.Context["location"]>
type Target = { sessionID: string; location: Location; key: string }
type Snapshot = Target & { plan: Plan | null; state: "loading" | "ready" | "error"; refresh: () => void }

function locationKey(location: Location) {
  return JSON.stringify([location.directory, location.workspaceID ?? null])
}

function targetFor(context: Plugin.Context, sessionID: string): Target {
  const location = context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default()
  return { sessionID, location, key: JSON.stringify([locationKey(location), sessionID]) }
}

/** One read stream for the selected session, shared by the sidebar and dialog. */
function watchPlan(context: Plugin.Context, target: Target, publish: (snapshot: Snapshot) => void) {
  let disposed = false
  let request = 0
  let controller: AbortController | undefined
  let updateTimer: ReturnType<typeof setTimeout> | undefined
  let plan: Plan | null = null
  let ready = false
  let minimumRevision = 0
  let todo = context.client.rpc(SessionTodo)
  let stopUpdated: (() => void) | undefined

  function emit(state: Snapshot["state"]) {
    if (!disposed) publish({ ...target, plan, state, refresh })
  }

  async function read() {
    const serial = ++request
    controller?.abort()
    controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])
    try {
      // JSON Schema RPC outputs are unknown in the client; the shared server contract validates this shape.
      const result = await todo.get({ sessionID: target.sessionID }, { location: { directory: target.location.directory }, signal }) as {
        plan: Plan | null
      }
      if (disposed || serial !== request) return
      if (result.plan && (result.plan.sessionID !== target.sessionID || result.plan.revision < minimumRevision)) {
        throw new Error("Session plan snapshot is stale")
      }
      plan = result.plan
      minimumRevision = Math.max(minimumRevision, plan?.revision ?? 0)
      ready = true
      emit("ready")
    } catch {
      if (disposed || serial !== request) return
      emit("error")
    }
  }

  function refresh() {
    if (disposed) return
    clearTimeout(updateTimer)
    updateTimer = undefined
    if (!ready) emit("loading")
    void read()
  }

  function subscribe() {
    stopUpdated?.()
    todo = context.client.rpc(SessionTodo)
    stopUpdated = todo.events.on("updated", (event) => {
      const data = event.data as { sessionID: string; revision: number }
      if (disposed || data.sessionID !== target.sessionID || locationKey(event.location) !== locationKey(target.location)) return
      minimumRevision = Math.max(minimumRevision, data.revision)
      // Invalidate the response now, not after the short burst-coalescing delay.
      request++
      controller?.abort()
      clearTimeout(updateTimer)
      updateTimer = setTimeout(refresh, 50)
    })
  }

  // RPC events are live-only. Re-subscribe before each reconnect read.
  subscribe()
  const stopConnected = context.data.on("server.connected", () => {
    if (disposed) return
    subscribe()
    refresh()
  })
  refresh()
  // The RPC subscription has its own stream. A bounded read also recovers a missed event
  // if that stream drops while the host connection stays up. Only the selected session polls.
  const poll = setInterval(refresh, 30_000)

  return () => {
    disposed = true
    request++
    controller?.abort()
    clearTimeout(updateTimer)
    clearInterval(poll)
    stopUpdated?.()
    stopConnected()
  }
}

function TaskRows(props: { context: Plugin.Context; rows: TaskRow[]; total: number }) {
  return (
    <box flexShrink={0}>
      <For each={props.rows}>
        {(row) => (
          <box
            flexDirection="row"
            flexShrink={0}
            backgroundColor={row.current ? props.context.theme.background.raised.high : undefined}
          >
            <text
              width={String(props.total).length + 6}
              flexShrink={0}
              fg={row.current ? props.context.theme.text.base : props.context.theme.text.muted}
            >
              {`${row.current ? "›" : " "} ${row.number}. ${row.task.status === "done" ? "✓" : row.task.status === "blocked" ? "!" : "○"}`}
            </text>
            <box flexGrow={1} minWidth={0} flexShrink={1}>
              <Show when={row.current}>
                <text
                  fg={row.task.status === "blocked" ? props.context.theme.text.feedback.warning.base : props.context.theme.text.feedback.info.base}
                  attributes={TextAttributes.BOLD}
                >
                  {row.task.status === "blocked" ? "Current · blocked" : "Current"}
                </text>
              </Show>
              <text
                wrapMode="word"
                fg={row.task.status === "done" ? props.context.theme.text.muted : props.context.theme.text.base}
                attributes={row.current ? TextAttributes.BOLD : undefined}
              >
                {displayText(row.task.title)}
              </text>
              <Show when={row.task.status === "blocked" && !row.current}>
                <text fg={props.context.theme.text.feedback.warning.muted}>Blocked</text>
              </Show>
            </box>
          </box>
        )}
      </For>
    </box>
  )
}

function EmptyState(props: { context: Plugin.Context; snapshot?: Snapshot }) {
  return (
    <text wrapMode="word" fg={props.context.theme.text.muted}>
      {props.snapshot?.state === "error"
        ? "Could not load session plan. Open Session plan to retry."
        : !props.snapshot || props.snapshot.state === "loading"
          ? "Loading session plan…"
          : "No session plan"}
    </text>
  )
}

function PlanHeading(props: { context: Plugin.Context; plan: Plan }) {
  const view = createMemo(() => taskWindow(props.plan))
  return (
    <box flexShrink={0} gap={1}>
      <box flexShrink={0}>
        <text fg={props.context.theme.text.muted} attributes={TextAttributes.BOLD}>GOAL</text>
        <text fg={props.context.theme.text.base} wrapMode="word">{displayText(props.plan.goal)}</text>
      </box>
      <box flexDirection="row" flexShrink={0} gap={1}>
        <text fg={props.context.theme.text.muted} attributes={TextAttributes.BOLD}>TASKS</text>
        <text fg={props.context.theme.text.muted}>{`${view().completed}/${props.plan.tasks.length}`}</text>
        <Show when={view().complete}>
          <text fg={props.context.theme.text.feedback.success.base}>✓ Complete</text>
        </Show>
      </box>
    </box>
  )
}

function Sidebar(props: {
  context: Plugin.Context
  sessionID: string
  snapshot: () => Snapshot | undefined
  expanded: (key: string) => boolean
  toggle: (key: string) => void
}) {
  const dimensions = useTerminalDimensions()
  const snapshot = createMemo(() => {
    const value = props.snapshot()
    return value?.key === targetFor(props.context, props.sessionID).key ? value : undefined
  })
  const expanded = () => !!snapshot() && props.expanded(snapshot()!.key)

  return (
    <box flexShrink={0} gap={1}>
      <Show when={snapshot()?.plan} fallback={<EmptyState context={props.context} snapshot={snapshot()} />}>
        {(plan) => {
          const view = createMemo(() => taskWindow(plan(), expanded()))
          const collapsed = createMemo(() => taskWindow(plan()))
          return (
            <>
              <PlanHeading context={props.context} plan={plan()} />
              <Show when={snapshot()?.state === "error"}>
                <text fg={props.context.theme.text.feedback.warning.base} wrapMode="word">Plan may be out of date</text>
              </Show>
              <Show when={plan().tasks.length} fallback={<text fg={props.context.theme.text.muted}>No tasks yet</text>}>
                <Show
                  when={expanded()}
                  fallback={<TaskRows context={props.context} rows={view().rows} total={plan().tasks.length} />}
                >
                  <scrollbox
                    height={Math.min(14, Math.max(3, Math.floor(dimensions().height / 3)))}
                    scrollX={false}
                    contentOptions={{ flexShrink: 0, paddingRight: 1 }}
                    horizontalScrollbarOptions={{ visible: false }}
                    verticalScrollbarOptions={{ trackOptions: { foregroundColor: props.context.theme.scrollbar.base, backgroundColor: props.context.theme.background.raised.base } }}
                  >
                    <TaskRows context={props.context} rows={view().rows} total={plan().tasks.length} />
                  </scrollbox>
                </Show>
              </Show>
              <Show when={collapsed().hidden > 0 || expanded()}>
                <text
                  wrapMode="word"
                  fg={props.context.theme.text.action.secondary.base}
                  onMouseUp={() => {
                    if (props.context.renderer.getSelection()?.getSelectedText()) return
                    const value = snapshot()
                    if (value) props.toggle(value.key)
                  }}
                >
                  {expanded() ? "⌃ Collapse tasks" : `⌄ Show all tasks · ${collapsed().hidden} hidden`}
                </text>
              </Show>
            </>
          )
        }}
      </Show>
    </box>
  )
}

function FullPlan(props: { context: Plugin.Context; snapshot: () => Snapshot | undefined }) {
  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined
  onMount(() => props.context.ui.dialog.set({ size: "large", centered: true }))
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { id: "session-todo.plan.scroll-up", bind: "up", run: () => scroll?.scrollBy(-1) },
      { id: "session-todo.plan.scroll-down", bind: "down", run: () => scroll?.scrollBy(1) },
      { id: "session-todo.plan.page-up", bind: "pageup", run: () => scroll?.scrollBy(-1, "viewport") },
      { id: "session-todo.plan.page-down", bind: "pagedown", run: () => scroll?.scrollBy(1, "viewport") },
      { id: "session-todo.plan.start", bind: "home", run: () => scroll?.scrollTo(0) },
      { id: "session-todo.plan.end", bind: "end", run: () => scroll?.scrollTo(scroll.scrollHeight) },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={props.context.theme.text.base} attributes={TextAttributes.BOLD}>Session plan</text>
        <text fg={props.context.theme.text.muted} onMouseUp={() => props.context.ui.dialog.clear()}>esc</text>
      </box>
      <scrollbox
        ref={(value) => { scroll = value }}
        height={Math.min(28, Math.max(1, dimensions().height - 8))}
        scrollX={false}
        contentOptions={{ flexShrink: 0, gap: 1, paddingRight: 1 }}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ trackOptions: { foregroundColor: props.context.theme.scrollbar.base, backgroundColor: props.context.theme.background.base } }}
      >
        <Show when={props.snapshot()?.plan} fallback={<EmptyState context={props.context} snapshot={props.snapshot()} />}>
          {(plan) => (
            <>
              <PlanHeading context={props.context} plan={plan()} />
              <Show when={props.snapshot()?.state === "error"}>
                <text fg={props.context.theme.text.feedback.warning.base}>Plan may be out of date</text>
              </Show>
              <Show when={plan().tasks.length} fallback={<text fg={props.context.theme.text.muted}>No tasks yet</text>}>
                <TaskRows context={props.context} rows={taskWindow(plan(), true).rows} total={plan().tasks.length} />
              </Show>
            </>
          )}
        </Show>
      </scrollbox>
      <text fg={props.context.theme.text.muted} wrapMode="word">↑/↓ scroll · PgUp/PgDn · Esc close</text>
    </box>
  )
}

export default Plugin.define({
  id: "session-todo.tui",
  setup(context) {
    const [snapshot, setSnapshot] = createSignal<Snapshot>()
    const [memory, updateMemory] = context.storage.memory("task-display", {
      initial: { expanded: {} as Record<string, boolean> },
    })
    const expanded = (key: string) => memory.expanded[key] === true
    const toggle = (key: string) => updateMemory((draft) => { draft.expanded[key] = !draft.expanded[key] })
    let disposed = false
    let dialogKey: string | undefined

    function Host() {
      const target = createMemo(() => {
        const route = context.ui.router.current()
        return route.type === "session" ? targetFor(context, route.sessionID) : undefined
      }, undefined, { equals: (a, b) => a?.key === b?.key })

      createEffect(() => {
        const current = target()
        if (dialogKey && dialogKey !== current?.key) context.ui.dialog.clear()
        setSnapshot(undefined)
        if (!current || disposed) return
        onCleanup(watchPlan(context, current, (value) => {
          if (!disposed) setSnapshot(value)
        }))
      })

      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "session-todo.plan.show",
            title: "Open session plan",
            group: "Session todo",
            palette: true,
            enabled: () => !!target(),
            run: () => {
              const current = target()
              if (!current) return
              snapshot()?.refresh()
              context.ui.dialog.show(() => <FullPlan context={context} snapshot={snapshot} />, () => { dialogKey = undefined })
              dialogKey = current.key
            },
          },
          {
            id: "session-todo.tasks.toggle",
            title: snapshot() && expanded(snapshot()!.key) ? "Collapse session tasks" : "Expand session tasks",
            group: "Session todo",
            palette: true,
            enabled: () => {
              const value = snapshot()
              return !!value?.plan && (expanded(value.key) || taskWindow(value.plan).hidden > 0)
            },
            run: () => {
              const value = snapshot()
              if (!value?.plan) return
              toggle(value.key)
            },
          },
        ],
      }))
      return null
    }

    const stopHost = context.ui.slot({ append: "app", render: () => <Host /> })
    const stopSidebar = context.ui.slot({
      prepend: "sidebar.content",
      render: (props) => <Sidebar context={context} sessionID={props.sessionID} snapshot={snapshot} expanded={expanded} toggle={toggle} />,
    })
    return () => {
      disposed = true
      if (dialogKey) context.ui.dialog.clear()
      stopSidebar()
      stopHost()
    }
  },
})

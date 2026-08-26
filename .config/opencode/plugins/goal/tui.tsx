import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { displayElapsedMs, formatDuration, formatTokenCount } from "./controller.ts"
import {
  latestGoalSnapshotRecord,
  statusLabel,
  type GoalState,
  type GoalStatus,
} from "./state.ts"

function themeColor(theme: Record<string, unknown>, fallback: string, ...keys: string[]): string {
  let current: unknown = theme
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return fallback
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === "string" ? current : fallback
}

function statusColor(theme: Record<string, unknown>, status: GoalStatus): string {
  if (status === "achieved") {
    return themeColor(theme, "green", "text", "success")
  }
  if (status === "active") {
    return themeColor(theme, "cyan", "text", "accent")
  }
  return themeColor(theme, "yellow", "text", "warning")
}

function statusIcon(status: GoalStatus): string {
  if (status === "achieved") return "✓"
  if (status === "active") return "◎"
  return "◇"
}

function GoalSidebar(props: { sessionID: string }) {
  const plugin = usePlugin()
  const [now, setNow] = createSignal(Date.now())

  onMount(() => {
    void plugin.data.session.message.sync(props.sessionID)
  })

  const record = createMemo(() => {
    const messages = plugin.data.session.message.list(props.sessionID) ?? []
    return latestGoalSnapshotRecord(messages)
  })

  createEffect(() => {
    if (record()?.state?.status !== "active") return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="column" width="100%">
      {(() => {
        const hit = record()
        const state = hit?.state
        if (state == null) return null
        return <GoalCard state={state} now={now()} />
      })()}
    </box>
  )
}

function GoalCard(props: { state: GoalState; now: number }) {
  const plugin = usePlugin()
  const theme = plugin.theme as unknown as Record<string, unknown>
  const muted = themeColor(theme, "gray", "text", "muted")
  const color = () => statusColor(theme, props.state.status)
  const elapsed = () => displayElapsedMs(props.state, props.now)

  return (
    <box flexDirection="column" width="100%">
      <text fg={color()} wrapMode="word">
        {`${statusIcon(props.state.status)} ${props.state.objective}`}
      </text>
      <text fg={muted} wrapMode="word">
        {`${statusLabel(props.state.status)} · ${formatDuration(elapsed())}`}
      </text>
      <text fg={muted}>{`${props.state.turns}t · ${formatTokenCount(props.state.tokens)} tok`}</text>
    </box>
  )
}

export default Plugin.define({
  id: "local.goal.tui",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <GoalSidebar sessionID={sessionID} />,
    })
  },
})

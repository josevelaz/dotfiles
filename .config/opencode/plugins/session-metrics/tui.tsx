/// <reference path="./jsx.d.ts" />
import { open, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createMemo, onMount, Show } from "solid-js"
import {
  formatCacheHitPercentage,
  formatCost,
  formatTimestamp,
  warmingLogFilename,
  warmingLogEvent,
} from "./metrics"

const LOG_POLL_INTERVAL_MS = 500

interface Notice {
  readonly text: string
}

function themeColor(theme: Record<string, unknown>, fallback: string, ...keys: string[]): string {
  let current: unknown = theme
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return fallback
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === "string" ? current : fallback
}

function SessionMetrics(props: { sessionID?: string }) {
  const plugin = usePlugin()

  onMount(() => {
    if (props.sessionID !== undefined) void plugin.data.session.sync(props.sessionID)
  })

  const session = createMemo(() =>
    props.sessionID === undefined ? undefined : plugin.data.session.get(props.sessionID),
  )
  const label = createMemo(() => {
    const current = session()
    if (current === undefined) return "cache 0.0% · cost $0.0000"
    return `cache ${formatCacheHitPercentage(current.tokens)} · cost ${formatCost(plugin.data.session.cost(current.id))}`
  })
  const muted = themeColor(
    plugin.theme as unknown as Record<string, unknown>,
    "gray",
    "text",
    "muted",
  )

  return <text fg={muted}>{label()}</text>
}

function NoticeBanner(props: { notice: () => Notice | undefined }) {
  const plugin = usePlugin()
  const warning = themeColor(
    plugin.theme as unknown as Record<string, unknown>,
    "yellow",
    "text",
    "warning",
  )

  return (
    <Show when={props.notice()} keyed>
      {(notice) => (
        <box width="100%">
          <text fg={warning}>{`⚠ ${notice.text}`}</text>
        </box>
      )}
    </Show>
  )
}

function warmingLogPath(channel: string): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "log", warmingLogFilename(channel))
}

function watchWarmingLog(
  channel: string,
  onWarming: (sessionID: string, sentAt: Date) => void,
): () => void {
  const path = warmingLogPath(channel)
  let initialized = false
  let offset = 0
  let inode: number | undefined
  let remainder = ""
  let reading = false
  let stopped = false
  let reportedError: string | undefined

  const poll = async () => {
    if (reading || stopped) return
    reading = true
    try {
      const info = await stat(path)
      if (!initialized) {
        initialized = true
        inode = info.ino
        offset = info.size
        reportedError = undefined
        return
      }

      if (inode !== info.ino || info.size < offset) {
        inode = info.ino
        offset = 0
        remainder = ""
      }
      if (info.size === offset) {
        reportedError = undefined
        return
      }

      const length = info.size - offset
      const buffer = Buffer.alloc(length)
      const file = await open(path, "r")
      let bytesRead = 0
      try {
        const result = await file.read(buffer, 0, length, offset)
        bytesRead = result.bytesRead
      } finally {
        await file.close()
      }
      offset += bytesRead

      const lines = `${remainder}${buffer.subarray(0, bytesRead).toString("utf8")}`.split("\n")
      remainder = lines.pop() ?? ""
      if (stopped) return
      for (const line of lines) {
        const event = warmingLogEvent(line)
        if (event !== undefined) onWarming(event.sessionID, event.sentAt ?? new Date())
      }
      reportedError = undefined
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const message = error instanceof Error ? error.message : String(error)
      if (code !== "ENOENT" && message !== reportedError) {
        reportedError = message
        console.error("session metrics could not read the OpenCode log", error)
      }
    } finally {
      reading = false
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), LOG_POLL_INTERVAL_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

export default Plugin.define({
  id: "local.session-metrics.tui",
  setup(context) {
    const [notices, setNotices] = context.storage.memory("notices", {
      initial: {} as Record<string, Notice | undefined>,
    })

    const activeSessionID = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }

    const showWarmingNotice = (sessionID: string, sentAt: Date) => {
      if (activeSessionID() !== sessionID) return

      setNotices((draft) => {
        draft[sessionID] = {
          text: `Warming prompt sent • ${formatTimestamp(sentAt)}`,
        }
      })
    }

    const stopExecution = context.data.on("session.execution.started", (event) => {
      setNotices((draft) => {
        draft[event.data.sessionID] = undefined
      })
    })
    const stopWarming = watchWarmingLog(context.app.channel, showWarmingNotice)
    const stopMetrics = context.ui.slot({
      append: "prompt.footer.status",
      render: ({ sessionID }) => <SessionMetrics sessionID={sessionID} />,
    })
    const stopBanner = context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => <NoticeBanner notice={() => notices[sessionID]} />,
    })

    return () => {
      stopExecution()
      stopWarming()
      stopMetrics()
      stopBanner()
    }
  },
})

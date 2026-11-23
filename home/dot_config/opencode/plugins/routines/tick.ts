import { execFile } from "node:child_process"

import { tick } from "./runner"

const darwin = process.platform === "darwin"

// launchd appends to this file on macOS; systemd keeps the output in the journal on Linux.
const logHint = darwin
  ? "See ~/Library/Logs/opencode-routines.log"
  : "See journalctl --user -u opencode-routines"

function notify(title: string, message: string): void {
  if (darwin) {
    execFile("osascript", [
      "-e", "on run argv",
      "-e", "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e", "end run",
      "--", title, message,
    ], () => {})
    return
  }
  execFile("notify-send", ["--app-name=OpenCode", title, message], () => {})
}

const stamp = () => new Date().toISOString()

try {
  const report = await tick()
  for (const line of report.fired) console.log(`${stamp()} fired ${line}`)
  for (const line of report.failed) console.log(`${stamp()} failed ${line}`)
  if (report.newFailures.length > 0) {
    notify("OpenCode routine failed", `${report.newFailures.join(", ")}. ${logHint}`)
  }
  process.exitCode = report.failed.length > 0 ? 1 : 0
} catch (error) {
  console.log(`${stamp()} tick failed: ${(error as Error).stack ?? error}`)
  notify("OpenCode routines tick failed", logHint)
  process.exitCode = 1
}

// Report live Git data as custom tokens for Herdr's expanded agent rows.
// This file sits beside Herdr's managed Pi integration so updates do not overwrite it.
// @ts-nocheck

import { execFile } from "node:child_process";
import net from "node:net";

const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const enabled = process.env.HERDR_ENV === "1" && Boolean(socketPath) && Boolean(paneId);
const source = "custom:pi-git";
const refreshMs = 5_000;
let seq = Date.now() * 1_000;

function reportTokens(tokens: Record<string, string | null>): void {
  if (!enabled) return;

  const socket = net.createConnection(socketEndpoint!);
  const timeout = setTimeout(() => socket.destroy(), 1_000);
  timeout.unref?.();

  const close = (): void => {
    clearTimeout(timeout);
    socket.destroy();
  };

  socket.once("error", close);
  socket.once("data", close);
  socket.once("end", close);
  socket.once("connect", () => {
    seq += 1;
    socket.write(
      `${JSON.stringify({
        id: `${source}:${Date.now()}`,
        method: "pane.report_metadata",
        params: {
          pane_id: paneId,
          source,
          seq,
          tokens,
          ttl_ms: refreshMs * 3,
        },
      })}\n`,
    );
  });
}

function summarizeStatus(lines: string[]): string {
  if (lines.length === 0) return "clean";

  let staged = 0;
  let changed = 0;
  let untracked = 0;

  for (const line of lines) {
    if (line.startsWith("??")) {
      untracked += 1;
      continue;
    }
    if (line[0] && line[0] !== " ") staged += 1;
    if (line[1] && line[1] !== " ") changed += 1;
  }

  return [
    staged > 0 ? `+${staged}` : "",
    changed > 0 ? `~${changed}` : "",
    untracked > 0 ? `?${untracked}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function refreshGitMetadata(cwd: string): void {
  execFile(
    "git",
    ["-C", cwd, "status", "--porcelain=v1", "--branch"],
    { timeout: 2_000, maxBuffer: 256 * 1024 },
    (error, stdout) => {
      if (error) {
        reportTokens({ branch: null, git_status: null });
        return;
      }

      const [head = "", ...changes] = stdout.trimEnd().split("\n");
      const branch = head.replace(/^## /, "").replace(/\.\.\..*$/, "");
      reportTokens({ branch, git_status: summarizeStatus(changes) });
    },
  );
}

export default function (pi): void {
  if (!enabled) return;

  let timer: ReturnType<typeof setInterval> | undefined;
  let cwd = process.cwd();

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.hasUI !== true) return;

    cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
    refreshGitMetadata(cwd);
    timer = setInterval(() => refreshGitMetadata(cwd), refreshMs);
    timer.unref?.();
  });

  pi.on("agent_settled", () => refreshGitMetadata(cwd));

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    reportTokens({ branch: null, git_status: null });
  });
}

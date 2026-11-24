import { createHash } from "node:crypto"
import { readFileSync, watch, type FSWatcher } from "node:fs"
import { lookup } from "node:dns/promises"
import { hostname, networkInterfaces } from "node:os"
import { dirname, join, sep } from "node:path"

const repo = required("DOTFILES_REPO")
const port = Number(required("DOTFILES_SYNC_PORT"))
const configuredPeers = required("DOTFILES_SYNC_PEERS").split(",").filter(Boolean)
const chezmoi = required("CHEZMOI_BIN")
const host = hostname().split(".")[0]
const debounceMs = 2000
const catchUpMs = 30 * 60 * 1000
const selfPath = new URL(import.meta.url).pathname
const selfHash = hashOf(selfPath)

let managed = new Set<string>()
let watchers: FSWatcher[] = []
let peers: string[] = []
let running = false
let timer: ReturnType<typeof setTimeout> | undefined
const reasons = new Set<string>()
const noticeTimes = new Map<string, number>()

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function hashOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

async function run(cmd: string[], cwd = repo): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

function notify(title: string, message: string): void {
  const key = `${title}\n${message}`
  const last = noticeTimes.get(key) ?? 0
  if (Date.now() - last < 60 * 60 * 1000) return
  noticeTimes.set(key, Date.now())
  const cmd =
    process.platform === "darwin"
      ? ["osascript", "-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", title, message]
      : ["notify-send", "--app-name=dotfiles-sync", title, message]
  Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}

function fail(title: string, detail: string): void {
  log(`${title}: ${detail}`)
  notify(title, detail.split("\n").slice(0, 3).join("\n"))
}

function summary(files: string[]): string {
  const names = files.map((file) => file.replace(/^home\//, "").replace(/(^|\/)dot_/g, "$1."))
  const shown = names.slice(0, 3).join(", ")
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown
}

function ignored(path: string): boolean {
  return path.split(sep).some((part) => part === ".git" || part === "node_modules")
}

function onEvent(dir: string, file: string | null, inRepo: boolean): void {
  const path = file ? join(dir, file.toString()) : dir
  if (inRepo ? ignored(path) : !managed.has(path)) return
  schedule("change")
}

function addWatcher(dir: string, recursive: boolean): void {
  try {
    watchers.push(watch(dir, { recursive }, (_event, file) => onEvent(dir, file, recursive)))
  } catch (error) {
    log(`cannot watch ${dir}: ${(error as Error).message}`)
  }
}

async function rewatch(): Promise<void> {
  const result = await run([chezmoi, "managed", "--include", "files", "--path-style", "absolute"])
  if (result.code !== 0) {
    fail("Dotfiles sync cannot list managed files", result.stderr)
    return
  }
  managed = new Set(result.stdout.split("\n").filter((path) => path && !path.startsWith(repo)))
  for (const watcher of watchers) watcher.close()
  watchers = []
  for (const dir of new Set([...managed].map((path) => dirname(path)))) addWatcher(dir, false)
  addWatcher(repo, true)
  log(`watching ${watchers.length} directories`)
}

function schedule(reason: string): void {
  reasons.add(reason)
  clearTimeout(timer)
  timer = setTimeout(drain, debounceMs)
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (reasons.size > 0) {
      const batch = [...reasons]
      reasons.clear()
      await sync(batch)
    }
  } finally {
    running = false
  }
  if (hashOf(selfPath) !== selfHash) {
    log("sync.ts changed; exiting so the service restarts the new version")
    process.exit(0)
  }
}

async function rev(ref: string): Promise<string> {
  return (await run(["git", "rev-parse", ref])).stdout
}

async function editedTargets(): Promise<string[]> {
  const status = await run([chezmoi, "status", "--path-style", "absolute", "--exclude", "scripts,externals"], process.env.HOME)
  if (status.code !== 0) {
    fail("Dotfiles status failed", status.stderr)
    return []
  }
  const templates = await run([chezmoi, "managed", "--include", "templates", "--path-style", "absolute"], process.env.HOME)
  const skip = new Set(templates.stdout.split("\n"))
  return status.stdout
    .split("\n")
    .filter((line) => line[0] === "M")
    .map((line) => line.slice(3))
    .filter((path) => !skip.has(path))
}

async function sync(batch: string[]): Promise<void> {
  const edited = await editedTargets()
  if (edited.length > 0) {
    const readd = await run([chezmoi, "re-add", "--no-tty", ...edited], process.env.HOME)
    if (readd.code !== 0) fail("Dotfiles re-add failed", readd.stderr)
  }

  await run(["git", "add", "-A"])
  const staged = (await run(["git", "diff", "--cached", "--name-only"])).stdout.split("\n").filter(Boolean)
  if (staged.length > 0) {
    const commit = await run(["git", "commit", "-q", "-m", `chore(sync): ${host}: ${summary(staged)}`])
    if (commit.code !== 0) {
      fail("Dotfiles commit failed", commit.stderr || commit.stdout)
      return
    }
  }

  const before = await rev("HEAD")
  const pull = await run(["git", "pull", "-q", "--rebase"])
  if (pull.code !== 0) {
    await run(["git", "rebase", "--abort"])
    fail("Dotfiles sync stopped", `git pull --rebase failed on ${host}. Resolve it in ${repo}.\n${pull.stderr}`)
    return
  }
  const pulled = (await rev("HEAD")) !== before

  let pushed = false
  const ahead = Number((await run(["git", "rev-list", "--count", "@{u}..HEAD"])).stdout || "0")
  if (ahead > 0) {
    const push = await run(["git", "push", "-q"])
    if (push.code !== 0) {
      fail("Dotfiles push failed", push.stderr)
      return
    }
    pushed = true
  }

  const apply = await run([chezmoi, "apply", "--no-tty", "--keep-going"], process.env.HOME)
  if (apply.code !== 0) fail("Dotfiles apply needs you", `${apply.stderr}\nRun chezmoi diff, then chezmoi edit or chezmoi apply.`)

  if (staged.length > 0 || pulled) await rewatch()
  if (pushed) await notifyPeers()
  log(`sync (${batch.join(", ")}): committed ${staged.length}, pulled ${pulled}, pushed ${pushed}`)
}

async function notifyPeers(): Promise<void> {
  await Promise.all(
    peers.map(async (peer) => {
      try {
        await fetch(`http://${peer}:${port}/sync`, { method: "POST", signal: AbortSignal.timeout(3000) })
        log(`notified ${peer}`)
      } catch {
        log(`${peer} unreachable; it catches up on its next sync`)
      }
    }),
  )
}

function tailnetIp(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4") continue
      const [first, second] = address.address.split(".").map(Number)
      if (first === 100 && second >= 64 && second <= 127) return address.address
    }
  }
  return undefined
}

async function otherPeers(ip: string): Promise<string[]> {
  const others: string[] = []
  for (const peer of configuredPeers) {
    const address = await lookup(peer, { family: 4 }).then((result) => result.address).catch(() => undefined)
    if (address !== ip) others.push(peer)
  }
  return others
}

async function listen(): Promise<void> {
  const ip = tailnetIp()
  if (!ip) {
    log("no tailscale address yet; retrying in 15s")
    setTimeout(listen, 15000)
    return
  }
  peers = await otherPeers(ip)
  Bun.serve({
    hostname: ip,
    port,
    fetch(request) {
      if (request.method === "POST" && new URL(request.url).pathname === "/sync") {
        schedule("peer")
        return new Response("ok\n")
      }
      return new Response("not found\n", { status: 404 })
    },
  })
  log(`listening on ${ip}:${port}; peers: ${peers.join(", ") || "none"}`)
}

await rewatch()
await listen()
setInterval(() => schedule("catch-up"), catchUpMs)
schedule("start")

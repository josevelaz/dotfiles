import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { For, onCleanup, onMount, Show, type JSX } from "solid-js"

import { AgentMemory, type MemoryCommit, type MemoryFile, type MemoryRepo, type MemorySnapshot } from "./rpc.js"

type Entry = { readonly repo: MemoryRepo; readonly file: MemoryFile }
type Context = Plugin.Context

const LINK_PATTERN = /\[\[([^\]\n]+)\]\]/g

function entries(snapshot: MemorySnapshot): Entry[] {
  return snapshot.repos.flatMap((repo) => repo.files.map((file) => ({ repo, file })))
}

function resolveLink(repo: MemoryRepo, target: string): MemoryFile | undefined {
  const path = target.trim()
  return repo.files.find((file) => file.path === path) ?? repo.files.find((file) => file.path === `${path}.md`)
}

function linkTargets(content: string): string[] {
  return [...new Set([...content.matchAll(LINK_PATTERN)].map((match) => match[1].trim()))]
}

function fileCommits(repo: MemoryRepo, path: string): MemoryCommit[] {
  return repo.commits.filter((commit) => commit.files.includes(path))
}

function day(date: string): string {
  return date.slice(0, 10)
}

function summary(content: string): string {
  const line = content.split("\n").find((text) => text.startsWith("- ")) ?? ""
  return line.replace(/\s*\[[^\]]*:[^\]]*\]\s*$/, "").slice(2, 120)
}

function scrollCommands(id: string, scroll: () => ScrollBoxRenderable | undefined) {
  return [
    { id: `${id}.up`, bind: "up", run: () => scroll()?.scrollBy(-1) },
    { id: `${id}.down`, bind: "down", run: () => scroll()?.scrollBy(1) },
    { id: `${id}.page-up`, bind: "pageup", run: () => scroll()?.scrollBy(-1, "viewport") },
    { id: `${id}.page-down`, bind: "pagedown", run: () => scroll()?.scrollBy(1, "viewport") },
    { id: `${id}.start`, bind: "home", run: () => scroll()?.scrollTo(0) },
    { id: `${id}.end`, bind: "end", run: () => scroll()?.scrollTo(scroll()?.scrollHeight ?? 0) },
  ]
}

function Frame(props: {
  context: Context
  title: string
  subtitle?: string
  help: string
  setScroll: (scroll: ScrollBoxRenderable) => void
  children: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
  onMount(() => props.context.ui.dialog.set({ size: "xlarge", centered: true }))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={props.context.theme.text.base} attributes={TextAttributes.BOLD}>{props.title}</text>
          <text fg={props.context.theme.text.muted} onMouseUp={() => props.context.ui.dialog.clear()}>esc</text>
        </box>
        <Show when={props.subtitle}>
          <text fg={props.context.theme.text.muted} wrapMode="word">{props.subtitle}</text>
        </Show>
      </box>
      <scrollbox
        ref={props.setScroll}
        height={Math.max(1, dimensions().height - 12)}
        scrollX={false}
        contentOptions={{ flexShrink: 0, paddingRight: 1 }}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{ trackOptions: { foregroundColor: props.context.theme.scrollbar.base, backgroundColor: props.context.theme.background.base } }}
      >
        {props.children}
      </scrollbox>
      <text fg={props.context.theme.text.muted} wrapMode="word">{props.help}</text>
    </box>
  )
}

function FileView(props: {
  context: Context
  entry: Entry
  onLinks: () => void
  onHistory: () => void
  onObsidian: () => void
  onBack: () => void
}) {
  let scroll: ScrollBoxRenderable | undefined
  const markdown = props.context.theme.markdown
  const style = SyntaxStyle.fromStyles({
    "markup.heading": { fg: markdown.heading, bold: true },
    "markup.heading.1": { fg: markdown.heading, bold: true, underline: true },
    "markup.strong": { fg: markdown.strong, bold: true },
    "markup.bold": { fg: markdown.strong, bold: true },
    "markup.italic": { fg: markdown.emphasis, italic: true },
    "markup.list": { fg: markdown.listItem },
    "markup.quote": { fg: markdown.blockQuote, italic: true },
    "markup.raw": { fg: markdown.code },
    "markup.raw.block": { fg: markdown.code },
    "markup.raw.inline": { fg: markdown.code },
    "markup.link": { fg: markdown.link, underline: true },
    "markup.link.url": { fg: markdown.link, underline: true },
    "markup.link.label": { fg: markdown.linkText, underline: true },
    default: { fg: markdown.text },
  })
  onCleanup(() => style.destroy())

  const { repo, file } = props.entry
  const commits = fileCommits(repo, file.path)
  const links = linkTargets(file.content).length
  const subtitle = commits.length
    ? `${repo.name} · ${commits.length} commit${commits.length === 1 ? "" : "s"} · last ${day(commits[0].date)}: ${commits[0].subject}`
    : repo.name

  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      ...scrollCommands("agent-memory.view", () => scroll),
      { id: "agent-memory.view.links", bind: "l", run: props.onLinks },
      { id: "agent-memory.view.history", bind: "h", run: props.onHistory },
      { id: "agent-memory.view.obsidian", bind: "o", run: props.onObsidian },
      { id: "agent-memory.view.back", bind: "b", run: props.onBack },
      { id: "agent-memory.view.backspace", bind: "backspace", run: props.onBack },
    ],
  }))

  return (
    <Frame
      context={props.context}
      title={file.path}
      subtitle={subtitle}
      help={`↑/↓ PgUp/PgDn scroll · l links (${links}) and backlinks · h history · o Obsidian · b back · esc close`}
      setScroll={(value) => { scroll = value }}
    >
      <Show
        when={file.path.endsWith(".md")}
        fallback={<text fg={props.context.theme.text.base}>{file.content}</text>}
      >
        <markdown content={file.content} syntaxStyle={style} conceal={false} fg={markdown.text} />
      </Show>
    </Frame>
  )
}

function DiffView(props: { context: Context; title: string; text: string; onBack: () => void }) {
  let scroll: ScrollBoxRenderable | undefined
  const theme = props.context.theme
  const color = (line: string) => {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return theme.text.muted
    if (line.startsWith("+")) return theme.text.feedback.success.base
    if (line.startsWith("-")) return theme.text.feedback.error.base
    if (line.startsWith("@@")) return theme.text.feedback.info.base
    return theme.text.base
  }
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      ...scrollCommands("agent-memory.diff", () => scroll),
      { id: "agent-memory.diff.back", bind: "b", run: props.onBack },
      { id: "agent-memory.diff.backspace", bind: "backspace", run: props.onBack },
    ],
  }))
  return (
    <Frame
      context={props.context}
      title={props.title}
      help="↑/↓ PgUp/PgDn scroll · b back · esc close"
      setScroll={(value) => { scroll = value }}
    >
      <For each={props.text.split("\n")}>
        {(line) => <text fg={color(line)} wrapMode="char">{line || " "}</text>}
      </For>
    </Frame>
  )
}

export default Plugin.define({
  id: "local.agent-memory-repo.tui",
  setup(context) {
    let disposed = false
    const location = () => context.location ?? context.data.location.default()
    const rpc = () => context.client.rpc(AgentMemory)
    const options = () => ({ location: { directory: location().directory }, signal: AbortSignal.timeout(15_000) })

    const fail = (message: string, error?: unknown) => {
      context.ui.toast.show({
        title: "Agent memory",
        message: error instanceof Error ? `${message}: ${error.message}` : message,
        variant: "error",
      })
    }

    const openInObsidian = (entry: Entry) => {
      const path = join(entry.repo.root, entry.file.path)
      if (!existsSync(path)) return fail(`${path} is not on this machine`)
      const opener = process.platform === "darwin" ? "open" : "xdg-open"
      const child = spawn(opener, [`obsidian://open?path=${encodeURIComponent(path)}`], { detached: true, stdio: "ignore" })
      child.on("error", (error) => fail("Could not open Obsidian", error))
      child.unref()
    }

    const showFile = (snapshot: MemorySnapshot, entry: Entry, back: () => void) => {
      if (disposed) return
      const again = () => showFile(snapshot, entry, back)
      context.ui.dialog.show(() => (
        <FileView
          context={context}
          entry={entry}
          onLinks={() => void showLinks(snapshot, entry, again)}
          onHistory={() => void showHistory(snapshot, entry.repo, entry.file.path, again)}
          onObsidian={() => openInObsidian(entry)}
          onBack={back}
        />
      ))
    }

    const showDiff = async (repo: MemoryRepo, commit: MemoryCommit, path: string | undefined, back: () => void) => {
      try {
        const result = await rpc().diff({ repo: repo.name, hash: commit.hash, ...(path ? { path } : {}) }, options()) as { text: string }
        if (disposed) return
        context.ui.dialog.show(() => (
          <DiffView context={context} title={`${commit.hash} ${commit.subject}`} text={result.text} onBack={back} />
        ))
      } catch (error) {
        fail("Could not load the diff", error)
      }
    }

    const showHistory = async (snapshot: MemorySnapshot, repo: MemoryRepo, path: string | undefined, back: () => void) => {
      const commits = path ? fileCommits(repo, path) : repo.commits
      const again = () => void showHistory(snapshot, repo, path, back)
      const choice = await context.ui.dialog.select<MemoryCommit>({
        title: path ? `History of ${path}` : `History of ${repo.name}`,
        placeholder: "Search commits",
        options: commits.map((commit) => ({
          title: commit.subject,
          value: commit,
          description: `${commit.hash} · ${day(commit.date)}`,
          footer: path ? undefined : commit.files.join(", "),
        })),
        actions: [{ bind: "ctrl+b", title: "Back", selection: "none", onTrigger: back }],
      })
      if (choice) await showDiff(repo, choice, path, again)
    }

    const showLinks = async (snapshot: MemorySnapshot, entry: Entry, back: () => void) => {
      const { repo, file } = entry
      const outgoing = linkTargets(file.content).map((target) => {
        const resolved = resolveLink(repo, target)
        return {
          title: `[[${target}]]`,
          value: resolved ? { repo, file: resolved } : entry,
          description: resolved ? summary(resolved.content) : "Missing file",
          category: "Links",
          disabled: !resolved,
        }
      })
      const incoming = repo.files
        .filter((other) => other.path !== file.path && linkTargets(other.content).some((target) => resolveLink(repo, target)?.path === file.path))
        .map((other) => ({ title: other.path, value: { repo, file: other }, description: summary(other.content), category: "Backlinks" }))
      if (outgoing.length + incoming.length === 0) return context.ui.toast.show({ message: `${file.path} has no links or backlinks` })
      const again = () => void showLinks(snapshot, entry, back)
      const choice = await context.ui.dialog.select<Entry>({
        title: `Links of ${file.path}`,
        options: [...outgoing, ...incoming],
        actions: [{ bind: "ctrl+b", title: "Back", selection: "none", onTrigger: back }],
      })
      if (choice) showFile(snapshot, choice, again)
    }

    const browse = async (snapshot: MemorySnapshot) => {
      for (const repo of snapshot.repos) if (repo.error) fail(`${repo.name} is unavailable`, new Error(repo.error))
      const all = entries(snapshot)
      if (all.length === 0) return fail("No memory files found")
      const again = () => void browse(snapshot)
      const lastChanged = (entry: Entry) => fileCommits(entry.repo, entry.file.path)[0]
      const choice = await context.ui.dialog.select<Entry>({
        title: "Agent memory",
        placeholder: "Search file names and contents",
        options: all.map((entry) => ({
          title: entry.file.path,
          value: entry,
          description: summary(entry.file.content),
          footer: lastChanged(entry) ? day(lastChanged(entry)!.date) : undefined,
          category: snapshot.repos.length > 1 ? entry.repo.name : undefined,
        })),
        search: (query, candidates) => {
          const needle = query.trim().toLowerCase()
          if (!needle) return candidates
          const byPath = candidates.filter((option) => option.value.file.path.toLowerCase().includes(needle))
          const byContent = candidates.filter((option) => !byPath.includes(option) && option.value.file.content.toLowerCase().includes(needle))
          return [...byPath, ...byContent]
        },
        actions: [
          { bind: "ctrl+h", title: "Repo history", onTrigger: (entry) => void showHistory(snapshot, entry.repo, undefined, again) },
          { bind: "ctrl+o", title: "Open in Obsidian", onTrigger: openInObsidian },
        ],
      })
      if (choice) showFile(snapshot, choice, again)
    }

    const open = async () => {
      try {
        const snapshot = await rpc().snapshot({}, options()) as MemorySnapshot
        if (!disposed) await browse(snapshot)
      } catch (error) {
        fail("Could not load memory", error)
      }
    }

    function Commands() {
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "agent-memory.browse",
            title: "Browse agent memory",
            group: "Agent memory",
            palette: true,
            slash: { name: "memory" },
            run: () => void open(),
          },
        ],
      }))
      return null
    }

    const stopCommands = context.ui.slot({ append: "app", render: () => <Commands /> })

    return () => {
      disposed = true
      stopCommands()
    }
  },
})

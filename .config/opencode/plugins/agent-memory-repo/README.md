# Agent memory repo

Keeps agent memory in git repos that follow the
[Agent Memory Repo spec](https://github.com/AgentMemoryRepo/agentmemoryrepo).
OpenCode loads it from the global plugins directory.

## What it does

- Adds each repo's `MEMORY.md` and the spec's rules to every model call.
- Adds Code Mode tools in the `memory` namespace: `tools.memory.read`,
  `search`, `write`, `edit`, and `delete`. Agents call them inside `execute`,
  so one call can batch many reads. Each write makes one commit.
- Adds `/dream`, which lints the repos and asks the agent to add missing
  entries, merge duplicates, drop stale ones, and fix links.
- Creates `~/agent-memory` with a starter `MEMORY.md` if the folder is missing
  or empty.

## Inspect memory

### In OpenCode

Type `/memory`, or press `Ctrl+P` and pick **Browse agent memory**. It reads
the files without calling a model.

- The list shows every memory file with its first entry and the date it last
  changed. Typing searches file names first, then file contents.
- `Enter` opens a file and shows its raw text, including `[[links]]` and
  `[key: value]` metadata.
- In a file: `l` lists its links and backlinks, `h` shows the commits that
  changed it, and `Enter` on a commit shows the diff. `o` opens the file in
  Obsidian, and `b` goes back.
- In the list: `Ctrl+H` shows the repo's full history, and `Ctrl+O` opens the
  selected file in Obsidian.

The server plugin serves this data over the `agent-memory` RPC (`rpc.ts`):
`snapshot` returns every file and the last 200 commits, and `diff` returns
one commit.

### In Obsidian

`~/agent-memory` is registered as an Obsidian vault named `agent-memory`.
Obsidian reads `[[path]]` links as the spec writes them, and adds a graph view,
backlinks, and search. Its settings live in `.obsidian/`, which the repo's
`.gitignore` excludes.

Edits made in Obsidian are not committed for you. Commit them with git, or the
plugin will refuse memory writes until the repo is clean.

## Nightly dream

A launchd job, `com.jose.dotfiles.agent-memory-dream`, runs
`~/dotfiles/.local/bin/agent-memory-dream` at 03:00. If the Mac is asleep, it
runs when the Mac wakes. The script:

1. Lists root sessions from every directory updated since the last successful
   run (the last 24 hours on the first run), oldest first, up to 30.
2. Runs `/dream` with the session list in one long-lived dream session, whose
   ID is in `~/.local/state/agent-memory-dream/session-id`. It sets the
   session's agent to `memory-dream` and its model to `claude-agent/opus` with
   the `high` variant on each run. If the session is gone, it creates a new one in `~/agent-memory`
   with the session metadata `agentMemoryDream: true` and saves its ID.
3. Waits for it to finish, logs the summary to
   `~/Library/Logs/agent-memory-dream.log`, and records a mark in
   `~/.local/state/agent-memory-dream/last-success-ms`: the run time, or the
   last reviewed session's update time when more than 30 sessions were
   waiting, so the rest are reviewed the next night. A failure shows a
   notification and leaves the mark unchanged, so the next run covers the
   same sessions.
4. After a successful run, compacts the dream session so it stays small
   between nights. A failed compaction is logged but does not fail the run.

The `memory-dream` agent, defined in `opencode.jsonc`, denies every permission
except `execute`, `memory`, and `read` inside
`~/.local/share/opencode/tool-output/`, where OpenCode saves tool output it
cuts off. The plugin also drops every direct tool except `execute` and `read`
in dream sessions.

OpenCode cuts off tool results over 51,200 bytes by default. Dream sessions run
in `~/agent-memory`, so `~/agent-memory/.opencode/opencode.jsonc` raises the
limit to 250,000 bytes for sessions in that folder only:

```jsonc
{ "tool_output": { "max_bytes": 250000, "max_lines": 10000 } }
```

The memory repo's `.git/info/exclude` lists `.opencode/`, so the file stays out
of git and the repo stays clean. On a new machine, create both by hand. The
nightly prompt tells the agent to keep each `execute` result under 200,000
bytes.

`tools.memory.session_transcript` works only in dream sessions. It reads a
session's title, directory, user and assistant text, tool call inputs, and
shell commands. It leaves out tool and shell output.

After you change the plugin, run `opencode reload` so the background service,
which the nightly job uses, loads the new code.

Run it now with:

```sh
launchctl kickstart gui/$(id -u)/com.jose.dotfiles.agent-memory-dream
```

Install it on a new machine with:

```sh
ln -sf ../../dotfiles/Library/LaunchAgents/com.jose.dotfiles.agent-memory-dream.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jose.dotfiles.agent-memory-dream.plist
```

## Sync

When the branch has an upstream, the plugin runs `git pull --ff-only` on load,
before each write, and at most every five minutes during sessions. It pushes
after each commit. It never merges, resets, or force-pushes. Failures show as a
sync warning in the agent's context.

Writes are refused while a repo has uncommitted changes.

`~/agent-memory` syncs with the private repo
[josevelaz/agent-memory](https://github.com/josevelaz/agent-memory). On another
machine, clone it before starting OpenCode:

```sh
git clone git@github.com:josevelaz/agent-memory.git ~/agent-memory
```

## Settings

| Env var              | Option  | Default            |
| -------------------- | ------- | ------------------ |
| `AGENT_MEMORY_REPOS` | `repos` | `~/agent-memory`   |
| `AGENT_MEMORY_SYNC`  | `sync`  | `push`             |

`AGENT_MEMORY_REPOS` takes paths separated by `:`. Each repo's folder name is
its name in tools, so folder names must differ. `sync` is `push`, `pull`, or
`off`. Env vars win over options. The background service reads env vars when it
starts, so run `opencode service restart` after you change them.

## Check

```sh
bun install
bun run typecheck
```

`typecheck` covers the server plugin only. `tui.tsx` also needs
`@opentui/core`, `@opentui/solid`, `@opencode/theme`, and `solid-js`, which
OpenCode provides at runtime.

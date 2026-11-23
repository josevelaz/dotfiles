# Routines

Runs prompts on a cron schedule. Each run starts a fresh, unattended OpenCode
session. You make routines by asking for them in plain words.

## Make a routine

Type `/routine` and say what you want:

```text
/routine every weekday at 9am, summarize the open PRs in this repo that wait on my review
```

The agent turns that into a cron expression and a self-contained prompt,
saves the routine, and shows the next run times. `/routine` with no text lists
your routines.

You can also just ask in any session ("run this every Monday at 8"). Agents
reach the Code Mode tools in the `routines` namespace:

| Tool                     | Does                                                    |
| ------------------------ | ------------------------------------------------------- |
| `tools.routines.create`  | Make a routine: name, schedule, prompt, and optionally folder, timezone, agent, model |
| `tools.routines.list`    | Show each routine with its next run, last run, and last error |
| `tools.routines.update`  | Change any field, or pause and resume with `enabled`    |
| `tools.routines.remove`  | Delete a routine. Past run sessions stay                |
| `tools.routines.run`     | Run one now, without changing its schedule              |

The tools use the permission key `routines`, so you can set it to `ask` in
`opencode.jsonc` if you want to approve each change.

## Fields

- `schedule`: 5-field cron (`minute hour day-of-month month day-of-week`), or
  a nickname such as `@daily`. Uses the Mac's local time unless `timezone`
  names an IANA zone.
- `prompt`: what each run gets. Runs have no chat history, so it must stand
  alone. The runner adds a note above it saying the run is unattended.
- `directory`: the folder each run works in. Defaults to the folder of the
  session that made the routine.
- `agent`, `model`: optional. `model` is `provider/model` or
  `provider/model#variant`, such as `claude-agent/opus#high`.

Create and update check the schedule, folder, agent, and model, and refuse
bad values.

## How runs happen

A launchd job, `com.jose.dotfiles.opencode-routines`, runs `tick.ts` every 60
seconds. Each tick reads the routines and, for each one whose next slot has
passed, it:

1. Creates a session titled `Routine: <name>` in the routine's folder, with
   metadata `routineID`, and the routine's agent and model.
2. Sends the prompt and returns at once. It does not wait for the run.

`opencode api` starts the background service if it is down, so runs do not
need an open OpenCode window.

If the Mac sleeps through one or more slots, the routine runs once on wake,
not once per missed slot. If a run fails to start, the tick retries each
minute for 10 minutes and then skips that slot. The first failure shows a
macOS notification, and later ones stay quiet until a run succeeds.

Turn a routine off without deleting it, from the desktop page or by asking the
agent to disable it.

## Permissions

Routine runs approve their own permission prompts. A permission hook in the
server plugin turns every `ask` into `allow` for sessions whose metadata has a
`routineID`, and for any subagents they start. Explicit `deny` rules still
block, because OpenCode never passes a deny to the hook. A routine can do
anything the agent may do without asking, so pick its agent with that in mind.

This works with no client connected. The terminal's `"permissions":
"autoaccept"` setting in `cli.json` only answers prompts while a terminal
client is open.

## Desktop

The GUI part (`gui.tsx`) adds a **Routines** page to OpenCode Desktop's
Settings, and an **Open routines** command in the command palette. For each
routine it shows:

- an on/off switch, the cron schedule, and the next three runs
- the folder, agent, and model it runs with
- the prompt
- the last runs, with an **Open** button that opens each run's session, and
  the last error
- **Run now** and **Delete** buttons

The page refreshes every 15 seconds while it is open. It reads and changes
routines through the `local.routines` RPC in `rpc.ts` (`list`, `setEnabled`,
`run`, `remove`). Each routine keeps its last 20 runs in its run state file.

The app loads only the built bundle, `dist/gui-experimental.cjs`, so rebuild
and commit it after changing `gui.tsx`:

```sh
bun run build
```

OpenCode reads a plugin's `exports` once per service process. After adding or
renaming a part, run `opencode service restart`; `opencode reload` is not
enough.

## Files

| Path | Holds |
| ---- | ----- |
| `~/.local/state/opencode-routines/routines/<id>.json` | Routine definitions |
| `~/.local/state/opencode-routines/runs/<id>.json` | Last 20 runs, last error, schedule bookmark |
| `~/Library/Logs/opencode-routines.log` | One line per run or failure |

Set `OPENCODE_ROUTINES_DIR` to move the state folder, and `OPENCODE_BIN` to
use another `opencode` binary.

## Install on a new machine

```sh
cd ~/.config/opencode/plugins/routines && bun install
ln -sf ../../dotfiles/Library/LaunchAgents/com.jose.dotfiles.opencode-routines.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jose.dotfiles.opencode-routines.plist
```

OpenCode loads the plugin from the global plugins folder. After changing
`index.ts`, run `opencode reload`. The tick reads the code fresh each minute.

## Check

```sh
bun run typecheck
bun run build
bun run tick
```

`typecheck` covers the server part, the tick script, and the GUI.

## Why not `experimental.schedules`

OpenCode has an experimental scheduler, but each schedule belongs to one
existing session and wakes that same session every time. Routines start a new
session per run, have names, and live apart from any session.

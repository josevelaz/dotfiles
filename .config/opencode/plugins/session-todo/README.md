# Session todo

Server plugin ID: `local.session-todo`. The effective tool name is `todo`, with no namespace. It stores one goal and an ordered task list per session. It does not generate hidden plans, grant permission, change auth, or expose RPC/CLI writes. The agent maintains meaningful multi-step work within the user's agreed scope; it must not invent tasks or expand that scope.

## Primary-agent access

Only primary callers can execute `todo` and receive its planning guidance. Agents with mode `primary` or `all` may use it in a top-level session or a user-facing fork. Agents with mode `subagent`, and delegated child sessions regardless of their selected agent mode, are denied at execution. Fork history links are not delegation links.

The model-context hook omits planning guidance and saved-plan context for denied callers and removes the direct tool entry. Under the Code Mode default the catalog entry may still be visible to denied callers; this is not authorization. The executor checks the actual calling agent and session again, so a guessed, visible, or previously captured tool call cannot bypass the restriction. Missing or unverifiable caller metadata denies access before plan storage is read or changed. Existing saved plans remain intact; the read-only sidebar/RPC contract does not change.

## Terminal use

OpenCode discovers this directory under its global `plugins/` directory. Do not add a second copy to `cli.json`. If the server was already running when the plugin was added, run `opencode reload` when a configuration reload will not disrupt other work, then reopen the terminal UI. No authentication or provider changes are needed.

The sidebar shows the goal, completed task count, and the previous two tasks, current task, and next two tasks in plan order. Task numbers stay stable. Click the chevron to show all tasks or collapse them. Expanded lists scroll with the mouse wheel.

Press `Ctrl+P` and select **Expand session tasks** or **Collapse session tasks** for the keyboard equivalent. Select **Open session plan** for a scrollable full-list dialog, including in narrow terminals where the sidebar is hidden. The dialog supports arrow keys, Page Up/Down, Home/End, and Escape.

Request goal or task changes in chat; the agent makes them through `todo`. The UI does not edit plans. Expansion is remembered separately for each session until the terminal exits. With no explicit current task, the display uses the first unfinished task. Once all tasks are done, it shows the last two and **Complete**.

## Tool reference

The tool uses the platform Code Mode default (no explicit `codemode` option) and is reached through the Code Mode catalog as `tools.todo`. Call it with an object containing `action` and only that action's fields:

| Action | Fields |
| --- | --- |
| `read` | None |
| `set_goal` | `goal` |
| `add_task` | `title`, optional `status` (default `pending`) |
| `update_task` | `taskID`, `title` and/or `status` |
| `remove_task` | `taskID` |
| `reorder_tasks` | `taskIDs`: every existing ID exactly once |
| `set_current` | `taskID`: an unfinished task ID or `null` |

Set a goal before editing tasks. Goals allow 1–1,000 characters; titles allow 1–240. Whitespace-only text is rejected. A plan allows at most 50 tasks. Task status is `pending`, `done`, or `blocked`; there is no `current` status. IDs come from `add_task` and remain stable when tasks change or move.

Tool results contain JSON text shaped as `{ "plan": Plan | null }`. The write session ID comes only from tool execution context. Callers cannot pass a target session ID. Invalid edits leave storage unchanged. No-op edits leave the revision unchanged and emit no event.

The tool uses Standard Schema validation to reject forbidden fields before execution, including `sessionID` and fields irrelevant to the selected action. Its JSON Schema conversion exposes the same actions and bounds as a plain closed object (Anthropic forbids top-level `allOf`/`oneOf`/`anyOf` and strict tools require `additionalProperties: false`). V2's input-repair hook may strip unknown fields before validation on plain objects; the executor still derives the session from context, so stripped fields cannot redirect writes.

An explicit current task may be pending or blocked, never done. Marking it done or removing it clears `currentTaskID`. Clearing current does not set another task; the UI can display the first unfinished task as its fallback.

## Storage and model context

`ctx.storage` persists `session/<sessionID>/plan`, scoped to this plugin ID. `plan.ts` exports `Plan` and `Task`. Plans use format `version: 1` and monotonically increasing `revision`. The server validates saved data before use; it rejects unknown versions and corrupt state instead of overwriting them. Child and fork sessions start with separate, empty state.

Per-session queues serialize read/modify/write operations across this module's location instances. The server saves a complete plan before emitting an update. The context hook restores the goal, explicit current task, up to 20 unfinished tasks, and totals before model calls. It bounds goal/title lengths in that snapshot and directs the model to call `tools.todo({ action: "read" })` for full details. Plan text remains data, not instructions or approval.

A conflicting earlier `todo` registration fails plugin setup. If a later transform replaces or removes it, the context hook reports that conflict rather than directing the model to another tool.

## Read-only RPC

Import `SessionTodo` from `./rpc` and create `context.client.rpc(SessionTodo)`. RPC ID: `session-todo`.

```ts
const todo = context.client.rpc(SessionTodo)
const result = await todo.get(
  { sessionID },
  { location: { directory: session.location.directory } },
) as { plan: Plan | null }
```

`get` requires an existing session whose ID, directory, project, and optional workspace identity match the plugin instance. Missing and `null` workspace IDs both mean no workspace; otherwise both sides must expose the same nonempty string. A distinct, malformed, or one-sided workspace identity fails closed, before storage access. Wrong-location and missing-session reads return declared error `invalid_session`. Tool reads/writes and model-context restoration use this same guard.

V2.0.20's public `Session.Info.location` exposes only `directory`, while plugin `ctx.location` may contain a workspace ID. A workspace-scoped plugin therefore cannot prove a match through that public session response and rejects access; it does not assume directory/project equality is enough. Normal absent/absent workspace access works. The public routing API offers no workspace field to resolve that restriction. Do not route a read solely by the currently visible project when reading another session.

Subscribe to `updated`; its data is `{ sessionID: string, revision: number }`, with event location supplied by OpenCode. Filter by session and location, then fetch `get` again. Events are invalidations, not plan snapshots. They are live-only; refresh on reconnect and session changes. JSON Schema outputs have TypeScript type `unknown`, hence the cast above.

## Runtime and validation

This package adds no dependencies. It exports plain V2 plugin/RPC definitions, checked with type-only `@opencode/plugin` imports. `Plugin.define` returns the same object, and `Rpc.define` only checks reserved error names; none are used here. Type-only imports avoid loading the root's old beta API. They also avoid a missing-package error: V2.0.20 did not resolve a bare server-side `@opencode/plugin` import in the isolated host.

Runtime checks used the installed `opencode v2.0.20` in a private loopback host with separate HOME/XDG/config/data paths, no copied credentials, and model fetching disabled. No user service restart or root config/dependency edit was made.

Retained backend evidence:

`/private/var/folders/00/kg4g6rwj56df8m493xpgm7s00000gn/T/opencode/session-todo-backend-906tgaxp/`

- `smoke.py` and `evidence.json`: 33 passing integration checks for actions, invalid edits, stable IDs, concurrency, task bounds, session/fork/location isolation, context snapshot bounds, corrupt-state rejection, and plugin reload persistence.
- `events-smoke.py` and `events-evidence.json`: real SSE updates with location and monotonic revision; no update for no-op or rejected edits.
- `direct-plugin-evidence.json`: the delivered package loads without the harness, exposes server/TUI/RPC entrypoints, and reads the saved plan.
- `conflict-evidence.json`: an earlier effective `todo` tool disables this plugin with an explicit transform failure, instead of being overwritten.
- `tsconfig.json`: strict backend-only TypeScript check against cached V2.0.11 declarations; it passed. Runtime/API checks used V2.0.20, not that cached version.

The initial isolated harness calls the registered tool executor and captures the context hook. Those checks alone do not prove provider-driven tool calls or TUI behavior; the independent real-host checks below cover both. No unit tests were added.

### Security follow-up evidence

`/private/var/folders/00/kg4g6rwj56df8m493xpgm7s00000gn/T/opencode/session-todo-workspace-8lp2h3kj/`

- `source/`: primary source pinned to V2.0.20 commit `84c9be93a56304a108f1a22df0c5d62c26d5b6ca`. Location schemas omit public workspace identity; the Promise session adapter uses the public session endpoint. Tool runtime supports `~standard.validate` and `~standard.jsonSchema.input/output`; the built-in repair hook runs before decoding.
- `openapi.json` and `baseline.json`: isolated runtime API, binary hash, and preservation hashes for the Terminal use section and UI files.
- `workspace-smoke.py` and `workspace-evidence.json`: 11 instrumented cases across RPC, tool reads/writes, and context restoration. The harness substitutes optional workspace fields on real session/plugin-location results and counts backend storage calls. All rejected cases access storage zero times. These are boundary inputs, not actual workspace routing.
- `model-smoke.py`, `fake-provider.py`, and `model-evidence.json`: real V2.0.20 model/session/tool dispatch against a loopback fake provider, using the delivered plugin without the boundary harness and with built-in input repair enabled. Normal goal/task calls work; forbidden `sessionID` and irrelevant action fields produce tool errors, leaving both sessions' plans and revisions unchanged. The provider receives the `todo` action schema.
- `smoke.py` / `evidence.json` and `events-smoke.py` / `events-evidence.json`: affected backend integration and real SSE checks rerun against this candidate.

The fake provider uses only an inert local placeholder credential. No external model account, shared-service reload, root dependency/config change, or source unit test is needed.

### Independent real-host acceptance

OpenCode V2.0.20 acceptance passed against a frozen copy matching the delivered runtime files. The verifier exercised actual local fake-model tool calls and the real terminal UI, not mocked host controls.

Report, hashes, terminal captures, and recorded requests:

`/private/var/folders/00/kg4g6rwj56df8m493xpgm7s00000gn/T/opencode/tq2-f6jn8zrd/report-candidate2.md`

The checks covered all task operations, malformed model calls, sidebar ordering, native mouse and palette controls, focus recovery, live updates, child/fork isolation, long lists, narrow dialogs, restart durability, and read-error recovery. Private test processes were disposed. No user shared-service or account changes occurred. Remote workspace routing remains outside this local acceptance scope and subject to the restriction above.

### Primary-only follow-up

Independent backend acceptance passed on OpenCode V2.0.21:

`/private/var/folders/00/kg4g6rwj56df8m493xpgm7s00000gn/T/opencode/todo-primary-qa-g92a_ynl/REPORT.md`

Actual model requests confirmed primary/all root access, native child denial even after agent switches, top-level subagent denial, and primary fork access. That candidate set `codemode: false`, so denied requests omitted the direct tool along with planning guidance and saved-plan context. Under the current Code Mode default the catalog entry may remain visible (see Primary-agent access above) while the executor guard is unchanged. Separate captured-executor checks denied access before storage reads or writes. Existing plans and read-only RPC remained intact. Security and correctness reviews passed. This restriction supersedes the earlier child-write behavior; UI files did not change. Private processes were stopped, with no external model calls or shared-service reload. A follow-up Code Mode dispatch run confirmed primary use via `execute` and denied forced calls without plan changes; its only failing criterion was catalog omission, which is now accepted behavior above.

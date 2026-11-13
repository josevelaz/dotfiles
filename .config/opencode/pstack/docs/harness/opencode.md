# pstack in OpenCode

pstack skills use Cursor names. In OpenCode, read this file once per session, then read `claude-code.md` beside it and apply its mappings with these OpenCode changes. `<pstack>` is `~/.config/opencode/pstack`.

- Run another pstack skill (`/name` or "the **name** skill"): load it with the `skill` tool by its id (for example `maintain-verification-skill`), or read `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type one, write `/pstack:<name>` only for the commands that exist; otherwise write `@<name>`.
- `Task` / `Agent` / subagents: use OpenCode's `task` tool with a subagent this config defines. The built-in `general`, `explore` and `scout` agents may be disabled; if so, use the subagents available (in the Herder session: `herder-implementer` for edits, `herder-tester` for read-only browser checks), or do the work yourself in this session and say so.
- Models: OpenCode picks the model per agent. Omit model/effort fields pstack names and say so.
- Todolist: use `todowrite` if available, otherwise keep the list in your reply.
- Cursor-only features (Automations, Bugbot setup, cloud agents): write `Skipped in OpenCode: <step>. <reason>.` and go on.
- `teach` is not loaded from pstack here, because the user already has their own `teach` skill. Read `<pstack>/skills-excluded/teach/SKILL.md` if a pstack step needs it.

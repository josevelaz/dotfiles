# Subagents

This extension adds a `delegate` tool. Each call starts a separate Pi process with an isolated context.

## Define a subagent

Create `~/.pi/agent/agents/<name>.md`:

```markdown
---
description: Review a focused code change
model: openai-codex/gpt-5.6-luna
thinking_level: auto
fast: true
---

Review the requested change. Report concrete bugs and cite file paths and lines.
Do not edit files.
```

The filename is the subagent name. The Markdown body is appended to the child Pi system prompt.

Frontmatter fields are optional:

- `model`: Uses a Pi model pattern such as `provider/model`. If absent, the subagent inherits the parent model.
- `thinking_level`: Accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `auto`. If absent, the subagent inherits the parent level. With `auto`, the calling LLM must choose `thinking_level` in the `delegate` call.
- `fast`: Passes `--fast` to child Pi when `true`. This requires the `pi-fast-toggle` extension.

Run `/reload` after you add or change a definition if you want the updated agent list in the tool description. The extension reads the selected file again on each call.

## Delegate modes

The tool requires `mode`:

- `sync`: Wait for the subagent. The parent agent loop blocks until the result is ready.
- `async`: Return a task ID immediately. Pi sends the result as a follow-up message when the subagent finishes, which resumes the parent agent if it is idle.

Background tasks stop when the Pi session shuts down or reloads.

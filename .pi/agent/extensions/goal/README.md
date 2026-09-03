# Pi Goal Extension

A session-scoped `/goal` workflow modeled on Claude Code and Codex Goals.

## Commands

```text
/goal <completion condition>  Set a goal and start work
/goal                         Show the current or achieved goal
/goal check                   Show goal status
/goal pause                   Pause automatic work
/goal resume [prompt]         Resume a paused, blocked, or budget-limited goal, with optional direction
/goal clear                   Remove the goal
```

Claude-compatible clear aliases are also accepted: `stop`, `off`, `reset`, `none`, and `cancel`.

## Behavior

- Keeps the objective in the system prompt while the goal is active.
- Continues automatically when the agent settles and no user input is queued.
- Requires a completion audit against concrete evidence before the model can mark the goal achieved.
- Shows elapsed active time, model turns, and token use in pi's footer.
- Stores snapshots in the pi session, so goal state follows session branches and survives reloads or resumes.
- Pauses after an interrupted response.
- Accepts optional direction when resuming, such as `/goal resume Use the staging credentials and retry the blocked deployment`.
- Pauses when an automatic continuation makes no tool call, which prevents empty loops.
- Stops after 100 automatic continuations as a runaway-loop safeguard. Token usage never stops a goal. `/goal resume` starts it again.

The private `goal_report` tool is active only while a goal is being pursued. The model uses it to mark the goal achieved with evidence or blocked with a reason. The explanation appears as a normal `goal-report` chat message in the transcript, not as tool-call metadata; the tool result itself only carries the status.

## Examples

```text
/goal All tests pass with no deprecation warnings
/goal Migrate the payments API to gRPC without changing public behavior, and pass integration tests
/goal Produce the Goals docs page, verify the docs build, and ensure every command matches current behavior
```

Strong goals name a measurable outcome, a verification surface, and important constraints.

## Development

```bash
bun test ~/.pi/agent/extensions/goal/index.test.ts
```

After editing the extension, run `/reload` in pi.

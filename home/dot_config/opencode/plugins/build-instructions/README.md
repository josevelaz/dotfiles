# Build instructions

Adds `../../BUILD.md` to sessions that run the `build` agent, as a session
instruction entry (`api/build-instructions`). OpenCode treats the entry like
`AGENTS.md`: it joins the initial instructions, and later edits or agent
switches reach the model as instruction updates instead of rewriting the system
prompt, so the prompt cache survives.

- The prompt hook writes the entry before the first model call. A session with
  no stored agent counts as `build`, the configured `default_agent`.
- The context hook checks the real agent on every model call and adds, updates,
  or removes the entry to match.
- Other agents and subagents never get the rules. Leave `BUILD.md` blank or
  delete it to turn them off.

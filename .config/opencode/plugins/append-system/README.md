# Append system prompt

Add global system instructions to `../../APPEND_SYSTEM.md`. The plugin reads
the file before each model call, so edits apply without a service restart. Leave
the file blank to disable the extra instructions.

Instructions in `../../APPEND_BUILD.md` are appended only for the built-in
`build` agent, after the global instructions. Leave it blank or delete it to
disable them.

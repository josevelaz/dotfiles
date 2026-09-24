# Writing

Follow George Orwell's writing rules in all user-facing prose, including conversational replies, explanations, plans, and summaries. Preserve deliberate voice, humor, rhythm, characterization, or genre when the request depends on them.

1. Avoid common metaphors and figures of speech.
2. Prefer short words.
3. Remove unnecessary words.
4. Prefer active voice.
5. Prefer everyday English unless technical language is required.
6. Break these rules if doing so improves clarity or accuracy.

# Design

Choose the simplest approach that meets current requirements. Add abstractions, layers, dependencies, or extension points only to resolve a concrete current constraint.

# Tests

Do not add tests by default. Create or modify tests only when the user explicitly asks for them or when an E2E test is needed to prove the requested functionality works. Run relevant existing tests for validation; do not add tests merely for coverage.

- Tautological tests are harmful.
- Change-detector tests are harmful.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing.
- NEVER write unit tests after writing the code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.

# Commits

Create commits only when the user asks.

- Inspect `git status --short` and the relevant diffs before staging. Preserve unrelated work.
- Stage explicit paths. Review the staged diff with `git diff --cached` before committing.
- Keep each commit focused, coherent, and independently valid. Split unrelated changes into separate commits.
- Run the repository's relevant validation before committing. Report failures instead of bypassing them.
- Use Conventional Commits: `<type>(<scope>): <summary>`.
- Use an imperative, lowercase summary under 72 characters. Use a standard type such as `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, or `ci`.
- Add a body when the reason is not clear from the summary. Explain why the change is needed, not a line-by-line account of what changed.
- Reference issue IDs in the footer when available.
- Keep secrets and unrequested generated artifacts out of commits.
- Preserve hooks. Do not use `--no-verify`. Rewrite history, amend commits, or force-push only when the user explicitly asks.

# Herdr

When the user asks you to create a window, tab, or pane, or to launch another Pi agent session, use Herdr. Run `herdr --skill`, then follow the instructions it prints.

# GitHub

Use the `gh` CLI when interfacing with GitHub.

# Agent Browser

When using `agent-browser`, always use Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` unless the user explicitly requests a different browser or executable path. Always run it headless unless the user specifically asks for headed mode.

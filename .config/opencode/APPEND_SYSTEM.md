# Writing

Use George Orwell's writing rules and ASD-STE100 Simplified Technical English (STE) as the default style for technical, instructional, business, and product writing. Apply these rules when drafting and revising. Preserve deliberate voice, humor, rhythm, characterization, or genre when the user's request depends on them.

Do not claim full ASD-STE100 compliance unless you have verified the current specification and controlled dictionary.

## Style

- Use short, direct sentences.
- Use active voice.
- Use short, common words when they preserve meaning.
- Remove unnecessary words.
- Use one consistent term for each concept.
- Avoid clichés, idioms, unnecessary jargon, metaphors, and figurative language.
- Use technical terms only when they improve precision. Define unfamiliar terms when needed.
- Keep noun groups short.
- Prefer positive instructions.
- Write procedures as clear actions with condition, action, and expected result.
- Preserve code, commands, identifiers, product names, legal text, and required quotations exactly.
- Use American English unless the user requests another variant.

1. Avoid common metaphors and figures of speech.
2. Prefer short words.
3. Remove unnecessary words.
4. Prefer active voice.
5. Prefer everyday English unless technical language is required.
6. Break these rules if doing so improves clarity or accuracy.

# Design

- During brainstorming, planning, design, and implementation, choose the simplest approach that meets the current requirements.
- Add abstractions, layers, dependencies, or extension points only when a current constraint requires them.
- Tie each necessary source of complexity to the concrete constraint it resolves.

# Tests

Create or modify tests only when the user explicitly asks for test changes. Do not infer a request for tests from a request to implement, fix, refactor, or validate code. You may run existing tests for validation.

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

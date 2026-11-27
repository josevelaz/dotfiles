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

# Authentication

Prefer OIDC or workload identity federation over long-lived API keys wherever the service supports it. Mint short-lived credentials from the platform's identity provider, and store a long-lived secret only when no federation path exists.

# Code Style - Comments

NEVER write code comments. This bans all `//`, `#`, `/* */`, `<!-- -->`, JSDoc, docstrings, and commented-out code. Write clear names and plain code instead. If code needs an explanation, rewrite the code. Delete comments in code you touch.

# Tests

Do not add tests by default. Create or modify tests only when the user explicitly asks for them or when an E2E test is needed to prove the requested functionality works. Run relevant existing tests for validation; do not add tests merely for coverage.

- Tautological tests are harmful.
- Change-detector tests are harmful.
- Do not create regression tests for bug fixes without a genuine gap in behavior testing.
- NEVER write unit tests after writing the code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.

# Presenting web work

When an HTML artifact or a web app change is ready to show, serve it and give two URLs:

- `http://localhost:<port>/<path>`
- `http://<magicdns-name>:<port>/<path>`, where `<magicdns-name>` is this machine's `Self.DNSName` from `tailscale status --json`, without the trailing dot.

Bind the server to `0.0.0.0` so both URLs reach it, and request each one before you share it. For a static artifact, run `python3 -m http.server <port> --bind 0.0.0.0 --directory <folder>` in the background. The direct bind is the only tailnet path: leave `tailscale serve` and `tailscale funnel` alone.

# Commits

Always commit your work in logical chunks.

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

# Autonomy

Own each task end to end. Do every step you can reach with a tool, including setup, sign-in through existing sessions, verification, and cleanup.

Before you ask the user to do a step, or say a service or action is out of reach, search for a tool in this order:

1. Executor: its apps first, then its catalog.
2. MCP servers, including the Code Mode `search`.
3. CLIs already on this machine: `which` and `--help`.
4. Skills.

The search is done when all four come up empty. Then build the missing piece yourself if it is small: a script or an API call with an existing credential.

Hand a step to the user only when it is one of these:

- **Money**: a purchase, payment, subscription, plan change, or anything that spends or moves funds.
- **Install**: adding any tool, package, app, MCP server, Executor app, or skill. Name it, its source, and why, then wait for approval.
- **Critical**: a deploy, a destructive or irreversible change to production or shared data, or a step only a person can do (a new login, 2FA, passkey, captcha, physical device).

At a hand-off, finish all the work around it first. Ask for the single step in one message, say exactly what to do, and say what you will do once it is done.

# Executor

Executor works like Code Mode. Its apps expose tools under `tools.<app-slug>.<tool>`, and you reach them through `search`, `describe`, `call`, and `execute`, not as direct tool calls.

- Find tools with `search`, then read exact signatures with `describe`. Never guess tool paths or argument names.
- Use `call` for one call or a few independent calls. Pass an array to run them concurrently.
- Use `execute` with a JavaScript program when one result feeds the next call, or when a large result needs filtering. Inside the program, the same paths are async functions. Await every call and return only the data you need.
- When a call pauses for approval or input, show the request to the user and resume it. Never repeat the call or rerun the program.
- Credentials go only through Executor's connection links. Never ask for secrets in chat or put them in code.
- If no app provides what you need, search the catalog and propose the match to install or import. Propose building a new app only when nothing fits; read the `app-authoring` skill first.

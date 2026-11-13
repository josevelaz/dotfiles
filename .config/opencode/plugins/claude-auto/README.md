# claude-auto

Adds `claude-agent/auto`. For each user message, Jev (`opencode/jev-1.13-free`) classifies the
request and the turn is served by the Claude model and effort recommended in
[Which Claude model should you build with?](https://claude.dev/blog/which-claude-model-should-you-build-with/).

Requires OpenCode 2.2.7+ (`experimental.model.resolve` hook). On older versions `auto`
runs as Opus 5.5.

## What you see

OpenCode Desktop (`gui.tsx`, built to `dist/gui-experimental.cjs`):

- **Toast** when a routing decision changes the model or effort (the first decision in a session
  always shows one), for the session you're viewing and its subagents:
  `herder-tester → Opus 5.5 · high effort`, with the reason below.
- **Pill above the composer**: the session's own route, `Opus 5.5 · medium`, plus `+N` for its
  running auto-routed subagents (`Opus 5.5 · medium · +2`). Click it for a list: this session first,
  then each subagent's agent, route and reason. Finished subagents drop off; their session header keeps the model they used.
- **Session header label** `auto → Sonnet 5.5 · high effort`. It also shows inside subagent
  sessions, where the app never shows composer pills.

Terminal UI (`tui.tsx`): the same toast, and a footer such as
`auto → Opus 5.5 · medium effort · +2` (running subagents).

Decisions are stored per session, so the views fill in after a reload or for subagents that ran earlier.

Each reply's footer also names the model that served it (`Build · Sonnet 5.5`).

## How it routes

- Routing runs once per user message. Tool-loop steps reuse that message's decision.
- Jev answers five questions: the task category (one per row of the article's table), its
  difficulty, whether it's implementation work that adds or changes UI or UX, whether the user
  says the last attempt fell short, and whether it's a follow-up to the previous message.
- The category sets the starting point on the article's escalation ladder:
  `haiku/medium → haiku/high → sonnet/low → sonnet/medium → sonnet/high → opus/medium → opus/high → fable/medium → fable/high → fable/xhigh`
- Difficulty moves a route up only when Jev is at least 60% sure: `demanding` adds one rung,
  `hardest` adds two. Non-Fable categories stop at `fable/medium`.
- **UI/UX rule:** implementation work that adds or changes UI or UX runs on at least `opus/high`,
  whatever its category or difficulty, and even on a follow-up from a lower route. Questions about
  a UI and browser QA don't count.
- **Fable is rationed**, based on Artificial Analysis (Intelligence Index v5, Nov 2026):

  | Route | Score | Cost per task | Minutes per task |
  | --- | --- | --- | --- |
  | sonnet/medium | 31 | $0.78 | 3.6 |
  | sonnet/high | 42 | $1.64 | 7.0 |
  | opus/medium | 48 | $2.45 | 7.1 |
  | opus/high | 52 | $3.46 | 9.5 |
  | fable/medium | 56 | $3.80 | 8.1 |
  | fable/high | 62 | $9.08 | 17.5 |
  | fable/xhigh | 62 | $14.83 | 26.1 |

  Fable at `medium` costs about what Opus `high` does, but above `medium` its cost and time more
  than double. So a Fable category (major refactor or architecture, deep research) must win with
  at least 80% probability, otherwise the turn is treated as everyday engineering on Opus. Fable
  categories start at `fable/medium` and reach `fable/high` only for confident `hardest` work.
  `fable/xhigh` is reached only after a shortfall at `fable/high`.
- When the user says the last attempt fell short, the route moves one rung above the one that fell short.
- A follow-up keeps the previous model, so the prompt cache and thinking survive.
- If Jev is unsure of the category (confidence < 0.4) or fails, the turn uses Opus 5.5 at `medium`.
- Titles use `haiku/low`. Compaction uses the current model. `session.generate` uses `sonnet/medium`.
- Decisions are saved in plugin storage, so follow-up stickiness survives restarts.

## Options

```jsonc
{ "plugins": [{ "package": "./plugins/claude-auto", "options": { "jevModel": "jev-1.13", "timeoutMs": 5000 } }] }
```

Without the object form it loads automatically from `~/.config/opencode/plugins/` with the
defaults (`jev-1.13-free`, 5000 ms).

## Files

- `router.ts`: pure policy (categories, ladder, Jev questions, decision).
- `index.ts`: server part. Adds the model, routes requests, stores and broadcasts decisions.
- `rpc.ts`: `get` (last decision for a session), `family` (latest decision of every session under the same root), and the `routed` event.
- `tui.tsx`: terminal toast and footer indicator.
- `gui.tsx`: desktop toast and composer pill. Rebuild with `bun run build` after editing
  (the app loads only the prebuilt `dist/gui-experimental.cjs`, so commit it).

Typecheck with `bun run typecheck`. OpenCode resolves the package's `exports` once per server
process: after adding a part, run `opencode service restart`. A location reload isn't enough.

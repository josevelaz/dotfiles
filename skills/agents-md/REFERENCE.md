# AGENTS.md Reference

Use this when creating or refactoring `AGENTS.md` or `CLAUDE.md` files.

## Root file target

The root file should usually contain only:

1. A one-sentence project description
2. Package manager guidance if the default guess is likely wrong
3. Non-standard build, typecheck, test, or workflow commands
4. Instructions that are genuinely relevant to almost every task in the repo

If a line does not meet that bar, it probably belongs somewhere else.

## What to move out of root

Move these into linked docs or narrower-scope `AGENTS.md` files:

- language conventions
- testing patterns
- API conventions
- framework-specific guidance
- deployment details
- package-specific rules
- long examples
- checklists that only matter for one kind of task

Use conversational pointers, not barked commands. Prefer:

> For TypeScript conventions, see `docs/TYPESCRIPT.md`.

Over:

> ALWAYS READ `docs/TYPESCRIPT.md` BEFORE EDITING TYPESCRIPT.

## What to delete

Delete instructions that are:

- contradictory
- stale
- vague
- redundant with nearby text
- obvious no-ops like “write clean code”
- brittle file-location maps that will rot quickly

Prefer stable concepts over unstable paths. Domain language ages better than directory trivia.

## Staleness heuristics

Treat these as high-risk for poisoning context:

- exact file paths presented as enduring truth
- architecture summaries that drift faster than the docs are maintained
- duplicated instructions across root and nested files
- generated boilerplate nobody curates

If a structural detail changes often, replace it with a capability hint or remove it.

## Progressive disclosure rules

- Keep root small enough that loading it on every request feels cheap.
- Push details down into docs the agent can open on demand.
- Nest disclosure when useful: a language doc can point to a testing doc, which can point to runner-specific docs.
- Only inline material that almost every branch of work needs.

## Monorepo placement

At root, keep:

- monorepo purpose
- shared package manager/tooling
- navigation hints for package-level guidance

At package or directory level, keep:

- local purpose
- local stack
- local conventions
- links to narrower docs for that area

Do not overload any level. Agents see merged instruction layers.

## Refactor checklist

When fixing a bloated file:

1. Find contradictions.
2. Extract the root essentials.
3. Group the remainder into logical docs.
4. Introduce nested `AGENTS.md` files only when directory scope matters.
5. Delete no-ops, stale lines, and duplicated meaning.

## Symlink note

If tooling expects both `AGENTS.md` and `CLAUDE.md`, prefer one canonical file plus a symlink when practical so the instruction source stays unified.

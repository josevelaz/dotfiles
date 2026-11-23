---
name: agents-md
description: AGENTS.md and CLAUDE.md refactoring for minimal root guidance, progressive disclosure, and scope-correct agent instructions. Use when the user wants to create, rewrite, slim down, audit, split, or fix AGENTS.md or CLAUDE.md files, reduce agent-instruction bloat, or organize monorepo/package-level agent guidance.
---

# AGENTS.md

Build or refactor `AGENTS.md`/`CLAUDE.md` into a small root instruction layer with clear breadcrumbs to deeper guidance.

## Process

1. **Map the instruction surface**
   - Read the current `AGENTS.md`, `CLAUDE.md`, and any linked instruction docs.
   - If both `AGENTS.md` and `CLAUDE.md` exist, determine whether one should symlink to the other instead of drifting independently.
   - For monorepos, find nested `AGENTS.md` files before changing scope boundaries.
   - Completion criterion: every active agent-instruction file in scope is accounted for.

2. **Sort every instruction by where it belongs**
   - Keep in root only what is relevant to nearly every task:
     - one-sentence project description
     - package manager if non-default or easy to misuse
     - non-standard build, typecheck, or test commands
     - truly repo-wide rules
   - Move domain-specific guidance into separate markdown files.
   - Move package-specific guidance into nested `AGENTS.md` files when directory scope matters.
   - Flag no-ops, contradictions, stale filesystem facts, and vague slogans for deletion.
   - If two instructions conflict and the choice is not obvious, ask the user which one to keep.
   - Completion criterion: every original instruction is classified as keep, move, scope-lower, ask, or delete.

3. **Write the breadcrumb tree**
   - Rewrite the root `AGENTS.md` to be minimal and portable.
   - Use light-touch references such as “For TypeScript conventions, see `docs/TYPESCRIPT.md`”.
   - Prefer stable domain language and capabilities over brittle file-path maps.
   - Keep nested files focused on one domain or one directory scope.
   - Completion criterion: the root file is small, every moved rule has one authoritative home, and each pointer tells the agent when to follow it.

4. **Pressure-test for mud**
   - Check the result against [REFERENCE.md](REFERENCE.md).
   - Remove anything that the agent already knows by default, anything stale, and anything loaded at the wrong scope.
   - Completion criterion: the final structure has a minimal root, progressive disclosure for details, and no duplicated instruction source of truth.

## Output

- Update or create the relevant `AGENTS.md`/`CLAUDE.md` files.
- Create any disclosed reference files needed for conventions.
- Summarize:
  - what stayed in root
  - what moved elsewhere
  - what was deleted
  - any conflicts that still need user resolution

## Reference

See [REFERENCE.md](REFERENCE.md) for placement rules, anti-patterns, monorepo guidance, and rewrite heuristics.

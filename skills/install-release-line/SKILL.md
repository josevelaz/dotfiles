---
name: install-release-line
description: Install trunk-based GitHub and npm release-line machinery in a repository. Use when the user wants to set up releases, trusted publishing, or cut/draft/publish workflows.
---

# Install a release line

Install the bundled Release workflow so this GitHub-hosted npm package publishes from `main` through `release/vX.Y` lines. The workflow is the only publish path. It uses `GITHUB_TOKEN` and npm trusted publishing.

This machinery needs Bun, a `package.json` `name`, `bun run validate`, and a GitHub `origin`.

## 1. Inspect

Read the repo's agent instructions. Check `git status` and preserve unrelated work.

Record:

- `package.json` `name`, `version`, and scripts
- GitHub owner/repo from `origin`
- whether Bun is available (`bun --version`)
- whether `.github/workflows/release.yml` or `.github/scripts/release/` already exist
- whether `npm view <name> version` already returns a version

Stop if `origin` is not GitHub, Bun is missing, or `package.json` has no `name`.

**Done when:** those facts are written down, and either the install can proceed or the blocker is named.

## 2. Copy machinery

From the repository root:

```sh
node <skill-directory>/scripts/install.mjs
```

The script copies the workflow, CLI, tests, and maintainer doc. It refuses to replace existing destinations. Use `--force` only after reviewing the current files.

Merge `package.json` scripts so `bun run validate` still runs the project's tests and also typechecks `.github/scripts/release/tsconfig.json`. Keep unrelated scripts. Add `@types/bun` as a development dependency only if that tsconfig cannot typecheck without it.

**Done when:** `.github/workflows/release.yml`, `.github/scripts/release/src/main.ts`, `test/release/`, and `docs/releases.md` exist, and `bun run validate` plus `bun run pack:check` pass.

## 3. Wire GitHub and npm

Read [`GITHUB.md`](GITHUB.md) and apply every section that still fails its done check: the `release` environment, merge settings, Actions PR creation, compatible branch rules, bootstrap, and trusted publisher.

Use `gh` and `npm` for those steps. If a dashboard click remains, invoke **wizard** for that click only.

**Done when:** the environment GET matches the workflow guard, trusted publishing is bound to `release.yml` and environment `release`, and either the package exists on npm or the exact remaining bootstrap command is listed.

## 4. Report

State the package name, files copied, GitHub environment result, npm version or bootstrap remainder, and the first live operation (`cut` of an initial `X.Y.0` from `main`, dry-run first). Point at `docs/releases.md` for cut, backport, draft, and publish.

**Done when:** the user can dispatch `Release` from `main` without inventing a second publish path.

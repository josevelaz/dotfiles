---
name: setup-project
description: Set up a new TypeScript project with pnpm, Effect v4, agent guidance, anti-slop linting, pre-commit hooks, and npm release tooling.
disable-model-invocation: true
---

# Set up a project

Compose the existing setup skills; keep their procedures as the source of truth. This skill supplies the order, project defaults, and compatibility rules. Run it in the target project, not in the global skills directory.

## 1. Establish scope

Read the target's agent instructions and linked domain docs. Inspect its files, Git status, remotes, package manifests, lockfiles, hooks, CI, and existing setup. Treat an empty directory as a new project and an existing scaffold as work to preserve.

Ask only for unresolved choices: target directory, package name, project purpose, application versus publishable npm package, and GitHub owner/repository when publishing. Confirm before migrating an existing project from another package manager. Ask before creating a remote repository or changing remote settings. Create local Git metadata if needed for hooks, without making a commit.

Locate `setup-matt-pocock-skills`, `install-anti-slop`, `install-release-line`, and `agents-md` in the installed skills. Load each at its step. If a required skill is missing, report the missing dependency and ask to install it rather than inventing its procedure. If a skill is user-invoked-only, ask the user to invoke it and resume this workflow after it completes.

**Done when:** the target, package identity, project kind, migration permission, and available setup skills are known. Mark each later stage pending, already satisfied, or not applicable with a reason.

## 2. Establish pnpm and Effect

Use current official documentation for pnpm setup and the selected Effect version. Query the registry at execution time:

```sh
npm view pnpm version
npm view effect@4 version --json
npm view effect dist-tags --json
```

Use a current stable pnpm version compatible with the project's Node version. Record its exact version in `packageManager` as `pnpm@<version>`. Use pnpm for dependency changes and project commands; keep `pnpm-lock.yaml` as the project lockfile. On an approved migration, preserve dependency ranges, migrate CI and scripts, and remove old lockfiles only after the pnpm install succeeds.

Select Effect in this order:

1. If stable major-4 versions exist, install the highest stable `4.x.y` with `pnpm add effect@<version>`.
2. Otherwise, if the `rc` tag resolves to a major-4 release candidate, run `pnpm add effect@rc`.
3. If neither exists, or registry access fails, report the blocker. Treat a network failure separately from an absent version. Do not substitute v3, beta, or a future major.

Add Effect as a direct dependency before installing anti-slop so its Effect rules are selected. Use strict TypeScript and a compiler version supported by the selected Effect release. Add ecosystem packages only when the project needs them, using compatible v4 versions.

For an empty project, create the smallest TypeScript scaffold that typechecks an Effect import. Preserve an existing framework and entry point. Establish real `typecheck`, `lint`, and `validate` scripts; `validate` must run lint, typecheck, and any existing tests. Add a build script when the project needs emitted output. Add or change tests only when the user asks; report missing tests instead of adding a passing placeholder.

**Done when:** pnpm installs successfully, its exact version and lockfile are recorded, the installed Effect version matches the selection rule, and the scaffold typechecks.

## 3. Configure engineering skills

Invoke `setup-matt-pocock-skills`. Keep its findings, questions, draft approval, and instruction-file selection procedure. Reuse answers already supplied. Let it establish issue tracking, applicable triage labels, and domain-document guidance.

If user invocation or draft approval is needed, mark this stage pending and pause the workflow. Ask the user to invoke `@setup-matt-pocock-skills` when required; resume here after its approved output exists.

**Done when:** its approved files exist and their pointers resolve.

## 4. Install lint and formatting rules

Invoke `install-anti-slop` using pnpm. Include its generic rules and its Effect plugin because Effect is a direct dependency. Preserve its agent-tooling and vendored-plugin ignores across lint and formatting configuration.

Then read and apply [LINT-FORMAT.md](LINT-FORMAT.md) in full. It adds this setup's required built-in rules, strict maintainability limits, type-guard option, formatter defaults, and validation wiring. These additions belong to this skill; leave the global `install-anti-slop` skill unchanged.

**Done when:** both plugins and type-aware linting load, every rule and applicable formatting requirement in the reference is accounted for, and lint, format-check, and typecheck results are recorded. Fix findings in the scaffold created by this run; report findings in pre-existing source unless cleanup was requested.

## 5. Install pre-commit checks

Read the upstream procedure before editing hooks:

```sh
gh api repos/mattpocock/skills/contents/skills/misc/setup-pre-commit/SKILL.md --jq '.content' | base64 --decode
```

Source: <https://github.com/mattpocock/skills/blob/main/skills/misc/setup-pre-commit/SKILL.md>. If it cannot be read, report this stage as blocked instead of reconstructing it from memory.

Apply it with these integration rules:

- Use `pnpm add -D`, `pnpm exec`, and `pnpm run` in place of npm/npx equivalents. Merge existing hooks, lint-staged configuration, and `prepare` behavior.
- Use the formatter and ignores established in step 4 instead of installing the upstream Prettier default. Configure lint-staged to format supported staged files with that formatter only.
- Run staged-file formatting first, then `pnpm run validate`. This includes lint, format-check, typecheck, existing tests, and release checks added in the next stage. Commands must stop the hook on failure; use `&&` chaining or explicit exit checks.
- Omit missing test commands and report them. Do not create tests merely to satisfy the hook.
- Replace the upstream automatic commit step with validation. Run an index-mutating lint-staged smoke check only with explicit approval and when staged content belongs to this setup with no unrelated partial edits. Otherwise validate configuration and report the staged-file check as unverified. Stage files or create a commit only on explicit request.

**Done when:** the hook is executable, the prepare integration works, configuration resolves, and each configured check has a recorded result or an exact validation blocker. A lint-staged run with no staged files is not proof that formatting works.

## 6. Configure releases

For a publishable npm package, read [RELEASE-PNPM.md](RELEASE-PNPM.md), then invoke `install-release-line` with that adaptation. For an application or private package, mark npm releases not applicable; keep the package private.

**Done when:** applicable release installation and remote setup checks pass, or each remaining prerequisite has an exact next action. Publishing and live release dispatch require a separate explicit request.

## 7. Consolidate guidance and verify

Invoke `agents-md` last, after commands and tooling are settled. Preserve the engineering-skill pointers. Keep pnpm usage in root guidance; for release-enabled packages, state that Bun is only the release tooling runtime. Disclose release details through `docs/releases.md`.

Run `pnpm install --frozen-lockfile` and `pnpm run validate`. Confirm the final hook calls this validation script after staged formatting, CI includes lint and format-check, and editor settings use the chosen formatter. Run the full repository check when Vite+ is present. For release-enabled packages, also run the release tests, release typecheck, and package-content check specified in the release adaptation. Review all changed files and the final Git diff, including new files.

**Done when:** every stage is passed, not applicable with a reason, or blocked with a next action. Report files changed, exact installed versions, check results, unresolved findings, and remote/manual work. Claim complete setup only when all applicable stages pass. Leave commits and publication to an explicit user request.

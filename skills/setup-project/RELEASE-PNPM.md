# Release tooling with pnpm

Read this before running `install-release-line` for a publishable npm package. Its bundled CLI and tests require Bun; pnpm remains the project's package manager. Adapt only the target repository's copied files, not the global release skill.

## Prerequisites

Keep the release skill's GitHub-origin, package-name, Bun, and remote-configuration checks. Explain the Bun runtime requirement and obtain approval before installing a missing runtime. If Bun is unavailable or declined, mark releases blocked and continue independent local setup.

Read the installed release skill and `GITHUB.md` in full. Preserve the workflow's main-only guard, `release` environment, permissions, trusted publishing, and single publish path. Obtain approval for remote settings changes. Use its wizard path for manual dashboard work.

## Adapt the copied machinery

Inspect the actual bundle before editing; it can change between runs.

1. Keep Bun setup and Bun execution of the release CLI and `bun:test` suites. Keep Node/npm where the trusted-publishing workflow requires them.
2. Set up the project's pinned pnpm version in CI before dependency installation. Replace dependency installation with `pnpm install --frozen-lockfile` and workflow validation with `pnpm run validate`. Use current pnpm documentation for the setup action and cache order.
3. Install release-only development dependencies through pnpm. Ensure pnpm's strict dependency layout can resolve everything imported by the copied release tooling, including Bun types when needed.
4. Merge the release typecheck and bundled release tests into `validate`, preserving project checks. If the session's instructions require explicit approval to add tests, obtain it before running the installer, which copies a test suite. Do not rewrite the release runtime just to eliminate Bun.
5. Establish a real `pack:check` command if absent: build required artifacts, inspect an npm pack dry-run, and check the package entry points and intended contents. Keep release tooling, tests, and agent assets out of the published package. Use the release skill's existing check if it supplies one.
6. Update copied maintainer documentation to use pnpm for project install, validation, and pack-check commands. Keep Bun commands that execute the release runtime and npm commands used for registry operations or publishing.

## Verify

Run the frozen pnpm install, `pnpm run validate`, and `pnpm run pack:check`. Verify that validation actually executes the bundled release tests and release TypeScript check. If the installed release skill still requires its literal `bun run validate` and `bun run pack:check` checks, run those too; Bun acting as a script runner must not create a second lockfile.

Inspect the copied workflow and scripts for remaining Bun dependency-install commands or Bun lockfile assumptions. Confirm the pnpm setup precedes installation and all original release security checks remain intact.

Report local validation separately from GitHub environment and npm trusted-publisher verification. List the exact bootstrap command if the package does not yet exist. Do not publish or dispatch a live release during setup; present the first dry-run operation for the user to approve.

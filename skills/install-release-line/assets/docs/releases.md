---
title: Releases
description: Publish the npm package with the manual Release workflow.
---

# Releases

Releases use one manual `Release` workflow, a main-only `release` environment, immutable exact tags, and a movable major alias. There is no `semantic-release` path.

The maintainer starts each operation. Dry runs and explicit confirmation protect against unintended publication. `publish` also publishes the npm package with provenance.

## Trunk and tag policy

- All changes land on `main` first. `main` is the only source of new work.
- Release branches (`release/vX.Y`) receive only squash backports of commits that already exist on `main`.
- Never merge a release branch back into `main`. Fix forward on `main` and backport the fix.
- Never delete a published release or its tag. Correct a bad release by publishing a new patch version.
- Exact version tags (`X.Y.Z`, `X.Y.Z-rc.N`) are immutable. Once pushed, a tag keeps its target commit forever.
- The major alias tag (`X`) is movable. It points at the highest stable release of that major line.

Versions are canonical SemVer with no leading `v`: `1.0.0` or `1.0.0-rc.1`.

## One-time repository setup

1. Create a `release` environment with no required reviewers, administrator bypass disabled, and a sole custom deployment branch policy of `main`.
2. Dispatch Actions workflows from `main`.
3. Enable npm trusted publishing for this package: GitHub owner and repository matching the remote, workflow filename `release.yml`, environment `release`, permission `npm publish`. Do not store an `NPM_TOKEN`.
4. Enable auto-merge and squash merge. The `backport` operation opens squash-merge pull requests. Allow GitHub Actions to create pull requests, or open those PRs by hand.
5. Enable Immutable Releases so published release tags cannot be moved or deleted.
6. Keep validation workflows enabled. Release execution runs `bun run validate` before it plans mutations.
7. Keep branch rules compatible with workflow-created version commits and branch deletion. The workflow uses only `GITHUB_TOKEN`, with no bypass token.
8. Do not require another person's approval for a solo-maintained release process.
9. Do not create a ruleset that targets release tags or major aliases. The workflow moves only the major alias `X`.
10. Do not pre-create release branches or tags. The workflow creates every line it owns.

## Bootstrap the npm package once

Skip this if the package already exists. npm requires an existing package before it accepts a trusted publisher.

1. Sign in to npm, verify email, and enable account-level 2FA.
2. Run `npm login`, then `npm whoami`. Keep credentials out of the repository.
3. From a clean checkout, run `bun run validate` and `bun run pack:check`. Confirm `package.json` version is `0.0.0` and that version has never been published.
4. Publish under a non-default tag:

   ```sh
   npm publish --access public --tag bootstrap --provenance=false
   ```

   This permanently uses version `0.0.0`. The `bootstrap` tag avoids assigning it to `latest`.
5. Configure the GitHub Actions trusted publisher. With npm 11.15.0 or later:

   ```sh
   npm trust github <package-name> \
     --repo <owner>/<repo> \
     --file release.yml \
     --env release \
     --allow-publish
   ```

6. In npm publishing-access settings, require 2FA and disallow tokens. Then `npm logout`.

## Operations

Every operation accepts `dry_run`. A dry run plans the work, writes artifacts, and does not mutate repository or registry state. `dry_run` defaults to `true`. Always pass `--ref main`.

Each operation accepts only its own fields plus `dry_run`.

```bash
gh workflow run Release --ref main \
  -f operation=cut \
  -f version=0.1.0 \
  -f dry_run=true
```

Read the plan, then re-run with `-f dry_run=false`. Dispatch one operation at a time and wait for it.

| Operation | Required fields | Effect |
| --- | --- | --- |
| `cut` | `version` (patch `0`) | Creates `release/vX.Y` from `main`. |
| `backport` | `release_line`, `commits` | Cherry-picks main SHAs and opens a squash PR into the line. |
| `draft` | `release_line`, `version` | Versions the line, tags, and creates a draft GitHub Release. |
| `publish` | `version`, `confirmation='publish <version>'` | Publishes the GitHub draft, then npm with provenance. Moves major alias `X` for the highest stable of that major. RC uses npm dist-tag `next`. |
| `cancel` | `version`, `confirmation='cancel <version>'` | Deletes an unpublished draft and its exact tag. |
| `retire` | `release_line`, `confirmation='retire <release_line>'` | Deletes a release branch. Published tags stay. |
| `restore` | `release_line` | Recreates a retired line at its highest stable tag. |

If npm fails after the GitHub Release becomes public, the GitHub Release stays published and `publish` cannot simply be rerun because it requires a draft. Confirm npm setup before a live publish.

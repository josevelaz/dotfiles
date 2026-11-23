# GitHub and npm for a release line

Load this file when creating the `release` environment, configuring trusted publishing, bootstrapping `0.0.0`, or checking branch rules against the workflow.

Owner and repo come from `git remote get-url origin`. Fail closed if the remote is not GitHub.

## Release environment

The guard job requires all of:

- environment name `release`
- `can_admins_bypass == false`
- custom branch policy, not "protected branches"
- exactly one policy: branch `main`

Create or update:

```sh
gh api -X PUT "repos/<owner>/<repo>/environments/release" \
  --input - <<'JSON'
{
  "prevent_self_review": false,
  "wait_timer": 0,
  "reviewers": [],
  "can_admins_bypass": false,
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
```

Then set the sole branch policy to `main`. If another policy exists, delete it first:

```sh
gh api "repos/<owner>/<repo>/environments/release/deployment-branch-policies"
gh api -X POST "repos/<owner>/<repo>/environments/release/deployment-branch-policies" \
  -f name=main -f type=branch
```

**Done when:** those two `gh api` GETs match the guard checks in `.github/workflows/release.yml`.

## Repository merge settings

```sh
gh api -X PATCH "repos/<owner>/<repo>" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true
```

Backport opens a PR with `GITHUB_TOKEN`. That needs **Allow GitHub Actions to create and approve pull requests**:

```sh
gh api -X PUT "repos/<owner>/<repo>/actions/permissions/workflow" \
  -F default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=true
```

Leave `default_workflow_permissions` as `read`. The Release job still requests write where it needs it.

**Done when:** squash-only merge and auto-merge are on, and Actions can create PRs.

## Branch rules

Compatible rules:

- `main` may require PRs, linear history, no force-push, no deletion, and a `Validate` check.
- `release/v*` may block force-push and require linear history.
- `release/v*` must still accept direct pushes (version commits) and branch deletion (`retire`).
- No ruleset may target tags. The workflow force-updates major alias `X`.

**Done when:** listed rulesets exist or the user declined extra rules; no tag ruleset is present.

## Bootstrap and trusted publisher

If `npm view <name> version` fails, the package does not exist. Bootstrap `0.0.0` from a clean checkout after `bun run validate` and `bun run pack:check`:

```sh
npm whoami
npm publish --access public --tag bootstrap --provenance=false
```

Then bind trusted publishing (npm 11.15.0+):

```sh
npm trust github <name> \
  --repo <owner>/<repo> \
  --file release.yml \
  --env release \
  --allow-publish
```

If `npm trust` is unavailable, open the package's Trusted Publisher settings on npmjs.com and enter the same owner, repository, `release.yml`, and `release` environment.

If the package already exists, skip bootstrap and only bind the trusted publisher.

**Done when:** `npm view <name> version` succeeds, and the trusted publisher binding matches this repository and `release.yml`.

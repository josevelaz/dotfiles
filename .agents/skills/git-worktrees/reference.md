# Git Worktrees Reference

Use this file when the main skill instructions are not enough and you need extra command coverage or examples.

## Coding Task Default

When a task requires code changes in a Git repository, create or reuse a dedicated worktree before editing code.

- Preferred pattern: create a branch and worktree together.
- Reuse an existing task worktree when it clearly matches the task.
- Skip worktree creation only when the user explicitly tells you to work in the current checkout, or when the task is inspection-only / docs-only.

## Command Reference

### Create

```bash
# existing branch
git worktree add <path> <branch>

# new branch from HEAD
git worktree add -b <branch> <path>

# new branch from another start point
git worktree add -b <branch> <path> <start>

# track remote branch
git worktree add --track -b <branch> <path> origin/<branch>

# detached experiment
git worktree add --detach <path> <commit>
```

### Inspect

```bash
git worktree list
git worktree list -v
git worktree list --porcelain
```

### Remove and repair

```bash
git worktree remove <path>
git worktree remove --force <path>
git worktree move <old-path> <new-path>
git worktree lock <path>
git worktree unlock <path>
git worktree prune
git worktree repair
```

## Example Workflows

### Hotfix while feature work continues

```bash
repo_root="$(git rev-parse --show-toplevel)"
project="$(basename "$repo_root")"
worktree_base="$(dirname "$repo_root")/${project}.worktrees"
mkdir -p "$worktree_base"

git worktree add -b hotfix-456 "$worktree_base/hotfix-456" origin/main
```

After creation, run coding commands from `"$worktree_base/hotfix-456"`, not from the main checkout.

### PR review in isolation

```bash
git fetch origin pull/123/head:pr-123
git worktree add "$worktree_path" pr-123
```

### Detached experiment

```bash
git worktree add --detach "$worktree_path" HEAD~3
```

## Selective Change Movement Between Worktrees

```bash
# compare branches
git diff main..feature-branch -- path/to/file

# take one file from another branch
git checkout feature-branch -- path/to/file

# patch mode
git checkout -p feature-branch -- path/to/file

# modern restore alternative
git restore --source=feature-branch -- path/to/file
git restore -p --source=feature-branch -- path/to/file

# cherry-pick specific commits
git cherry-pick <commit>
git cherry-pick --no-commit <commit>

# merge without auto-commit
git merge --no-commit <branch>
```

## Troubleshooting

### Branch locked elsewhere

```bash
git worktree list
```

### Metadata out of sync

```bash
git worktree prune
git worktree repair
```

### Stable machine-readable output

```bash
git worktree list --porcelain
```

## Safety Rules

- Do not create nested worktrees inside another worktree.
- Do not remove worktrees with `rm -rf` unless you are deliberately cleaning up after a broken state and will immediately run `git worktree prune`.
- Do not assume a normal repo; always check `git rev-parse --is-bare-repository` first.
- Do not parse plain `git worktree list` output in scripts when `--porcelain` exists.
- Do not begin coding for a new task in the main checkout when a dedicated worktree should be created first.

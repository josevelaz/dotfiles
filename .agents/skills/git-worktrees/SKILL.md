---
name: git-worktrees
description: >
  Git worktree workflow and path policy for bare and non-bare repositories.
  Use when creating, listing, moving, locking, repairing, or removing
  worktrees; when deciding where a new worktree should live; or when a task
  mentions git worktree, bare repo, linked checkout, sibling checkout,
  parallel branches, or branch isolation. Covers `git rev-parse
  --is-bare-repository`, `git worktree add`, and the default
  `../<project>.worktrees/**` layout for normal repos.
user-invocable: false
---

# Git Worktrees

Use this skill when you need to create or manage Git worktrees, especially when the correct destination path depends on whether the repository is bare or non-bare.

Also use it before starting coding tasks in a Git repository unless you are already in the correct dedicated worktree for that task.

## Core Rule

Always detect the repo shape first.

```bash
git rev-parse --is-bare-repository
```

- `false` → normal repo with a main working tree
- `true` → bare repo with no main working tree

Do not guess. Path policy depends on this result.

## Coding Task Rule

Before making code changes for a new task in a Git repository, create a dedicated worktree for that task and do the implementation there.

- Do not start coding in the main checkout when a separate task worktree should be created.
- If the task already has a dedicated worktree and you are in it, reuse it.
- If the user explicitly asks to work in the current checkout instead of a worktree, follow the user's instruction.
- Documentation-only or inspection-only tasks do not require creating a worktree unless the user asks for one.

## Required Decision Flow

1. Confirm you are inside a Git repository.
2. Detect whether it is bare.
3. If the task involves code changes, check whether you are already in the correct dedicated worktree.
4. List existing worktrees before creating a new one.
5. Choose the destination path using the policy below.
6. Create the worktree with `git worktree add`.
7. Perform the coding task inside that worktree.
8. Remove worktrees with `git worktree remove`, never `rm -rf`.

## Repo Detection Commands

Use these commands in this order when you need full context:

```bash
# Fails if not in a git repo
git rev-parse --show-toplevel

# Stable bare/non-bare check
git rev-parse --is-bare-repository

# Shared git dir / common dir details
git rev-parse --absolute-git-dir
git rev-parse --git-common-dir

# Inspect existing worktrees before acting
git worktree list --porcelain
```

Notes:

- In a normal repo, `git rev-parse --show-toplevel` gives the main worktree root.
- In a bare repo, `git rev-parse --show-toplevel` may fail because there is no checked-out worktree. Use `git rev-parse --absolute-git-dir` instead.
- For automation, prefer `git worktree list --porcelain` over parsing human-readable output.

## Default Path Policy

### 1) Normal Repo

If `git rev-parse --is-bare-repository` returns `false`:

- Let `repo_root` be `git rev-parse --show-toplevel`
- Let `project` be `basename "$repo_root"`
- Create worktrees under:

```text
../<project>.worktrees/**
```

Canonical shell pattern:

```bash
repo_root="$(git rev-parse --show-toplevel)"
project="$(basename "$repo_root")"
worktree_base="$(dirname "$repo_root")/${project}.worktrees"
mkdir -p "$worktree_base"

# Example name: feature-login
worktree_path="$worktree_base/feature-login"
```

Example:

```text
/code/myapp                 # main repo
/code/myapp.worktrees/      # linked worktrees container
/code/myapp.worktrees/fix-123
/code/myapp.worktrees/review-pr-44
```

This keeps linked worktrees out of the main repo tree and makes cleanup predictable.

### 2) Bare Repo

If `git rev-parse --is-bare-repository` returns `true`:

- There is no main checked-out worktree.
- Create new worktrees in the same parent directory namespace as the bare repo, not inside a `../<project>.worktrees` container unless you intentionally want one.
- In practice, place the linked worktree next to the bare repo directory.

Canonical shell pattern:

```bash
git_dir="$(git rev-parse --absolute-git-dir)"
repo_parent="$(dirname "$git_dir")"

# Example name: feature-login
worktree_path="$repo_parent/feature-login"
```

Example:

```text
/srv/repos/myapp.git        # bare repo
/srv/repos/feature-login    # linked worktree
/srv/repos/review-pr-44     # linked worktree
```

Important: do not try to create a worktree inside Git metadata directories such as `objects/`, `refs/`, or `.git/worktrees/`.

## Creation Patterns

For coding tasks, prefer `git worktree add -b <branch> "$worktree_path" <start-point>` so the task gets an isolated branch and checkout in one step.

### Existing Branch

```bash
git worktree add "$worktree_path" <branch>
```

### New Branch from Current HEAD

```bash
git worktree add -b <branch> "$worktree_path"
```

### New Branch from Specific Start Point

```bash
git worktree add -b <branch> "$worktree_path" <start-point>
```

### Detached Experiment

```bash
git worktree add --detach "$worktree_path" <commit-ish>
```

Use `--detach` for short-lived experiments so you do not create junk branches.

## Standard Creation Checklist

Before adding a worktree:

```bash
git worktree list --porcelain
```

Check for:

- branch already checked out elsewhere
- path collisions
- stale worktree metadata
- whether the task already has a suitable existing worktree

Then create the worktree:

```bash
git worktree add -b <branch> "$worktree_path" <start-point>
```

Then switch execution context to that worktree before editing files or running task-specific coding commands.

After creation, verify:

```bash
git -C "$worktree_path" status
git -C "$worktree_path" branch --show-current
git worktree list
```

## Safe Removal and Cleanup

Preferred removal:

```bash
git worktree remove "$worktree_path"
```

Force removal only when you intentionally want to discard local changes:

```bash
git worktree remove --force "$worktree_path"
```

If someone manually deleted the directory and metadata is stale:

```bash
git worktree prune
```

If directories were moved incorrectly:

```bash
git worktree repair
```

Never use `rm -rf` as the normal removal path.

## Common Problems

### “branch is already checked out”

Another worktree already has that branch.

```bash
git worktree list
```

Either use that worktree, remove it, or create a different branch.

### Worktree directory was deleted manually

```bash
git worktree prune
```

### Worktree was moved manually

```bash
git worktree repair
```

### Need scripting-safe output

```bash
git worktree list --porcelain
```

## Recommended Naming

Use descriptive names derived from purpose or branch:

- `feature-login`
- `fix-123`
- `review-pr-44`
- `experiment-auth-flow`

For normal repos this yields:

```text
../<project>.worktrees/feature-login
```

For bare repos this yields a sibling path such as:

```text
<repo-parent>/feature-login
```

## Best Practices

- One worktree per active branch.
- One dedicated worktree per active coding task unless you are intentionally continuing work in an existing task worktree.
- Switch context by changing directories, not by repeatedly checking out branches.
- List worktrees before creating or removing one.
- Commit or stash before removal.
- Use `--detach` for throwaway experiments.
- Use `git worktree lock` for long-lived or removable-storage worktrees.
- Use `git worktree move` instead of moving directories manually.

## Quick Commands

```bash
# Detect repo type
git rev-parse --is-bare-repository

# List worktrees
git worktree list --porcelain

# Create a new branch + worktree
git worktree add -b <branch> "$worktree_path" <start-point>

# Remove a worktree
git worktree remove "$worktree_path"

# Clean stale metadata
git worktree prune

# Repair broken links
git worktree repair
```

## Verification

When you are done, verify all of the following:

- repo type was checked explicitly
- destination path matches the bare/non-bare policy
- `git worktree list` shows the new worktree
- the target branch or detached HEAD is what you intended
- cleanup uses `git worktree remove`, not manual deletion

## Related Files

- `reference.md` — extended command reference and workflow examples

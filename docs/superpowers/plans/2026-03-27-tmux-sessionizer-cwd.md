# Tmux Sessionizer Cwd Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure newly created tmux sessions, windows, and panes start in the selected workspace instead of falling back to `~`.

**Architecture:** Keep one canonical resolved workspace path after selection normalization and route all creation paths through it. Extend the shell test stub so window and pane creation record the cwd passed by the script, then assert the new behavior.

**Tech Stack:** Bash, tmux CLI, shell test harness in `tests/tmux-sessionizer_test.sh`

---

## Chunk 1: Wire the selected cwd through creation paths

### Task 1: Normalize and reuse selected cwd

**Files:**
- Modify: `.local/bin/tmux-sessionizer`

- [ ] Add a dedicated variable for the resolved selected path after `~` expansion.
- [ ] Use that variable when creating new tmux sessions.
- [ ] Use that variable when creating command windows and split panes instead of relying on `$(pwd)` or implicit tmux defaults.

## Chunk 2: Lock the behavior with regression tests

### Task 2: Extend the shell test harness

**Files:**
- Modify: `tests/tmux-sessionizer_test.sh`

- [ ] Update the tmux stub to record `-c` arguments for `neww` and `split-window`.
- [ ] Add a regression test for command windows created with `-s/--session`.
- [ ] Add a regression test for split panes created with `-s/--session --vsplit` or `--hsplit`.
- [ ] Run `tests/tmux-sessionizer_test.sh` and confirm all checks pass.

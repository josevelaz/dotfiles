# Tmux Status Session Compaction Design

## Goal

Keep the tmux status line readable when many sessions are open or when session names are long.

## Approved Output

When more than one tmux session exists, the status line should render the current session name followed by a compact count of the remaining sessions in this format:

`action-canine-training [+3 sessions]`

When only one session exists, the status line should render only the current session name.

When exactly one additional session exists, the suffix should be singular:

`action-canine-training [+1 session]`

## Proposed Change

Replace the unbounded `#(tms sessions)` segment in `status-right` with a compact command that prints:

- the active tmux session name
- an optional ` [+N sessions]` suffix when additional sessions exist

The final `status-right` segment order remains:

- zoom indicator
- copy-mode indicator
- pane/window id
- compact session summary
- date and time

## Implementation Notes

- Add a small shell helper alongside dotfiles scripts to compute the session summary from tmux.
- Pass the current session name into the helper from tmux format expansion, so the helper does not need to infer client context on its own.
- Use tmux format expansion in `status-right` so the command receives the current session name for the active client.
- Use `tmux list-sessions` to count the total number of sessions.
- Derive `N` as `total_sessions - 1`.
- Print nothing extra when `N <= 0`.
- Print `[+1 session]` when `N = 1`, otherwise print `[+N sessions]`.

## Error Handling

- If tmux session inspection fails, fall back to printing only the current session name when available.
- If both operations fail, print an empty string so the status line does not break.

## Testing

- Reload tmux config with `tmux source-file ~/.tmux.conf`.
- Verify rendering with one session.
- Verify rendering with several sessions.
- Verify rendering with a long session name.
- Verify the right side still preserves pane/window and clock information.

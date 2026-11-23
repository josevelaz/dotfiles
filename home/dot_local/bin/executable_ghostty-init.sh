#!/bin/zsh
# ghostty-init.sh — macOS/Ghostty startup helper.
# Invoked by Ghostty as its shell command to create or attach a tmux session.
# .config/ghostty/ is excluded from ubuntu/server profile stowing, so this
# script is only ever called on macOS where Ghostty is installed.
#
# Handles both Apple Silicon (/opt/homebrew) and Intel (/usr/local) Homebrew
# so tmux is findable before zsh login profiles have run.

for _brew_prefix in /opt/homebrew /usr/local; do
  if [[ -d "$_brew_prefix/bin" && ":$PATH:" != *":$_brew_prefix/bin:"* ]]; then
    export PATH="$_brew_prefix/bin:$PATH"
  fi
done
unset _brew_prefix

SESSION_NAME="default"

# Attach to existing session or create a new one.
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux attach-session -t "$SESSION_NAME"
else
  tmux new-session -s "$SESSION_NAME" -d
  tmux attach-session -t "$SESSION_NAME"
fi

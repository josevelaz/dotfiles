# macOS Local Setup Guide

Guide for (re-)applying this dotfiles repo on your local macOS machine after the shared config has been refactored for cross-platform portability.

---

## 1. Apply the macOS profile

Run the bootstrap helper with the `macos` profile. Dry-run first:

```bash
bash ~/dotfiles/.local/bin/stow-dotfiles.sh -n --profile macos
```

If the preview looks correct (desktop config included), apply:

```bash
bash ~/dotfiles/.local/bin/stow-dotfiles.sh --profile macos
```

The `macos` profile stows everything including:
- `.config/ghostty` — Ghostty terminal config
- `.config/sketchybar` — status bar
- `.config/yabai` — window manager
- `.config/skhd` — keyboard shortcuts
- `.config/karabiner` — keyboard remapper

---

## 2. Machine-local overrides

Several config pieces are intentionally NOT in the shared repo. Set them up locally after stowing.

### Shell overrides

```bash
cp ~/.config/zsh/local.example.zsh ~/.config/zsh/local.zsh
```

Edit `~/.config/zsh/local.zsh` to add machine-specific values:

```zsh
# Example overrides
export PROJECTS="$HOME/projects"
export GITHUB_TOKEN="ghp_..."
```

### Secrets

`~/.zsh_secrets.sh` is tracked in the repo but gitignored from diffs. Keep secrets there:

```bash
# Already present from stowing; edit in place
vim ~/.zsh_secrets.sh
```

### OpenCode local plugins

The `annotate-plan.ts` plugin and `opencode-annotator.nvim` require local project checkouts and are **not loaded by the shared config**. To re-enable on macOS:

1. Ensure `~/projects/opencode-plan-anotator/` is checked out and built.
2. Add the plugin back to your stowed `~/.config/opencode/opencode.jsonc`:
   ```jsonc
   "plugin": [
     // ... existing shared plugins ...
     "file://~/.config/opencode/plugin/annotate-plan.ts"
   ]
   ```
   See `.config/opencode/opencode.local.example.jsonc` for the full template.
3. For Neovim, the `opencode-annotator.lua` plugin now loads conditionally — it activates automatically when `~/projects/opencode-annotator.nvim/nvim/` exists.

---

## 3. Reload tmux plugins

If `.tmux.conf` changed (especially the clipboard binding), reload tmux plugins:

```bash
# Inside a tmux session:
prefix + I    # (Ctrl+A, then Shift+I) — installs/updates all plugins
```

The clipboard binding now uses `~/.local/bin/tmux-copy` which tries `pbcopy` first on macOS (no change in behavior), then falls back through Wayland → X11 → OSC 52.

---

## 4. Ghostty startup flow

Ghostty is configured with `command = /bin/zsh -lc "~/.local/bin/ghostty-init.sh"`. The init script:
1. Adds Homebrew to PATH (handles both Apple Silicon and Intel)
2. Creates or attaches a `default` tmux session

This is unchanged from before. The script is now documented as macOS-only and excluded from Ubuntu/server stow.

---

## 5. Verify macOS workflow

```bash
# Shell parses without error
zsh -n ~/.zshrc

# Platform file loads
zsh -c "source ~/.zshrc && echo 'shell ok'"

# tmux config loads
tmux -L mac-check start-server \; source-file ~/.tmux.conf \; kill-server

# Clipboard: yank works via pbcopy
echo "test" | ~/.local/bin/tmux-copy && pbpaste
```

---

## Recommended workflow: local → VPS

```
Ghostty (local macOS)
  └─ ghostty-init.sh → tmux default session (local)
       └─ pane: local tasks / file management
       └─ pane: ssh user@vps
              └─ tmux main session (remote)
                   └─ tmux-sessionizer → ~/projects/<name>
                        └─ nvim / opencode / dev tools
```

Clipboard round-trip:
1. Yank text in remote tmux (`y` in copy-mode)
2. `tmux-copy` emits an OSC 52 sequence
3. Ghostty intercepts it and writes to macOS pasteboard
4. `Cmd+V` works locally

---

## AI-agent prompt: macOS local adjustments

Paste into a terminal-capable AI agent:

```text
You are on macOS with terminal access. Re-apply the portable dotfiles setup while preserving desktop-specific local behavior.

Tasks:
1. Inspect the repo's bootstrap/profile flow: bash ~/dotfiles/.local/bin/stow-dotfiles.sh --help
2. Run the bootstrap helper in dry-run mode: bash ~/dotfiles/.local/bin/stow-dotfiles.sh -n --profile macos
3. Apply the macos profile if the dry-run preserves the expected desktop config: bash ~/dotfiles/.local/bin/stow-dotfiles.sh --profile macos
4. Copy the local shell override example if ~/.config/zsh/local.zsh does not exist: cp ~/.config/zsh/local.example.zsh ~/.config/zsh/local.zsh
5. Reload or reinstall tmux plugins if the tmux clipboard integration changed (prefix + I inside tmux).
6. Verify: run zsh -n ~/.zshrc; echo test | ~/.local/bin/tmux-copy && pbpaste
7. Summarize whether the local macOS workflow still supports: Ghostty → local tmux → SSH → remote tmux.

Constraints:
- Preserve the current macOS desktop workflow.
- Do not promote workstation-only secrets or plugin paths back into shared config.
- If required repo changes are not yet implemented, stop and report the exact blockers.
```

---

## AI-agent prompt: validate remote workflow

Paste into a terminal-capable AI agent after both macOS and VPS are bootstrapped:

```text
You are validating the local-to-VPS development workflow after bootstrap is complete.

Tasks:
1. From the local machine, SSH into the Ubuntu VPS.
2. Attach to or create a tmux session: tmux attach -t main || tmux new -s main
3. Run tmux-sessionizer and confirm it can open ~/dotfiles plus at least one project under ~/projects.
4. Open Neovim and confirm shared config loads without hardcoded macOS path errors: nvim --headless +checkhealth +q 2>&1 | grep -i error | head -10
5. In tmux copy-mode, yank some text and verify the clipboard path works. Note whether it used OSC 52 or a local clipboard tool.
6. Record any mismatch between docs and reality (bootstrap profiles, local overrides, tmux plugins, clipboard behavior).

Deliverable:
- A short pass/fail report with exact commands run, observed behavior, and any platform caveats.
```

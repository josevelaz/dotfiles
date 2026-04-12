# Ubuntu VPS Setup Guide

Complete guide for bootstrapping this dotfiles repo on a fresh Ubuntu VPS and adopting the recommended local-macOS → SSH → remote-tmux development workflow.

---

## 1. Prerequisites

Install baseline packages before cloning:

```bash
sudo apt-get update && sudo apt-get install -y \
  git zsh tmux stow fzf ripgrep fd-find curl unzip neovim zoxide
```

> `fd-find` installs as `fdfind` on Ubuntu/Debian. The `linux.zsh` platform file aliases it to `fd` automatically.

---

## 2. Clone the dotfiles repo

```bash
git clone https://github.com/josevelaz/dotfiles.git ~/dotfiles
```

Convention: the repo lives at `~/dotfiles`. The stow script derives its own path dynamically, so a different location works too — just adjust accordingly.

---

## 3. Install antidote (zsh plugin manager)

antidote is not in apt. Install it manually:

```bash
git clone --depth=1 https://github.com/mattmc3/antidote.git ~/.antidote
```

The `.zshrc` will automatically detect and load antidote from `~/.antidote/antidote.zsh`.

---

## 4. Stow dotfiles with the ubuntu profile

Run the bootstrap helper in **dry-run mode first** to see what would change:

```bash
bash ~/dotfiles/.local/bin/stow-dotfiles.sh -n --profile ubuntu
```

Review the output. If it looks correct (macOS-only dirs like `ghostty`, `sketchybar`, `yabai`, `skhd`, `karabiner` are absent), apply for real:

```bash
bash ~/dotfiles/.local/bin/stow-dotfiles.sh --profile ubuntu
```

The `ubuntu` profile automatically excludes:
- `.config/ghostty`
- `.config/sketchybar`
- `.config/yabai`
- `.config/skhd`
- `.config/karabiner`

---

## 5. Set zsh as the login shell

```bash
chsh -s $(which zsh)
```

Start a new shell session or run `zsh` to continue.

---

## 6. Install tmux plugins

tmux uses TPM (tmux Plugin Manager). On first use:

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

Start tmux, then press `prefix + I` (capital I) to install all plugins listed in `.tmux.conf`.

> `prefix` is `C-a` (Ctrl+A) in this config.

---

## 7. Create machine-local overrides (optional)

Two optional local override files are gitignored and never committed:

**Shell overrides** — copy the example and customise:

```bash
cp ~/.config/zsh/local.example.zsh ~/.config/zsh/local.zsh
# Edit ~/.config/zsh/local.zsh to set machine-specific values:
#   export PROJECTS="$HOME/my-projects"
#   export GITHUB_TOKEN="..."
```

**Secrets** — if you need machine-local secrets/tokens in your shell:

```bash
touch ~/.zsh_secrets.sh
chmod 600 ~/.zsh_secrets.sh
# Add exports to ~/.zsh_secrets.sh — sourced automatically if present
```

---

## 8. Validate the environment

```bash
# Shell parses without error
zsh -n ~/.zshrc

# tmux config loads
tmux -L vps-check start-server \; source-file ~/.tmux.conf \; kill-server

# tmux-sessionizer launches and shows project dirs
~/.local/bin/tmux-sessionizer --list 2>/dev/null || echo "Start tmux first, then run: tmux-sessionizer"

# Neovim opens without path errors
nvim --headless +q 2>&1 | head -5
```

---

## 9. Recommended remote development workflow

```
Local macOS terminal (Ghostty)
  └─ optional: local tmux session for local tasks
  └─ ssh user@vps
       └─ tmux attach -t main  (or: tmux new -s main)
            └─ tmux-sessionizer  →  opens ~/dotfiles, ~/projects/<name>, etc.
                 └─ nvim / opencode / dev tools run here
```

**Step by step:**

1. Open Ghostty on your local machine. It auto-creates/attaches a local tmux session via `ghostty-init.sh`.
2. In a new local tmux window/pane, SSH into the VPS:
   ```bash
   ssh user@your-vps-ip
   ```
3. Attach or create a remote tmux session:
   ```bash
   tmux attach -t main || tmux new -s main
   ```
4. Inside remote tmux, open tmux-sessionizer:
   ```
   prefix + f    (Ctrl+A, then f)
   ```
   Select a project root (`~/projects/<name>` or `~/dotfiles`).
5. Edit, run, and debug entirely on the VPS. All tools run where your code is.
6. **Clipboard**: `y` in tmux copy-mode calls `~/.local/bin/tmux-copy`, which:
   - On macOS: uses `pbcopy`
   - On Linux desktop with Wayland/X11: uses `wl-copy` / `xclip`
   - **On VPS over SSH**: emits an OSC 52 escape sequence that your local terminal intercepts and writes to your system clipboard. Requires a terminal that supports OSC 52 (Ghostty ✓, WezTerm ✓, kitty ✓, iTerm2 ≥ 3.x ✓).

---

## Mutagen sync (optional — for local-edit + remote-execute workflows)

If you want to edit locally on macOS but run everything on the VPS, use [Mutagen](https://mutagen.io/) to sync these two roots:

- `~/dotfiles`
- `~/projects` (excluding all `node_modules` directories)

### Exact setup for your workflow

Replace `user@vps` with your SSH target:

```bash
# Sync the dotfiles repo itself
mutagen sync create \
  --name dotfiles \
  --ignore-vcs \
  --ignore ".weave/learnings" \
  ~/dotfiles user@vps:~/dotfiles

# Sync the full projects tree, excluding node_modules anywhere under it
mutagen sync create \
  --name projects \
  --ignore-vcs \
  --ignore "node_modules" \
  ~/projects user@vps:~/projects
```

`node_modules` is a leaf-name ignore, so Mutagen will exclude any directory with that name anywhere under `~/projects`, not just `~/projects/node_modules`.

Useful follow-up commands:

```bash
# List sessions
mutagen sync list

# Watch status live
mutagen sync monitor

# Pause/resume if needed
mutagen sync pause dotfiles projects
mutagen sync resume dotfiles projects

# Tear down and recreate later
mutagen sync terminate dotfiles projects
```

### What to sync

| Path | Sync? | Reason |
|------|-------|--------|
| `~/dotfiles` | ✅ Yes | Keep shell/tmux/nvim config in sync |
| `~/projects` | ✅ Yes | Sync your whole working tree to the VPS |

### What NOT to sync

| Path | Reason |
|------|--------|
| `~/.cache`, `~/Library` | Machine-local, high-churn, platform-specific |
| `node_modules`, `.next`, `dist`, `build` | Generated artifacts; install on VPS instead |
| `~/.tmux`, tmux resurrect state | Machine-local session state |
| `~/.config/ghostty`, `~/.config/sketchybar`, `~/.config/yabai`, `~/.config/skhd`, `~/.config/karabiner` | macOS desktop-only |
| `~/.config/opencode/plugin` | Local plugin checkouts |
| `.env*`, `.zsh_secrets.sh`, SSH keys | Secrets — never sync |
| `~/.npm`, `~/.pnpm-store`, `~/.cargo`, `~/.rustup`, `~/.venv` | Package caches — install on VPS independently |

### Optional global Mutagen defaults

If you want these exclusions available by default for future sessions, add them to `~/.mutagen.yml`:

```yaml
sync:
  defaults:
    ignore:
      vcs: true
      paths:
        - "node_modules"
        - ".next"
        - "dist"
        - "build"
        - ".turbo"
        - ".pytest_cache"
        - ".mypy_cache"
        - "*.swp"
        - ".DS_Store"
```

For your requested setup, the two `mutagen sync create` commands above are sufficient even without a global config file.

---

## AI-agent bootstrap prompt

Paste the following into a terminal-capable AI agent to automate this setup:

```text
You are on an Ubuntu VPS with terminal access. Prepare this machine for the portable dotfiles workflow without introducing macOS-only config.

Tasks:
1. Ensure these packages are installed via apt: git, zsh, tmux, stow, fzf, zoxide, ripgrep, fd-find, curl, unzip, neovim.
2. Install antidote zsh plugin manager: git clone --depth=1 https://github.com/mattmc3/antidote.git ~/.antidote
3. Clone or update the dotfiles repo into ~/dotfiles.
4. Run the bootstrap helper in dry-run mode: bash ~/dotfiles/.local/bin/stow-dotfiles.sh -n --profile ubuntu
5. Review the dry-run output to confirm macOS-only dirs (ghostty, sketchybar, yabai, skhd, karabiner) are excluded, then apply: bash ~/dotfiles/.local/bin/stow-dotfiles.sh --profile ubuntu
6. Install tmux plugin manager: git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
7. Switch the login shell to zsh: chsh -s $(which zsh)
8. Validate: run zsh -n ~/.zshrc, then tmux -L check start-server \; source-file ~/.tmux.conf \; kill-server

Constraints:
- Keep macOS-only config out of the Ubuntu setup.
- Do not modify application source code; only perform environment/bootstrap work.
- If the repo is not yet implementation-ready, stop after documenting exactly what is missing.
```

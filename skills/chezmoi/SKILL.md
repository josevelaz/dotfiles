---
name: chezmoi
description: Dotfiles edits through chezmoi. Use when changing, adding, or removing any config under ~ (shell, editor, OpenCode, terminal, skills, scheduled jobs), making a config OS-specific, or when dotfiles sync fails.
---

# chezmoi

One repo, `josevelaz/dotfiles`, holds every config, checked out at `~/.local/share/chezmoi` on each machine. That checkout is the **source**; chezmoi writes it to `~`, the **target**. Only `home/` is source (see `.chezmoiroot`); files at the repo root never reach `~`.

**A save is a deploy.** `dotfiles-sync` runs on every machine. Seconds after a managed target or anything in the repo changes, it commits `chore(sync): <host>: …`, pushes, and tells the peers in `home/.chezmoidata/sync.toml` to pull and apply. Every machine gets each save, half-finished ones included. Pause it for multi-step changes (see [Pause sync](#pause-sync)).

## Edit a config

1. **Locate the source**: `chezmoi source-path <target>`. `not managed` means a new file: go to step 4.
2. **Template** (source ends in `.tmpl`): change the source and apply, with `chezmoi edit --apply <target>` or by editing the file under `home/` and running `chezmoi apply <target>`. The target is generated: an edit there stays on this machine and blocks its next apply.
3. **Plain file**: edit the target or the source. The daemon carries either.
4. **New file**: `chezmoi add <target>`. The daemon carries only what chezmoi already manages. Add `--template` when the file needs the home path or an OS branch.
5. **Same everywhere**: write one file for every machine, with `{{ .chezmoi.homeDir }}` for the home path. Branch only for macOS-only software or an OS mechanism (launchd vs systemd, Omarchy theme following): `{{ if eq .chezmoi.os "darwin" }}` in a template, or a path in the matching block of `home/.chezmoiignore`. `linux` means both the Omarchy desktop and the headless Ubuntu server.
6. **Check**: read `chezmoi diff`, then run the app's own config check (`fish -n`, `ghostty +validate-config`, a headless `nvim` start, `opencode mcp list`).

Done when `chezmoi status` prints nothing on this machine, the sync log shows `pushed true`, and `chezmoi status` prints nothing on every other machine.

## Remove a config

Removing the source stops management and leaves the target on every machine. `chezmoi destroy <target>` removes source and target here; delete the target on each other machine yourself. Stop a service or agent before you delete its unit.

## Skills

Skills sit outside chezmoi's copies. `~/.agents` links to the repo's `.agents/`, so skills.sh installs land there, tracked by `.agents/.skill-lock.json`. Personal skills live in `skills/<name>/`. `sync-skills` links each one into `.agents/skills/` and into every agent harness. Create and edit personal skills in `skills/`; sync carries them.

## Pause sync

Pause for a multi-step change or to commit with your own Conventional Commits message:

- Linux: `systemctl --user stop dotfiles-sync`, then `systemctl --user start dotfiles-sync`.
- macOS: `launchctl bootout gui/$(id -u)/com.jose.dotfiles.sync`, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jose.dotfiles.sync.plist`.

Commit and push in `~/.local/share/chezmoi`, then start it again. On start it syncs at once and the peers catch up.

## Reference

Read [REFERENCE.md](REFERENCE.md) for secrets (1Password), launchd or systemd jobs, adding a machine, or when sync or apply fails.

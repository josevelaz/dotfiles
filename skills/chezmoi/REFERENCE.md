# chezmoi reference

The branches of [`SKILL.md`](SKILL.md) that only some edits reach.

## Secrets

Values come from 1Password at apply time and never enter the repo. A `private_*.tmpl` source renders them with `{{ onepasswordRead $ref }}`. The `op://vault/item/field` reference lives per machine in `~/.config/chezmoi/chezmoi.toml`, asked once by `promptStringOnce` in `home/.chezmoi.toml.tmpl`. The model is `home/dot_config/fish/conf.d/private_secrets.fish.tmpl`.

After adding a prompt, run `chezmoi init` on each machine. `op` must be signed in before `chezmoi apply`.

## Scheduled jobs

A job has one scheduler per OS:

- macOS: a LaunchAgent, `home/private_Library/LaunchAgents/com.jose.dotfiles.<name>.plist.tmpl`.
- Linux: a systemd user unit pair, `home/dot_config/systemd/user/<name>.{service,timer}`.

The scripts in `home/.chezmoiscripts/` reload them, and run only when their rendered text changes. The macOS script finds every plist by glob. The Linux script lists each unit by hash: add a `# <unit> {{ include "<source path>" | sha256sum }}` line and an `enable` line for each new unit. A LaunchAgent disabled with `launchctl disable` stays unloaded.

To retire a job, unload it on each machine (`launchctl bootout`, or `systemctl --user disable --now`), then remove its source and target.

## Add a machine

1. Join the tailnet. Add the machine's MagicDNS name to `peers` in `home/.chezmoidata/sync.toml`.
2. Install chezmoi, git, mise and fish, and give it an SSH key that GitHub accepts. On Ubuntu, add Docker's and Tailscale's apt repositories and install both; `ubuntu.txt` leaves them out because they need those repositories.
3. Run `chezmoi init --apply git@github.com:josevelaz/dotfiles.git`. It asks for the 1Password reference, installs the mise tools, and starts `dotfiles-sync` and `sync-skills`.
4. Run `dotfiles-packages` for the packages that need sudo.
5. On macOS, set OrbStack up without an admin password: `orbctl config set setup.use_admin false`, then `orbctl start`. It links `docker` and its plugins into `~/.orbstack/bin`.

Done when `chezmoi status` prints nothing and the sync log shows `listening on 100.x.x.x:7357`.

## When sync or apply fails

Logs: `journalctl --user -u dotfiles-sync` on Linux, `~/Library/Logs/dotfiles-sync.log` on macOS. Failures also raise a desktop notification.

- **`git pull --rebase failed`**: two machines changed the same file. In `~/.local/share/chezmoi`, run `git pull --rebase`, resolve, push. The daemon resumes on the next change.
- **`apply needs you`** or **`has changed since chezmoi last wrote it`**: a template's target was edited in place. Read `chezmoi diff <target>`, move the wanted change into the source, then `chezmoi apply --force <target>`.
- **`<peer> unreachable`**: the peer was asleep or offline. It catches up at its next start or within 30 minutes.

The daemon is `home/dot_local/lib/dotfiles-sync/sync.ts`. It restarts itself when that file changes.

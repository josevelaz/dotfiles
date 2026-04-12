# Learnings: Ubuntu VPS Seamless Dev

## Task 1: OS-aware shell bootstrap
- **Discrepancy**: `.zsh_secrets.sh` is tracked by git (listed in `.gitignore` but already committed), so it will be present on fresh clones. However, making the source optional is still the right call since stow may not symlink it in all flows.
- **Resolution**: Used `[[ -f ~/.zsh_secrets.sh ]] && source` guard. Works whether file exists or not.
- **Discrepancy**: `.zsh_plugins.txt` was listed in plan's files but required no changes — it only lists plugin names and is already portable.
- **Resolution**: Left untouched.
- **Suggestion**: Plan could have noted that `.zsh_plugins.txt` is already portable and doesn't need edits.
- **Discrepancy**: antidote has no standard Linux package path (not in apt). Need to document the manual install path (`~/.antidote`) for Ubuntu VPS setup.
- **Resolution**: Added `~/.antidote/antidote.zsh` as the third fallback path in the antidote loader.
- **Suggestion**: The Ubuntu setup doc (task 6) should include a command to install antidote manually via `git clone`.

## Task 2: Profile-aware stow + search paths
- **Discrepancy**: `stow-dotfiles.sh` used `getopts` (short flags only) — couldn't support `--profile` as a long flag without rewriting argument parsing.
- **Resolution**: Rewrote to use a `while [[ $# -gt 0 ]]` loop supporting both `--profile ubuntu` and `--profile=ubuntu`.
- **Discrepancy**: `tms/config.toml` used `/Users/josevelazquez/work/projects` as the search dir but the actual projects are at `~/projects`. Updated to `~/projects`.
- **Resolution**: Replaced all absolute paths with `~/`-relative equivalents.
- **Note**: tms does expand `~` in paths — confirmed via its TOML parsing behavior.
- **Discrepancy**: The test file's hardcoded path was `SCRIPT="/Users/josevelazquez/dotfiles/..."` on a single line, easy to find/replace.
- **Resolution**: Replaced with dynamic repo detection via `${BASH_SOURCE[0]}` path resolution.

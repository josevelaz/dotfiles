# Ubuntu VPS Seamless Dev Experience

## TL;DR
> **Summary**: Make the shared shell, tmux, Neovim-adjacent, and OpenCode configuration portable across macOS and Ubuntu by removing hardcoded workstation paths, adding OS-aware/local-only overrides, and documenting a tmux-first remote workflow. Keep desktop-only macOS config available locally without letting it leak into the VPS bootstrap path.
> **Estimated Effort**: Medium

## Context
### Original Request
Create an execution-ready plan for making this dotfiles repo provide a seamless Ubuntu VPS development experience while preserving the existing macOS workflow, with emphasis on a small number of high-leverage changes.

### Key Findings
- `.zshrc` currently hardcodes multiple macOS-only paths (`/Users/josevelazquez`, `/opt/homebrew`, Homebrew Antidote, Deno, Bun, OpenCode, `PROJECTS`) and unconditionally sources `~/.zsh_secrets.sh`.
- `.tmux.conf` uses `xclip` directly for copy-mode yank, which is brittle on macOS and unusable on a headless VPS over SSH.
- `.config/tms/config.toml` hardcodes `/Users/josevelazquez/...` bookmarks and search directories.
- `.config/tmux-sessionizer/tmux-sessionizer.conf` still assumes `~/dotfiles` and `~/projects`; that is portable if those directories exist, but it is not profile-aware.
- `.config/opencode/opencode.jsonc` and `.config/opencode/tui.json` contain absolute user paths plus a file plugin path under `~/.config/opencode/plugin/`.
- `.config/opencode/plugin/annotate-plan.ts`, `.config/opencode/plugin/annotate-plan-tui.ts`, and `.config/nvim/lua/plugins/opencode-annotator.lua` import from local project checkouts under `/Users/josevelazquez/projects/...`, so shared config currently depends on one workstation layout.
- `.local/bin/ghostty-init.sh` hardcodes `/opt/homebrew/bin`, and `.config/ghostty/config` is clearly desktop-oriented (`command = /bin/zsh -lc "~/.local/bin/tmux-sessionizer"`).
- `.local/bin/stow-dotfiles.sh` assumes the repo lives at `~/dotfiles` and stows the whole repo root, which would also apply macOS-only desktop config on Ubuntu unless explicitly excluded.
- Existing tmux-sessionizer tests already exist in `tests/tmux-sessionizer_test.sh`, but the test script itself hardcodes `/Users/josevelazquez/dotfiles/.local/bin/tmux-sessionizer`.
- The repo already has planning artifacts elsewhere, but Loom/Tapestry execution requires plans under `.weave/plans/*.md`.

### Current Gaps
- No shared-vs-local config boundary exists for shell and OpenCode settings.
- No OS detection or profile-aware installation flow exists for applying dotfiles safely.
- Remote tmux clipboard behavior is optimized for local Linux desktop, not SSH-to-VPS editing.
- Machine-specific path assumptions are spread across shell, tmux helpers, OpenCode, and Neovim plugin declarations.
- There is no dedicated Ubuntu VPS setup guide or documented “local macOS terminal -> remote tmux -> edit on VPS” workflow.

### Desired Outcome
- A fresh Ubuntu VPS can clone the repo, run a documented setup flow, and get the same core editing/navigation workflow: zsh, tmux, tmux-sessionizer, Neovim config, and OpenCode base config.
- macOS keeps its current desktop workflow, but desktop-only config remains opt-in for macOS and does not block Linux/server usage.
- Machine-local secrets, plugin checkouts, and workstation-only integrations move behind optional overrides instead of living in the shared baseline.
- The repo documents a minimal, low-risk Mutagen strategy so local editing and remote execution can stay fast without syncing machine-local state.

### Proposed Repo Enhancements by Phase
- Phase 1: Introduce OS-aware shell/bootstrap primitives and optional local overrides.
- Phase 2: Make install/application profile-aware so Ubuntu only gets portable/shared config.
- Phase 3: Replace tmux clipboard assumptions with an SSH-safe strategy centered on OSC52 fallback.
- Phase 4: Remove absolute-path coupling from OpenCode/Neovim integrations and push workstation-only pieces behind local overrides.
- Phase 5: Document Ubuntu setup, macOS adjustments, and the recommended local-to-remote workflow.

### Recommended Workflow
1. On macOS, open the usual local terminal app and enter the local tmux session if desired.
2. SSH into the Ubuntu VPS from a terminal that supports OSC52 clipboard passthrough.
3. Start or attach a remote tmux session on the VPS.
4. Launch `tmux-sessionizer` remotely to jump into `~/projects`, `~/dotfiles`, or other configured search roots.
5. Edit/run/debug from the VPS so code, tools, and runtime all stay colocated.
6. Use tmux yank to copy from the remote session back to the local clipboard via OSC52 fallback; rely on native clipboard tools only when running in a local desktop environment.
7. Treat tmux persistence as machine-local: local tmux plugins restore local state, and remote tmux plugins restore remote state independently.

### Mutagen Sync Recommendations
#### Recommended Minimal Sync Roots
- `~/dotfiles` — sync the shared dotfiles repo itself so shell, tmux, Neovim, OpenCode, and bootstrap changes stay aligned between local and VPS.
- `~/projects` — sync active project roots that are edited locally but executed remotely; for a narrower footprint, prefer one sync per active project under `~/projects/<project-name>` instead of syncing every project at once.

#### Folders to Sync
- `~/dotfiles`
- `~/projects/<active-project>` for each project actively developed against the VPS
- Optionally `~/projects` only if most child repos are intentionally part of the remote workflow and the sync excludes per-project build artifacts/caches

#### Folders Not to Sync
- `~/.cache`, `~/Library`, `~/.local/share`, `~/.npm`, `~/.pnpm-store`, `~/.cargo`, `~/.rustup`, `~/.venv`, `node_modules`, `.next`, `.turbo`, `dist`, `build`, `.pytest_cache`, `.mypy_cache`
- `~/.tmux`, `~/.tmux.conf.local`, tmux resurrect/continuum state, swap files, undo history, and other machine-local editor/session state
- `~/.config/ghostty`, `~/.config/sketchybar`, `~/.config/yabai`, `~/.config/skhd`, `~/.config/karabiner`, and other desktop-only macOS app state
- `~/.config/opencode/plugin`, any plugin checkout directories under `~/projects`, and other locally built plugin install directories unless intentionally promoted into the portable shared baseline
- `.env*`, credential files, SSH material, `.zsh_secrets.sh`, local override files, and any other secrets

#### Brief Rationale
- Sync the smallest set of source-of-truth directories: the dotfiles repo plus currently active codebases.
- Do not sync generated artifacts, caches, or session state because they are noisy, high-churn, platform-specific, and more likely to corrupt the “local desktop + remote VPS” split than help it.
- Keep secrets and workstation-only app state out of Mutagen entirely so the VPS bootstrap remains reproducible and safe.
- Prefer per-project sync sessions under `~/projects/<name>` when possible; it keeps startup faster, reduces conflict surface area, and matches the repo’s tmux-sessionizer/project-root conventions.

### Manual Setup Instructions: Ubuntu VPS After Clone
1. Install baseline packages: `git`, `zsh`, `tmux`, `stow`, `fzf`, `zoxide`, `ripgrep`, `fd-find`, `curl`, `unzip`, and `neovim`.
2. Clone the repo to `~/dotfiles`.
3. Run the future profile-aware bootstrap command in dry-run mode first, then apply the Ubuntu profile.
4. Install tmux plugin manager if missing and trigger tmux plugin install once.
5. Create machine-local overrides for secrets and workstation-specific values only if needed.
6. Set the login shell to zsh if desired, then start a fresh shell.
7. Validate the remote workflow by opening tmux, running `tmux-sessionizer`, opening Neovim, and checking remote clipboard yank behavior.

### AI-Agent Prompt: Ubuntu VPS Bootstrap/Setup
```text
You are on an Ubuntu VPS with terminal access. Prepare this machine for the portable dotfiles workflow without introducing macOS-only config.

Tasks:
1. Ensure these packages are installed via apt: git, zsh, tmux, stow, fzf, zoxide, ripgrep, fd-find, curl, unzip, neovim.
2. Clone or update the dotfiles repo into ~/dotfiles.
3. Inspect ~/.local/bin/stow-dotfiles.sh and any profile-related docs/config to identify the intended Ubuntu/server bootstrap flow.
4. Run the bootstrap helper in dry-run mode first using the Ubuntu/server profile, review what would change, then run the real apply command only if the dry-run excludes macOS desktop-only config.
5. Install tmux plugin manager only if missing, but do not install unrelated tools or desktop apps.
6. Create only machine-local override files that are explicitly documented as optional; do not invent secrets or copy macOS-specific paths.
7. If zsh is available, switch the login shell to zsh for the current user.
8. Capture a short validation summary covering: shell starts cleanly, tmux config loads, tmux-sessionizer runs, and the environment is ready for remote editing.

Constraints:
- Keep macOS-only config out of the Ubuntu setup.
- Do not modify application source code; only perform environment/bootstrap work if already supported by the repo.
- If the repo is not yet implementation-ready, stop after documenting exactly what is missing for automated bootstrap.
```

### Manual Setup Instructions: macOS Local
1. Re-run the future bootstrap command with the macOS profile so desktop-only config still applies locally.
2. Move any machine-only secrets or plugin checkout paths into the new local override locations.
3. Reinstall or reload tmux plugins once if the tmux clipboard command changes.
4. If OpenCode local plugins stay part of the macOS workflow, re-enable them through the new local override mechanism rather than the shared committed config.

### AI-Agent Prompt: macOS Local Adjustments
```text
You are on macOS with terminal access. Re-apply the portable dotfiles setup while preserving desktop-specific local behavior.

Tasks:
1. Inspect the repo’s bootstrap/profile flow and identify the correct macOS profile command.
2. Run the bootstrap helper in dry-run mode first, then apply the macOS profile if the preview preserves the expected desktop config.
3. Move any machine-specific secrets, local plugin checkout paths, and workstation-only overrides into the documented local override files rather than shared committed config.
4. Reload or reinstall tmux plugins if the tmux clipboard integration changed.
5. Verify that desktop-oriented config remains local-only where intended, especially Ghostty, Karabiner, Sketchybar, Yabai, and Skhd.
6. Summarize whether the local macOS workflow still supports the expected path: local terminal -> optional local tmux -> SSH -> remote tmux.

Constraints:
- Preserve the current macOS desktop workflow.
- Do not promote workstation-only secrets or plugin paths back into shared config.
- If the repo changes required for this are not implemented yet, stop and report the exact blockers.
```

### AI-Agent Prompt: Validate Remote Workflow
```text
You are validating the intended local-to-VPS development workflow after bootstrap is complete.

Tasks:
1. From the local machine, SSH into the Ubuntu VPS using a terminal that supports OSC52 clipboard passthrough.
2. Attach to or create a tmux session on the VPS.
3. Run tmux-sessionizer and confirm it can open ~/dotfiles plus at least one active project root under ~/projects.
4. Open Neovim inside the remote tmux session and confirm the shared config loads without hardcoded macOS path failures.
5. Exercise tmux copy-mode yank and verify the documented clipboard path works remotely; note whether it used OSC52 or a local clipboard tool fallback.
6. Record any mismatch between docs and reality, especially around bootstrap profiles, local overrides, tmux plugins, and clipboard behavior.

Deliverable:
- A short pass/fail report with exact commands run, observed behavior, and any platform caveats.
```

### Risks and Open Questions
- `tms` config may or may not support environment-variable expansion; if it does not, the implementation should prefer a documented local override/generated file rather than guessing unsupported syntax.
- The `opencode-plan-anotator` / `opencode-annotator.nvim` local projects appear workstation-only today. Decide whether they should become portable dependencies or remain macOS-local enhancements.
- `.zsh_secrets.sh` exists in the repo working tree while also being gitignored; confirm whether it should become an example file plus untracked local override, and whether secret cleanup/history cleanup is needed outside this task.
- OSC52 support depends on the terminal + SSH path. Ghostty looks promising, but this should be validated against the actual terminal/SSH combination used for VPS work.
- Decide whether `.config/ghostty/` should remain completely macOS-local or merely be excluded from Ubuntu/server bootstrap while still living in-repo.

## Objectives
### Core Objective
Create a portable “shared core + machine-local overrides + OS-aware install profiles” setup so Ubuntu VPSes get the same core development environment as macOS without inheriting desktop-only config or hardcoded workstation paths.

### Deliverables
- [x] OS-aware shell/bootstrap structure that removes hardcoded macOS-only paths from the shared baseline.
- [x] Profile-aware dotfiles application flow for `macos` vs `ubuntu/server`.
- [x] SSH-safe tmux clipboard behavior with documented fallback order.
- [x] Portable/default-safe OpenCode and Neovim integration that no longer depends on `/Users/josevelazquez/...` in shared config.
- [x] Ubuntu VPS setup guide, macOS adjustment guide, and recommended remote workflow documentation.
- [x] Mutagen sync guidance that defines the minimal sync roots, exclusions, and rationale for this dotfiles + VPS workflow.

### Definition of Done
- [x] `zsh -n ~/.zshrc` succeeds on both macOS and Ubuntu after stowing the appropriate profile.
- [x] `~/.local/bin/stow-dotfiles.sh -n --profile ubuntu` excludes macOS-only desktop config and resolves the repo path without assuming `~/dotfiles` from inside the script.
- [x] `~/.local/bin/stow-dotfiles.sh -n --profile macos` still includes the desktop-local pieces needed for the current macOS workflow.
- [x] `tests/tmux-sessionizer_test.sh` passes after any path/bootstrap updates needed for portability.
- [x] `tmux -L dotfiles-check -f ~/.tmux.conf start-server` followed by `tmux -L dotfiles-check -f ~/.tmux.conf source-file ~/.tmux.conf` succeeds on macOS and Ubuntu.
- [x] Shared committed config no longer contains required `/Users/josevelazquez/...` runtime paths for shell, tmux, tms, OpenCode, or Neovim plugin loading.
- [x] An Ubuntu VPS can follow the documented setup steps and reach the target workflow: SSH in, attach tmux, run sessionizer, edit in Neovim, yank back to the local clipboard.
- [x] The docs include copy-paste-ready AI-agent prompts for Ubuntu bootstrap, macOS-local adjustments, and remote workflow validation.
- [x] The docs explicitly recommend Mutagen sync roots of `~/dotfiles` and `~/projects/<active-project>` (or `~/projects` only when intentionally broad sync is desired), plus clear exclusions for caches, secrets, session state, and desktop-only app state.

### Guardrails (Must NOT)
- Do not spend scope on Mason/LSP/formatter auto-install parity.
- Do not redesign the repo into a large multi-package stow structure unless the smaller profile-aware approach proves insufficient.
- Do not remove or degrade the current macOS desktop workflow.
- Do not require Ghostty or any macOS-only desktop app on Ubuntu VPSes.
- Do not keep workstation-only secrets or required plugin paths in the shared baseline if an optional local override can handle them.

## TODOs

- [x] 1. Introduce OS-aware shell bootstrap and local override hooks
  **What**: Refactor the shell entrypoint so the committed baseline uses `$HOME`, XDG variables, command detection, and `uname`/platform guards instead of `/Users/josevelazquez` and `/opt/homebrew`. Make secrets and machine-local values optional by sourcing a local override file only when present. Keep portable/shared aliases and editor defaults in the shared layer, and isolate Homebrew-specific or macOS-only path additions in a macOS-specific layer.
  **Files**: `.zshrc`, `.zsh_plugins.txt`, `.gitignore`, `.zsh_secrets.sh` (decision point: replace with example or stop sourcing directly), new shell include files such as `.config/zsh/base.zsh`, `.config/zsh/platform/darwin.zsh`, `.config/zsh/platform/linux.zsh`, and a documented local override example such as `.config/zsh/local.example.zsh`
  **Acceptance**: Shared shell startup contains no required hardcoded `/Users/josevelazquez` paths, a missing local secrets/override file does not break login, and macOS-only path logic is gated behind platform checks.

- [x] 2. Make repo application and machine-local search paths profile-aware
  **What**: Update the stow/bootstrap helper to derive the repo root dynamically, accept an explicit install profile (`macos`, `ubuntu`, or `server`), and exclude macOS-only directories from Ubuntu/server application. Normalize helper/config paths that can safely rely on `$HOME` or documented local overrides, especially for tmux-sessionizer and project directory discovery. If `tms` cannot expand env vars, shift machine-specific bookmarks/search roots into a documented local-only config path rather than committing absolute paths.
  **Files**: `.local/bin/stow-dotfiles.sh`, `.stow-local-ignore`, `.config/tms/config.toml`, `.config/tmux-sessionizer/tmux-sessionizer.conf`, `tests/tmux-sessionizer_test.sh`, optional new test coverage such as `tests/stow-dotfiles_test.sh`, and docs files for setup instructions
  **Acceptance**: Ubuntu/server dry-run stow skips `.config/sketchybar`, `.config/yabai`, `.config/skhd`, `.config/karabiner`, and likely `.config/ghostty`; the helper no longer assumes `~/dotfiles`; and project/search config works from `$HOME`-relative or documented local values instead of `/Users/josevelazquez/...`.

- [x] 3. Replace tmux’s xclip-only yank with a layered clipboard strategy
  **What**: Move clipboard copy behavior behind a small wrapper or conditional tmux command that tries `pbcopy`, `wl-copy`, or `xclip` when locally available and falls back to OSC52 for SSH/VPS workflows. Preserve the current `copy-mode-vi` ergonomics and document how clipboard behavior differs between local desktop and remote headless sessions.
  **Files**: `.tmux.conf`, new helper such as `.local/bin/tmux-copy`, optional shell tests such as `tests/tmux-copy_test.sh`, and setup/workflow docs
  **Acceptance**: `y` in tmux copy-mode still works on macOS, works on Linux desktops when clipboard tooling exists, and has a documented/tested OSC52 path for remote VPS sessions over SSH.

- [x] 4. Decouple OpenCode and Neovim from workstation-only absolute paths
  **What**: Remove absolute user-home paths from shared OpenCode permissions, plugin references, and TUI config. Push workstation-only plugin wiring (`annotate-plan`, `opencode-annotator.nvim`, local dist imports under `~/projects`) into a local override mechanism or make them conditional on file existence. Keep the shared committed config portable on both macOS and Ubuntu, and use environment/file variables where OpenCode supports them.
  **Files**: `.config/opencode/opencode.jsonc`, `.config/opencode/tui.json`, `.config/opencode/plugin/annotate-plan.ts`, `.config/opencode/plugin/annotate-plan-tui.ts`, `.config/nvim/lua/plugins/opencode-annotator.lua`, and any accompanying local-override example docs
  **Acceptance**: Shared OpenCode/Neovim config starts without requiring `/Users/josevelazquez/...`, local workstation plugins are opt-in instead of baseline dependencies, and permissions/path rules use portable patterns or documented local overrides.

- [x] 5. Gate desktop-local terminal startup helpers without breaking macOS
  **What**: Audit Ghostty-specific startup pieces and make sure they do not participate in Ubuntu VPS bootstrap. Remove Homebrew-specific assumptions from `ghostty-init.sh` or explicitly document it as macOS-local, and decide whether `.config/ghostty/` should be excluded entirely from non-macOS profiles.
  **Files**: `.local/bin/ghostty-init.sh`, `.config/ghostty/config`, `.local/bin/stow-dotfiles.sh`, and setup docs
  **Acceptance**: Ubuntu/server setup does not rely on Ghostty or Homebrew paths, while macOS can still launch the preferred terminal/tmux entry flow unchanged or with a clearly documented local-only adjustment.

- [x] 6. Write the Ubuntu VPS and macOS workflow documentation
  **What**: Add explicit docs for Ubuntu VPS bootstrap, macOS-local adjustments, and the target workflow: local terminal -> SSH -> remote tmux -> tmux-sessionizer -> Neovim/OpenCode on VPS. Include notes on clipboard behavior, tmux plugin install/restore, machine-local override files, expected directory conventions such as `~/dotfiles` and `~/projects`, plus adjacent AI-agent-ready prompts that can execute Ubuntu bootstrap, macOS-local adjustments, and remote workflow validation.
  **Files**: `docs/setup/ubuntu-vps.md`, `docs/setup/macos-local.md`, and any lightweight index/update file that links to them
  **Acceptance**: A developer with no prior repo context can follow the Ubuntu doc end-to-end, keep macOS working, understand which settings belong in shared config vs local overrides, and hand the included prompts to a terminal-capable agent without rewriting them.

- [x] 7. Document the Mutagen sync model for dotfiles + active projects
  **What**: Add a dedicated Mutagen section to the setup docs that defines the recommended minimal sync roots, when to sync `~/projects/<active-project>` versus broader `~/projects`, and which paths must stay unsynced because they are caches, secrets, tmux/editor state, plugin install directories, or desktop-only app state. Keep the guidance opinionated and minimal so the remote workflow is easy to adopt.
  **Files**: `docs/setup/ubuntu-vps.md`, `docs/setup/macos-local.md`, and any linked setup index/overview doc
  **Acceptance**: The docs clearly recommend `~/dotfiles` plus active project roots as the primary sync targets, explicitly exclude machine-local/stateful directories, and explain why smaller sync roots are preferred.

- [x] 8. Run cross-platform verification and smoke tests
  **What**: Validate shell parsing, tmux config loading, bootstrap dry-runs, tmux-sessionizer tests, the documented remote workflow on both macOS and Ubuntu, and the Mutagen guidance against the actual directory layout in this repo. Perform at least one real SSH/VPS clipboard smoke test to confirm the OSC52 path behaves as documented.
  **Acceptance**: All listed verification commands pass, the docs match reality, the recommended sync roots fit the actual repo/project layout, and any remaining platform caveats are captured explicitly in the setup guides.

## Verification
- [x] All tests pass
- [x] No regressions in the current macOS workflow
- [x] Ubuntu VPS bootstrap works from a fresh clone using the documented profile-aware stow flow
- [x] `zsh -n ~/.zshrc` passes on both macOS and Ubuntu
- [x] `tests/tmux-sessionizer_test.sh` passes after removing hardcoded repo-path assumptions
- [x] tmux copy-mode yank is validated locally and through one SSH/VPS OSC52 smoke test
- [x] Shared committed config has no required `/Users/josevelazquez/...` runtime dependencies for the portable toolchain
- [x] Setup docs include adjacent AI-agent prompts for Ubuntu setup, macOS local adjustment, and remote workflow validation
- [x] Mutagen guidance explicitly recommends `~/dotfiles` and `~/projects/<active-project>` as minimal sync roots, with exclusions for caches, secrets, tmux/editor state, plugin install directories, and desktop-only app state

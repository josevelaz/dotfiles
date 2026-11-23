# Shared fish configuration for every machine (macOS and Linux).
# Platform differences are limited to platform software and are guarded by
# `uname`, so this one file works everywhere. Functions live in functions/,
# secrets in conf.d/secrets.fish (rendered by chezmoi from 1Password).

set -l os (uname)

# ── PATH ───────────────────────────────────────────────────────────────────────
# fish_add_path skips directories that do not exist and never adds duplicates.
if test $os = Darwin
    test -x /opt/homebrew/bin/brew; and /opt/homebrew/bin/brew shellenv fish | source
    fish_add_path -g /opt/homebrew/opt/mysql-client/bin /usr/local/opt/mysql-client/bin
    set -gx VOLTA_HOME $HOME/.volta
    fish_add_path -g $VOLTA_HOME/bin
    # Java 17 (Homebrew OpenJDK): ~/.java-env holds sh-style `export K=V` lines.
    if test -f $HOME/.java-env
        for line in (string match -r '^export\s+\w+=.*' < $HOME/.java-env)
            set -l kv (string split -m1 = (string replace -r '^export\s+' '' $line))
            set -gx $kv[1] (string trim -c '"\'' $kv[2])
        end
    end
end

set -gx PNPM_HOME $HOME/.local/share/pnpm
set -gx BUN_INSTALL $HOME/.bun
fish_add_path -g $PNPM_HOME/bin $BUN_INSTALL/bin $HOME/.deno/bin $HOME/.cargo/bin \
    $HOME/.opencode/bin $HOME/.pi/agent/bin $HOME/.grok/bin
fish_add_path -g -a $HOME/.local/bin $HOME/go/bin /snap/bin

if test $os = Linux
    # Omarchy exports OMARCHY_PATH through the session; set the packaged default
    # for shells that start outside it (SSH).
    set -q OMARCHY_PATH; or set -gx OMARCHY_PATH /usr/share/omarchy
end

# mise ships /usr/share/fish/vendor_conf.d/mise-activate.fish on Arch; activate
# it here only where that hook is missing.
if command -q mise; and not functions -q __mise_env_eval
    mise activate fish | source
end

# ── Environment ────────────────────────────────────────────────────────────────
set -gx EDITOR nvim
set -gx SUDO_EDITOR $EDITOR
set -gx PROJECTS (set -q PROJECTS; and echo $PROJECTS; or echo $HOME/projects)
set -gx OPENCODE_EXPERIMENTAL_LSP_TOOL 1
set -gx OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT 300000
set -gx OP_DEFAULT_ENVIRONMENT 43rm5gh7jf5dndejrsm5s5tcmm
set -gx _ZO_EXCLUDE_DIRS "$_ZO_EXCLUDE_DIRS:node_modules/*"
set -gx BAT_THEME ansi
command -q bat; and set -gx MANPAGER "sh -c 'col -bx | bat -l man -p'"; and set -gx MANROFFOPT -c
set -gx FZF_DEFAULT_OPTS "\
--color=fg:#808080,bg:#0a0a0a,hl:#EE7948 \
--color=fg+:#eeeeee,bg+:#242424,hl+:#EC5B2B \
--color=border:#3a3a3a,header:#56b6c2,gutter:#0a0a0a \
--color=spinner:#e5c07b,info:#6ba1e6 \
--color=pointer:#EC5B2B,marker:#e06c75,prompt:#EE7948"

if not status is-interactive
    return
end

# ── Interactive ────────────────────────────────────────────────────────────────
set -g fish_greeting
fish_vi_key_bindings insert

# Load 1Password environment values (cached; silent when 1Password is unavailable).
openv --quiet

if command -q oh-my-posh; and test "$TERM_PROGRAM" != Apple_Terminal
    oh-my-posh init fish --config ~/.orng.omp.json | source
end
command -q zoxide; and zoxide init --cmd cd fish | source
command -q fzf; and fzf --fish | source

# Aliases (yours and Omarchy's, shared on every machine)
alias vim nvim
alias nvime 'NVIM_APPNAME=nvim-experimental nvim'
alias tms tmux-sessionizer
if command -q eza
    alias ls 'eza -lh --group-directories-first --icons=auto'
    alias lsa 'ls -a'
    alias lt 'eza --tree --level=2 --long --icons --git'
    alias lta 'lt -a'
end
alias ff "fzf --preview 'bat --style=numbers --color=always {}'"
alias eff '$EDITOR (ff)'
alias .. 'cd ..'
alias ... 'cd ../..'
alias .... 'cd ../../..'
alias c 'opencode --auto'
alias cx 'printf "\033[2J\033[3J\033[H"; and claude --permission-mode auto'
alias cy 'codex --approve-for-me'
alias d docker
alias r rails
alias t 'tmux attach; or tmux new -s Work'
alias h herdr
alias ic 'tdl c'
alias ix 'tdl cx'
alias icx 'tdl c cx'
alias mup 'MISE_MINIMUM_RELEASE_AGE=0 mise up'
alias g git
alias gcm 'git commit -m'
alias gcam 'git commit -a -m'
alias gcad 'git commit -a --amend'
alias decompress 'tar -xzf'

if test $os = Linux
    alias a 'omarchy-agent --inline'
    command -q fdfind; and not command -q fd; and alias fd fdfind
end

# ── Hooks ──────────────────────────────────────────────────────────────────────
# tmux-window-name: rename windows when the directory changes.
function __tmux_window_name --on-variable PWD
    set -q TMUX_PLUGIN_MANAGER_PATH; or return
    $TMUX_PLUGIN_MANAGER_PATH/tmux-window-name/scripts/rename_session_windows.py >/dev/null 2>&1 &
    disown 2>/dev/null
end

# herdr: label the tab with the running command, then with the directory.
function __herdr_tab_preexec --on-event fish_preexec
    __herdr_rename_tab (string join ' ' -- (string split -n ' ' -- $argv[1]))
end
function __herdr_tab_prompt --on-event fish_prompt
    __herdr_rename_tab (string replace -r "^$HOME" '~' -- $PWD)
end

# sqz: remember the command being run.
function __sqz_preexec --on-event fish_preexec
    set -gx __SQZ_CMD $argv[1]
end

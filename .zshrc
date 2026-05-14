export TERM="xterm-ghostty"

function devbox {
  tailscale ssh ubuntu@devbox
}


# =========== SECRETS / LOCAL OVERRIDES ================
# Source optional machine-local secrets and overrides (not committed to repo)
[[ -f ~/.zsh_secrets.sh ]] && source ~/.zsh_secrets.sh
[[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/zsh/local.zsh" ]] && \
  source "${XDG_CONFIG_HOME:-$HOME/.config}/zsh/local.zsh"
# =========== END SECRETS / LOCAL OVERRIDES ================

bindkey -v

# =========== ANTIDOTE ================
# Load antidote zsh plugin manager.
# Tries: Homebrew (Apple Silicon), Homebrew (Intel), manual install at ~/.antidote
_antidote_path=""
if [[ -f /opt/homebrew/opt/antidote/share/antidote/antidote.zsh ]]; then
  _antidote_path="/opt/homebrew/opt/antidote/share/antidote/antidote.zsh"
elif [[ -f /usr/local/opt/antidote/share/antidote/antidote.zsh ]]; then
  _antidote_path="/usr/local/opt/antidote/share/antidote/antidote.zsh"
elif [[ -f "$HOME/.antidote/antidote.zsh" ]]; then
  _antidote_path="$HOME/.antidote/antidote.zsh"
fi

if [[ -n "$_antidote_path" ]]; then
  source "$_antidote_path"
  antidote load
fi
unset _antidote_path
# =========== END ANTIDOTE ================


# Local bin
export PATH="$PATH:$HOME/.local/bin"

# =========== OH MY POSH ================
if command -v oh-my-posh &>/dev/null && [[ "$TERM_PROGRAM" != "Apple_Terminal" ]]; then
  eval "$(oh-my-posh init zsh --config ~/.rose_pine.omp.json)"
fi
# =========== END OH MY POSH ================

export EDITOR=$(which nvim)

alias vim="nvim"
alias nvime="NVIM_APPNAME=nvim-experimental nvim"
alias oc="opencode"


# FZF styling
export FZF_DEFAULT_OPTS="
	--color=fg:#908caa,bg:#191724,hl:#ebbcba
	--color=fg+:#e0def4,bg+:#26233a,hl+:#ebbcba
	--color=border:#403d52,header:#31748f,gutter:#191724
	--color=spinner:#f6c177,info:#9ccfd8
	--color=pointer:#c4a7e7,marker:#eb6f92,prompt:#908caa"

bindkey '\t'   complete-word       # tab          | complete
bindkey '\t\t' autosuggest-accept  # shift + tab  | autosuggest

# ============ ZOXIDE ==============
export _ZO_EXCLUDE_DIRS="$_ZO_EXCLUDE_DIRS:node_modules/*"
command -v zoxide &>/dev/null && eval "$(zoxide init --cmd cd zsh)"
# ============ END ZOXIDE ==============

# =========== OPENCODE EXPERIMENTAL FEATURES ================
export OPENCODE_EXPERIMENTAL_LSP_TOOL=1
export OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT=1
# ========== END OPENCODE EXPERIMENTAL FEATURES ============

# =========== PATHS ================
# Snap
[[ -d "/snap/bin" ]] && export PATH="$PATH:/snap/bin"

# Volta (Node version manager)
export VOLTA_HOME="$HOME/.volta"
[[ -d "$VOLTA_HOME/bin" ]] && export PATH="$VOLTA_HOME/bin:$PATH"

# Java 17 (Homebrew OpenJDK)
[ -f "$HOME/.java-env" ] && . "$HOME/.java-env"

# Go bin
[[ -d "$HOME/go/bin" ]] && export PATH="$PATH:$HOME/go/bin"

# Bun
export BUN_INSTALL="$HOME/.bun"
[[ -d "$BUN_INSTALL/bin" ]] && export PATH="$BUN_INSTALL/bin:$PATH"
[[ -s "$BUN_INSTALL/_bun" ]] && source "$BUN_INSTALL/_bun"

# Deno
[[ -f "$HOME/.deno/env" ]] && . "$HOME/.deno/env"
if [[ -d "$HOME/.deno/bin" ]]; then
  [[ ":$FPATH:" != *":$HOME/.zsh/completions:"* ]] && \
    export FPATH="$HOME/.deno/completions:$FPATH"
fi

# OpenCode
[[ -d "$HOME/.opencode/bin" ]] && export PATH="$HOME/.opencode/bin:$PATH"


# uv / rustup env shim (if installed)
[[ -f "$HOME/.local/bin/env" ]] && . "$HOME/.local/bin/env"
# =========== END PATHS ================


# Projects root — can be overridden in .config/zsh/local.zsh
export PROJECTS="${PROJECTS:-$HOME/projects}"


# =========== PLATFORM-SPECIFIC ================
_zsh_platform_dir="${XDG_CONFIG_HOME:-$HOME/.config}/zsh/platform"
if [[ "$(uname)" == "Darwin" ]]; then
  [[ -f "$_zsh_platform_dir/darwin.zsh" ]] && source "$_zsh_platform_dir/darwin.zsh"
elif [[ "$(uname)" == "Linux" ]]; then
  [[ -f "$_zsh_platform_dir/linux.zsh" ]] && source "$_zsh_platform_dir/linux.zsh"
fi
unset _zsh_platform_dir
# =========== END PLATFORM-SPECIFIC ================


# =========== DOCKER HELPERS ================
function oai-lb {
  docker volume create oai-lb-data
  docker run -d --name oai-lb \
    -p 2455:2455 -p 1455:1455 \
    -v codex-lb-data:/var/lib/codex-lb \
    ghcr.io/soju6/codex-lb:latest
}
# =========== END DOCKER HELPERS ================


# =========== TMUX HOOKS ================
tmux-window-name() {
  if [[ -n "$TMUX_PLUGIN_MANAGER_PATH" ]]; then
    "$TMUX_PLUGIN_MANAGER_PATH/tmux-window-name/scripts/rename_session_windows.py" >/dev/null 2>&1 &!
  fi
}

add-zsh-hook chpwd tmux-window-name
# =========== END TMUX HOOKS ================

# pnpm
export PNPM_HOME="/home/ubuntu/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

alias tms="tmux-sessionizer"

# sqz — context intelligence layer (auto-installed)
sqz_run() {
    "$@" 2>&1 | SQZ_CMD="$*" sqz compress
}
sqz_sudo() {
    sudo "$@" 2>&1 | SQZ_CMD="sudo $*" sqz compress
}
add-zsh-hook preexec _sqz_preexec
_sqz_preexec() {
    export __SQZ_CMD="$1"
}
# sqz — end of auto-installed block


# bun completions
[ -s "/home/ubuntu/.bun/_bun" ] && source "/home/ubuntu/.bun/_bun"

# opencode
export PATH=/Users/jose/.opencode/bin:$PATH

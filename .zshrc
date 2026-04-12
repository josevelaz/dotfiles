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

export OPENCODE_EXPERIMENTAL_LSP_TOOL=1

# =========== PATHS ================
# Local bin
export PATH="$PATH:$HOME/.local/bin"

# Volta (Node version manager)
export VOLTA_HOME="$HOME/.volta"
[[ -d "$VOLTA_HOME/bin" ]] && export PATH="$VOLTA_HOME/bin:$PATH"

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

opencode() {
  OPENCODE_DISABLE_DEFAULT_PLUGINS=1 command opencode "$@"
}

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
    ($TMUX_PLUGIN_MANAGER_PATH/tmux-window-name/scripts/rename_session_windows.py &)
  fi
}

add-zsh-hook chpwd tmux-window-name
# =========== END TMUX HOOKS ================

export OP_DEFAULT_ENVIRONMENT="43rm5gh7jf5dndejrsm5s5tcmm"
export TERM="xterm-ghostty"

function y() {
	local tmp="$(mktemp -t "yazi-cwd.XXXXXX")" cwd
	command yazi "$@" --cwd-file="$tmp"
	IFS= read -r -d '' cwd < "$tmp"
	[ "$cwd" != "$PWD" ] && [ -d "$cwd" ] && builtin cd -- "$cwd"
	command rm -f -- "$tmp"
}

_openv_cache_file() {
  local environment="${1:-$OP_DEFAULT_ENVIRONMENT}"

  case "$environment" in
    (""|*[![:alnum:]_-]*)
      print -u2 -r -- "openv: invalid environment ID: $environment"
      return 1
      ;;
  esac

  print -r -- "${XDG_CACHE_HOME:-$HOME/.cache}/zsh/op-environments/${environment}.zsh"
}

_openv_load_cache() {
  local cache_file
  cache_file=$(_openv_cache_file "$1") || return 1

  [[ -r "$cache_file" ]] || return 1
  source "$cache_file"
}

_openv_use_stale_cache() {
  local environment="$1"
  local reason="$2"

  if _openv_load_cache "$environment"; then
    print -u2 -r -- "openv: warning: $reason; using cached values for $environment"
    return 0
  fi

  print -u2 -r -- "openv: error: $reason and no usable cache exists for $environment"
  return 1
}

openv-refresh() {
  local environment="${1:-$OP_DEFAULT_ENVIRONMENT}"
  local cache_file cache_dir temporary_file op_status sed_status

  cache_file=$(_openv_cache_file "$environment") || return 1
  cache_dir="${cache_file:h}"

  if ! mkdir -p -m 700 "$cache_dir" || ! chmod 700 "$cache_dir"; then
    _openv_use_stale_cache "$environment" "could not prepare the cache directory"
    return $?
  fi

  temporary_file=$(umask 077; mktemp "$cache_dir/.${environment}.XXXXXX") || {
    _openv_use_stale_cache "$environment" "could not create a cache file"
    return $?
  }

  op environment read "$environment" | sed 's/^/export /' > "$temporary_file"
  op_status=${pipestatus[1]}
  sed_status=${pipestatus[2]}
  if (( op_status != 0 || sed_status != 0 )); then
    rm -f "$temporary_file"
    _openv_use_stale_cache "$environment" "could not refresh from 1Password"
    return $?
  fi

  if ! chmod 600 "$temporary_file" || ! mv -f "$temporary_file" "$cache_file"; then
    rm -f "$temporary_file"
    _openv_use_stale_cache "$environment" "could not update the cache"
    return $?
  fi

  _openv_load_cache "$environment" || {
    print -u2 -r -- "openv: error: refreshed cache for $environment could not be loaded"
    return 1
  }
}

openv-cache-current() {
  local environment="$OP_DEFAULT_ENVIRONMENT"
  local cache_file cache_dir temporary_file variable

  if (( $# == 0 )); then
    print -u2 -r -- "Usage: openv-cache-current VARIABLE..."
    return 1
  fi

  cache_file=$(_openv_cache_file "$environment") || return 1
  cache_dir="${cache_file:h}"
  if ! mkdir -p -m 700 "$cache_dir" || ! chmod 700 "$cache_dir"; then
    print -u2 -r -- "openv: error: could not prepare the cache directory"
    return 1
  fi

  temporary_file=$(umask 077; mktemp "$cache_dir/.${environment}.XXXXXX") || return 1
  for variable in "$@"; do
    if [[ ! "$variable" =~ '^[A-Za-z_][A-Za-z0-9_]*$' ]] || (( ! ${+parameters[$variable]} )); then
      rm -f "$temporary_file"
      print -u2 -r -- "openv: error: variable is not set: $variable"
      return 1
    fi

    export "$variable"
    typeset -p "$variable" >> "$temporary_file"
  done

  if ! chmod 600 "$temporary_file" || ! mv -f "$temporary_file" "$cache_file"; then
    rm -f "$temporary_file"
    print -u2 -r -- "openv: error: could not update the cache"
    return 1
  fi

  print -r -- "openv: cached current values for $environment"
}

openv-clear() {
  local environment="${1:-$OP_DEFAULT_ENVIRONMENT}"
  local cache_file

  cache_file=$(_openv_cache_file "$environment") || return 1
  rm -f "$cache_file" || return 1
  print -r -- "openv: cleared cache for $environment"
}

openv() {
  local environment="${1:-$OP_DEFAULT_ENVIRONMENT}"

  _openv_load_cache "$environment" || openv-refresh "$environment"
}




# =========== SECRETS / LOCAL OVERRIDES ================
# Source optional machine-local secrets and overrides (not committed to repo)
[[ -f ~/.zsh_secrets.sh ]] && source ~/.zsh_secrets.sh

[[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/zsh/local.zsh" ]] && \
  source "${XDG_CONFIG_HOME:-$HOME/.config}/zsh/local.zsh"
# =========== END SECRETS / LOCAL OVERRIDES ================

openv "$OP_DEFAULT_ENVIRONMENT"

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
  eval "$(oh-my-posh init zsh --config ~/.orng.omp.json)"
fi
# =========== END OH MY POSH ================

export EDITOR=$(which nvim)

alias vim="nvim"
alias nvime="NVIM_APPNAME=nvim-experimental nvim"
alias opencode="opencode2"

# FZF styling
export FZF_DEFAULT_OPTS="
	--color=fg:#808080,bg:#0a0a0a,hl:#EE7948
	--color=fg+:#eeeeee,bg+:#242424,hl+:#EC5B2B
	--color=border:#3a3a3a,header:#56b6c2,gutter:#0a0a0a
	--color=spinner:#e5c07b,info:#6ba1e6
	--color=pointer:#EC5B2B,marker:#e06c75,prompt:#EE7948"

bindkey '\t'   complete-word       # tab          | complete
bindkey '\t\t' autosuggest-accept  # shift + tab  | autosuggest

# ============ ZOXIDE ==============
export _ZO_EXCLUDE_DIRS="$_ZO_EXCLUDE_DIRS:node_modules/*"
command -v zoxide &>/dev/null && eval "$(zoxide init --cmd cd zsh)"
# ============ END ZOXIDE ==============

# =========== OPENCODE EXPERIMENTAL FEATURES ================
export OPENCODE_EXPERIMENTAL_LSP_TOOL=1
export OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT=300000
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
# Weave's Pi adapter requires Pi's 0.82+ CLI to run under Bun so Bun-only
# runtime modules remain available to extensions. This wrapper has precedence
# over Volta's native Pi binary while preserving the same installed version.
[[ -x "$HOME/.pi/agent/bin/pi" ]] && export PATH="$HOME/.pi/agent/bin:$PATH"
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


# =========== PORT KILLER ================
function killport {
  local port="$1"
  if [[ -z "$port" ]]; then
    echo "Usage: killport <port>" >&2
    return 1
  fi
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null)
  if [[ -z "$pids" ]]; then
    echo "No process found on port $port"
    return 0
  fi
  echo "Killing process(es) on port $port:"
  echo "$pids" | while read -r pid; do
    local info
    info=$(ps -p "$pid" -o pid=,comm= 2>/dev/null)
    echo "  → PID $info"
    kill -9 "$pid" 2>/dev/null && echo "    ✓ killed" || echo "    ✗ failed (permission denied?)"
  done
}
# =========== END PORT KILLER ================


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


# =========== HERDR TAB HOOKS ================
typeset -g __HERDR_TAB_ID=""

_herdr_tab_id() {
  [[ ${HERDR_ENV:-0} == 1 ]] || return 1
  [[ -n ${HERDR_PANE_ID:-} ]] || return 1
  command -v herdr >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1

  if [[ -z "$__HERDR_TAB_ID" ]]; then
    __HERDR_TAB_ID=$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null | jq -re '.result.pane.tab_id') || {
      __HERDR_TAB_ID=""
      return 1
    }
  fi

  print -r -- "$__HERDR_TAB_ID"
}

_herdr_rename_tab() {
  local label="$1"
  local tab_id

  [[ -n "$label" ]] || return 0
  tab_id=$(_herdr_tab_id) || return 0
  herdr tab rename "$tab_id" "$label" >/dev/null 2>&1 || __HERDR_TAB_ID=""
}

_herdr_tab_preexec() {
  local label="${(j: :)${(z)1}}"
  _herdr_rename_tab "$label"
}

_herdr_tab_precmd() {
  _herdr_rename_tab "${PWD/#$HOME/~}"
}

add-zsh-hook preexec _herdr_tab_preexec
add-zsh-hook precmd _herdr_tab_precmd
add-zsh-hook chpwd _herdr_tab_precmd
# =========== END HERDR TAB HOOKS ================

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

. "$HOME/.cargo/env"




# >>> grok installer >>>
export PATH="$HOME/.grok/bin:$PATH"
fpath=(~/.grok/completions/zsh $fpath)
autoload -Uz compinit && compinit -C
# <<< grok installer <<<

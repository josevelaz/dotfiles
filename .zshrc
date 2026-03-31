source ~/.zsh_secrets.sh

bindkey -v

# Add deno completions to search path
if [[ ":$FPATH:" != *":/Users/josevelazquez/.zsh/completions:"* ]]; then export FPATH="/Users/josevelazquez/.zsh/completions:$FPATH"; fi



function oai-lb {
  docker volume create oai-lb-data
  docker run -d --name oai-lb \
    -p 2455:2455 -p 1455:1455 \
    -v codex-lb-data:/var/lib/codex-lb \
    ghcr.io/soju06/codex-lb:latest
}

export OPENCODE_EXPERIMENTAL_LSP_TOOL=1

# =========== ANTIDOTE ================
source /opt/homebrew/opt/antidote/share/antidote/antidote.zsh

# GIT_WORKING_SHA=adfade31a84dfa512a7e3583d567ee19ac4a7936
# GIT_DIR=$(antidote path marlonrichert/zsh-autocomplete)

# revert Zsh plugin managed by antidote to a prior SHA
# git -C "$GIT_DIR" fetch --unshallow
# git -C "$GIT_DIR" checkout $GIT_WORKING_SHA

antidote load
# =========== END ANTIDOTE ================


# =========== OH MY POSH ================
if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
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

# ============ ZIOXIDE ==============
export _ZO_EXCLUDE_DIRS="$_ZO_EXCLUDE_DIRS:node_modules/*"
eval "$(zoxide init --cmd cd zsh)"
# ============ END ZIOXIDE ==============

# =========== PATHS ================
# Volta
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"

# Local bin
export PATH="$PATH:$HOME/.local/bin"

# mysql-client
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"

# Go bin
export PATH=$PATH:$HOME/go/bin
# =========== END PATHS================
. "/Users/josevelazquez/.deno/env"

# bun completions
[ -s "/Users/josevelazquez/.bun/_bun" ] && source "/Users/josevelazquez/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

. "$HOME/.local/bin/env"

# opencode
export PATH=/Users/josevelazquez/.opencode/bin:$PATH

opencode() {
	OPENCODE_DISABLE_DEFAULT_PLUGINS=1 command /Users/josevelazquez/.opencode/bin/opencode "$@"
}

export PROJECTS=/Users/josevelazquez/projects


tmux-window-name() {
	($TMUX_PLUGIN_MANAGER_PATH/tmux-window-name/scripts/rename_session_windows.py &)
}

add-zsh-hook chpwd tmux-window-name

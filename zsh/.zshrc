# Add deno completions to search path
if [[ ":$FPATH:" != *":/Users/josevelazquez/.zsh/completions:"* ]]; then export FPATH="/Users/josevelazquez/.zsh/completions:$FPATH"; fi

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
  eval "$(oh-my-posh init zsh --config ~/.bubblestheme.omp.yaml)"
fi

# =========== END OH MY POSH ================
export EDITOR=$(which nvim)

alias vim="nvim"
alias nvime="NVIM_APPNAME=nvim-experimental nvim"


# FZF styling
export FZF_DEFAULT_OPTS=$FZF_DEFAULT_OPTS'
--color=fg:#c0caf5,bg:#1a1b26,hl:#ff9e64
--color=fg+:#c0caf5,bg+:#1a1b26,hl+:#ff9e64
--color=info:#7aa2f7,prompt:#7aa2f7,pointer:#db4b4b
--color=marker:#9ece6a,spinner:#9ece6a,header:#9ece6a'


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
export PATH="$PATH:/usr/local/bin/.local"

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

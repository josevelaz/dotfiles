# =========== ZCOMET ================
if [[ ! -f ${ZDOTDIR:-${HOME}}/.zcomet/bin/zcomet.zsh ]]; then
  command git clone https://github.com/agkozak/zcomet.git ${ZDOTDIR:-${HOME}}/.zcomet/bin
fi

source ${ZDOTDIR:-${HOME}}/.zcomet/bin/zcomet.zsh


if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
  eval "$(oh-my-posh init zsh --config ~/.bubblestheme.omp.yaml)"
fi


zcomet load marlonrichert/zsh-autocomplete@main
zcomet load zsh-users/zsh-completions
zcomet load MichaelAquilina/zsh-auto-notify
zcomet load egyptianbman/zsh-git-worktrees@main
zcomet load zsh-users/zsh-syntax-highlighting
zcomet load zsh-users/zsh-autosuggestions
zcomet compinit
# =========== END ZCOMET ================


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

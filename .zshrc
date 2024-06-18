alias zshconfig=“mate ~/.zshrc”

alias nv="nvim"
alias vim="nvim"
alias nvime="NVIM_APPNAME=nvim-experimental nvim"

# Volta
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"

# Local bin
export PATH="$PATH:/usr/local/bin/.local"

# mysql-client
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"

# Go bin
export PATH=$PATH:$HOME/go/bin

export ANTIGEN="$HOME/.antigen"

export TERM="xterm-256color"

# Kitty EDITOR env var - https://sw.kovidgoyal.net/kitty/glossary/#envvar-EDITOR
export EDITOR="nvim"

# Set TERM if tmux
[[ -n $TMUX ]] && export TERM="screen-256color"

# FZF styling
export FZF_DEFAULT_OPTS=$FZF_DEFAULT_OPTS'
--color=fg:#c0caf5,bg:#1a1b26,hl:#ff9e64
--color=fg+:#c0caf5,bg+:#1a1b26,hl+:#ff9e64
--color=info:#7aa2f7,prompt:#7aa2f7,pointer:#db4b4b
--color=marker:#9ece6a,spinner:#9ece6a,header:#9ece6a'

source $HOME/antigen.zsh

antigen use oh-my-zsh

antigen bundles <<EOBUNDLES
    git
    zsh-users/zsh-autosuggestions
    marlonrichert/zsh-autocomplete@main
    zsh-users/zsh-syntax-highlighting
    grigorii-zander/zsh-npm-scripts-autocomplete@main
    zsh-users/zsh-completions
    egyptianbman/zsh-git-worktrees@main
    MichaelAquilina/zsh-auto-notify
EOBUNDLES

antigen theme robbyrussell

antigen apply

bindkey '\t'   complete-word       # tab          | complete
bindkey '\t\t' autosuggest-accept  # shift + tab  | autosuggest

# alias ohmyzsh=“mate ~/.oh-my-zsh”

test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"

export _ZO_EXCLUDE_DIRS="$_ZO_EXCLUDE_DIRS:node_modules/*"
eval "$(zoxide init --cmd cd zsh)"

alias fattcli="cd ~/repos/fatt-scripts/fatt &&"
alias qabuild="fattcli && ./bin/run qa:build-make"
alias qalist="fattcli && ./bin/run qa:build-list"
alias runcli="fattcli && ./bin/run"
alias push="git push origin"
alias zshconfig=“mate ~/.zshrc”
alias itermgeneratetouchbar="cd $ANTIGEN/bundles/zsh-users/zsh-apple-touchbar/ && ruby generate.rb"
alias itermedittouchbar="cd $ANTIGEN/bundles/zsh-users/zsh-apple-touchbar/ && code config.yaml"
alias godotfiles="cd ~/dotfiles"
alias nv="nvim"
alias v="nvim"
alias vim="nvim"

export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
export PATH="/usr/local/opt/mysql@5.7/bin:$PATH"
export PATH="$PATH:/usr/local/bin/.local"
export ANTIGEN="$HOME/.antigen"

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


alias fattcli="cd ~/repos/fatt-scripts/fatt &&"
alias qabuild="fattcli && ./bin/run qa:build-make"
alias qalist="fattcli && ./bin/run qa:build-list"
alias runcli="fattcli && ./bin/run"
alias push="git push origin"
alias zshconfig=“mate ~/.zshrc”
alias itermgeneratetouchbar="cd $ANTIGEN/bundles/zsh-users/zsh-apple-touchbar/ && ruby generate.rb"
alias itermedittouchbar="cd $ANTIGEN/bundles/zsh-users/zsh-apple-touchbar/ && code config.yaml"
alias godotfiles="cd ~/dotfiles"

export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
export PATH="/usr/local/opt/mysql@5.7/bin:$PATH"
export PATH="$PATH:/usr/local/bin/.local"
export ANTIGEN="$HOME/.antigen"

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
    zsh-users/zsh-apple-touchbar
EOBUNDLES

antigen theme robbyrussell

antigen apply

bindkey '\t'   complete-word       # tab          | complete
bindkey '\t\t' autosuggest-accept  # shift + tab  | autosuggest

# alias ohmyzsh=“mate ~/.oh-my-zsh”

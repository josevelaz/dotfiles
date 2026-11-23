function tdlm -a ai ai2
    test -n "$ai"; or begin; echo "Usage: tdlm <c|cx|codex|other_ai> [<second_ai>]"; return 1; end
    set -q TMUX; or begin; echo "You must start tmux to use tdlm."; return 1; end
    set -l base $PWD
    tmux rename-session (basename $base | tr '.:' '--')
    set -l first 1
    for dir in $base/*/
        set dir (string trim -r -c / -- $dir)
        if test $first = 1
            tmux send-keys -t $TMUX_PANE "cd '$dir'; and tdl $ai $ai2" C-m
            set first 0
        else
            set -l pane (tmux new-window -c $dir -P -F '#{pane_id}')
            tmux send-keys -t $pane "tdl $ai $ai2" C-m
        end
    end
end

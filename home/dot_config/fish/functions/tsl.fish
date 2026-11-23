# Tiled tmux swarm running the same command in each pane. Usage: tsl <count> <command>
function tsl -a count_ cmd
    test -n "$count_" -a -n "$cmd"; or begin; echo "Usage: tsl <pane_count> <command>"; return 1; end
    set -q TMUX; or begin; echo "You must start tmux to use tsl."; return 1; end
    set -l dir $PWD
    tmux rename-window -t $TMUX_PANE (basename $dir)
    set -l panes $TMUX_PANE
    while test (count $panes) -lt $count_
        set -a panes (tmux split-window -h -t $panes[-1] -c $dir -P -F '#{pane_id}')
        tmux select-layout -t $panes[1] tiled
    end
    for pane in $panes
        tmux send-keys -t $pane $cmd C-m
    end
    tmux select-pane -t $panes[1]
end

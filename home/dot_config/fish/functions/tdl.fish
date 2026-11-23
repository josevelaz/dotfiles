# tmux dev layout: editor, AI on the right, terminal below. Usage: tdl <ai> [<second_ai>]
function tdl -a ai ai2
    test -n "$ai"; or begin; echo "Usage: tdl <c|cx|codex|other_ai> [<second_ai>]"; return 1; end
    set -q TMUX; or begin; echo "You must start tmux to use tdl."; return 1; end
    set -l dir $PWD
    set -l editor_pane $TMUX_PANE
    tmux rename-window -t $editor_pane (basename $dir)
    tmux split-window -v -p 15 -t $editor_pane -c $dir
    set -l ai_pane (tmux split-window -h -p 30 -t $editor_pane -c $dir -P -F '#{pane_id}')
    if test -n "$ai2"
        set -l ai2_pane (tmux split-window -v -t $ai_pane -c $dir -P -F '#{pane_id}')
        tmux send-keys -t $ai2_pane $ai2 C-m
    end
    tmux send-keys -t $ai_pane $ai C-m
    tmux send-keys -t $editor_pane "$EDITOR ." C-m
    tmux select-pane -t $editor_pane
end

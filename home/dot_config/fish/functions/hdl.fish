function hdl -a ai ai2
    test -n "$ai"; or begin; echo "Usage: hdl <c|cx|codex|other_ai> [<second_ai>]"; return 1; end
    set -q HERDR_PANE_ID; or begin; echo "You must start herdr to use hdl."; return 1; end
    set -l dir $PWD
    set -l editor_pane $HERDR_PANE_ID
    herdr tab rename $HERDR_TAB_ID (basename $dir) >/dev/null
    _herdr_split $editor_pane down 0.85 $dir >/dev/null
    set -l ai_pane (_herdr_split $editor_pane right 0.7 $dir)
    if test -n "$ai2"
        set -l ai2_pane (_herdr_split $ai_pane down 0.5 $dir)
        herdr pane run $ai2_pane $ai2 >/dev/null
    end
    herdr pane run $ai_pane $ai >/dev/null
    herdr pane run $editor_pane "$EDITOR ." >/dev/null
end

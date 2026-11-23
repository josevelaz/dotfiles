# One hdl tab per subdirectory. Usage: hdlm <ai> [<second_ai>]
function hdlm -a ai ai2
    test -n "$ai"; or begin; echo "Usage: hdlm <c|cx|codex|other_ai> [<second_ai>]"; return 1; end
    set -q HERDR_PANE_ID; or begin; echo "You must start herdr to use hdlm."; return 1; end
    set -l base $PWD
    herdr workspace rename $HERDR_WORKSPACE_ID (basename $base) >/dev/null
    set -l hdl_command (string join ' ' -- hdl (string escape -- $ai $ai2))
    set -l first 1
    for dir in $base/*/
        set dir (string trim -r -c / -- $dir)
        if test $first = 1
            herdr pane run $HERDR_PANE_ID "cd "(string escape -- $dir)"; and $hdl_command" >/dev/null
            set first 0
        else
            set -l pane (herdr tab create --workspace $HERDR_WORKSPACE_ID --cwd $dir --no-focus | jq -r .result.root_pane.pane_id)
            herdr pane run $pane $hdl_command >/dev/null
        end
    end
end

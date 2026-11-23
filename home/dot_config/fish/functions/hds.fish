function hds
    test (count $argv) -eq 0; or begin; echo "Usage: hds"; return 1; end
    set -q HERDR_PANE_ID; or begin; echo "You must start herdr to use hds."; return 1; end
    set -l dir $PWD
    set -l editor_pane $HERDR_PANE_ID
    herdr tab rename $HERDR_TAB_ID (basename $dir) >/dev/null
    set -l terminal_pane (_herdr_split $editor_pane down 0.5 $dir)
    set -l diff_pane (_herdr_split $editor_pane right 0.5 $dir)
    set -l opencode_pane (_herdr_split $terminal_pane right 0.5 $dir)
    herdr pane run $editor_pane "nvim ." >/dev/null
    herdr pane run $diff_pane "hunk diff --watch" >/dev/null
    herdr pane run $opencode_pane opencode >/dev/null
end

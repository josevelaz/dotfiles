# herdr swarm grid running the same command in each pane. Usage: hsl <count> <command>
function hsl -a count_ cmd
    test -n "$count_" -a -n "$cmd"; or begin; echo "Usage: hsl <pane_count> <command>"; return 1; end
    set -q HERDR_PANE_ID; or begin; echo "You must start herdr to use hsl."; return 1; end
    set -l dir $PWD
    herdr tab rename $HERDR_TAB_ID (basename $dir) >/dev/null
    # ceil(sqrt(count)) columns, rows spread evenly across them
    set -l cols 1
    while test (math "$cols * $cols") -lt $count_
        set cols (math $cols + 1)
    end
    set -l columns $HERDR_PANE_ID
    # Guarded: BSD seq counts down for `seq 1 0`.
    if test $cols -gt 1
        for k in (seq 1 (math $cols - 1))
            set -a columns (_herdr_split $columns[-1] right (_herdr_ratio 1 (math $cols - $k + 1)) $dir)
        end
    end
    set -l panes
    for index in (seq 0 (math $cols - 1))
        set -l col $columns[(math $index + 1)]
        set -l rows (math "floor($count_ / $cols)")
        test $index -lt (math "$count_ % $cols"); and set rows (math $rows + 1)
        set -a panes $col
        set -l last $col
        if test $rows -gt 1
            for j in (seq 1 (math $rows - 1))
                set last (_herdr_split $last down (_herdr_ratio 1 (math $rows - $j + 1)) $dir)
                set -a panes $last
            end
        end
    end
    for pane in $panes
        herdr pane run $pane $cmd >/dev/null
    end
end

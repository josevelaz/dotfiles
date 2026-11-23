function __herdr_tab_id
    test "$HERDR_ENV" = 1; and set -q HERDR_PANE_ID; or return 1
    command -q herdr; and command -q jq; or return 1
    if test -z "$__HERDR_TAB_ID"
        set -g __HERDR_TAB_ID (herdr pane get $HERDR_PANE_ID 2>/dev/null | jq -re .result.pane.tab_id)
        or begin
            set -g __HERDR_TAB_ID ""
            return 1
        end
    end
    echo $__HERDR_TAB_ID
end

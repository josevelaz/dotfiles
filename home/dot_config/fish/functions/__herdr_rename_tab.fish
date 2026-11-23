function __herdr_rename_tab -a label
    test -n "$label"; or return 0
    set -l tab_id (__herdr_tab_id); or return 0
    herdr tab rename $tab_id $label >/dev/null 2>&1; or set -g __HERDR_TAB_ID ""
end

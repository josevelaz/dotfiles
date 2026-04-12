#!/usr/bin/env bash

set -euo pipefail

# Derive script path relative to this test file so the repo can live anywhere.
_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_DIR="$(cd "$_TEST_DIR/.." && pwd)"
SCRIPT="$_REPO_DIR/.local/bin/tmux-sessionizer"
unset _TEST_DIR _REPO_DIR

to_tilde_path() {
    local path="$1"
    printf '~/%s\n' "${path#"$HOME"/}"
}

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_not_line() {
    local haystack="$1"
    local needle="$2"

    while IFS= read -r line; do
        if [[ "$line" == "$needle" ]]; then
            fail "expected not to find exact line [$needle] in [$haystack]"
        fi
    done <<< "$haystack"
}

assert_contains() {
    local haystack="$1"
    local needle="$2"

    if [[ "$haystack" != *"$needle"* ]]; then
        fail "expected to find [$needle] in [$haystack]"
    fi
}

make_stub_bin() {
    local stub_dir="$1"

    mkdir -p "$stub_dir"

    cat > "$stub_dir/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${TMUX_TEST_LOG:?}"
STATE_FILE="${TMUX_TEST_STATE:?}"
WINDOW_STATE_FILE="${TMUX_WINDOW_STATE:-}"
PANE_STATE_FILE="${TMUX_PANE_STATE:-}"

touch "$STATE_FILE"

cmd="$1"
shift || true

printf 'tmux %s %s\n' "$cmd" "$*" >> "$LOG_FILE"

case "$cmd" in
list-sessions)
    while IFS='|' read -r name dir; do
        [[ -n "$name" ]] || continue
        if [[ "$1" == "-F" ]]; then
            format="$2"
            printf '%s\n' "${format//\#\{session_name\}/$name}"
        else
            printf '%s: 1 windows\n' "$name"
        fi
    done < "$STATE_FILE"
    ;;
new-session)
    session_name=''
    session_dir=''
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
        -ds)
            session_name="$2"
            shift 2
            ;;
        -c)
            session_dir="$2"
            shift 2
            ;;
        *)
            shift
            ;;
        esac
    done

    printf '%s|%s\n' "$session_name" "$session_dir" >> "$STATE_FILE"
    ;;
neww)
    target=''
    target_dir=''
    target_cmd=''

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
        -dt)
            target="$2"
            shift 2
            ;;
        -c)
            target_dir="$2"
            shift 2
            ;;
        *)
            target_cmd="$1"
            shift
            ;;
        esac
    done

    if [[ -n "$WINDOW_STATE_FILE" ]]; then
        printf '%s|%s|%s\n' "$target" "$target_dir" "$target_cmd" >> "$WINDOW_STATE_FILE"
    fi
    ;;
attach-session|switch-client|select-window|send-keys)
    ;;
display-message)
    if [[ "${1:-}" == "-p" && "${2:-}" == '#{pane_current_path}' ]]; then
        printf '%s\n' "${TMUX_CURRENT_PATH:-$HOME}"
    else
        printf 'current\n'
    fi
    ;;
list-panes)
    ;;
has-session)
    exit 1
    ;;
split-window)
    split_dir=''
    split_cmd=''

    while [[ "$#" -gt 0 ]]; do
        case "$1" in
        -c)
            split_dir="$2"
            shift 2
            ;;
        -P|-F|-h|-v)
            if [[ "$1" == "-F" ]]; then
                shift 2
            else
                shift
            fi
            ;;
        *)
            split_cmd="$1"
            shift
            ;;
        esac
    done

    if [[ -n "$PANE_STATE_FILE" ]]; then
        printf '%s|%s\n' "$split_dir" "$split_cmd" >> "$PANE_STATE_FILE"
    fi
    printf '%%1\n'
    ;;
*)
    ;;
esac
EOF

    cat > "$stub_dir/fzf" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
printf '%s' "$input" > "${FZF_INPUT_LOG:?}"
first_line="${input%%$'\n'*}"
if [[ -n "$first_line" ]]; then
    printf '%s\n' "$first_line"
fi
EOF

    cat > "$stub_dir/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

    chmod +x "$stub_dir/tmux" "$stub_dir/fzf" "$stub_dir/pgrep"
}

run_specific_directory_test() {
    local tmpdir home_dir stub_dir target_dir output session_line tmux_log

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"
    target_dir="$home_dir/projects/app"

    mkdir -p "$target_dir"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export FZF_INPUT_LOG="$tmpdir/fzf.log"

    output="$("$SCRIPT" "$target_dir")"
    assert_contains "$output" ""

    session_line="$(grep '^app|' "$TMUX_TEST_STATE" || true)"
    assert_contains "$session_line" "app|$target_dir"

    tmux_log="$(<"$TMUX_TEST_LOG")"
    assert_contains "$tmux_log" "tmux send-keys -t app cd $target_dir c-M"
}

run_trailing_slash_search_test() {
    local tmpdir home_dir stub_dir parent_dir child_a child_b session_line fzf_input config_dir first_choice selected_path selected_name

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"
    parent_dir="$home_dir/projects"
    child_a="$parent_dir/alpha"
    child_b="$parent_dir/beta"

    mkdir -p "$child_a" "$child_b"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export FZF_INPUT_LOG="$tmpdir/fzf.log"

    config_dir="$home_dir/.config/tmux-sessionizer"
    mkdir -p "$config_dir"
    printf 'TS_SEARCH_PATHS=(%q)\n' "$parent_dir/" > "$config_dir/tmux-sessionizer.conf"

    "$SCRIPT" >/dev/null

    fzf_input="$(<"$FZF_INPUT_LOG")"
    assert_contains "$fzf_input" "$(to_tilde_path "$child_a")"
    assert_contains "$fzf_input" "$(to_tilde_path "$child_b")"

    assert_not_line "$fzf_input" "$(to_tilde_path "$parent_dir")"

    first_choice="${fzf_input%%$'\n'*}"
    selected_path="$HOME/${first_choice#~/}"
    selected_name="$(basename "$selected_path")"

    session_line="$(grep "^${selected_name}|" "$TMUX_TEST_STATE" || true)"
    assert_contains "$session_line" "${selected_name}|$selected_path"
}

run_home_directory_selection_test() {
    local tmpdir home_dir stub_dir session_line fzf_input

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"

    mkdir -p "$home_dir"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export FZF_INPUT_LOG="$tmpdir/fzf.log"

    config_dir="$home_dir/.config/tmux-sessionizer"
    mkdir -p "$config_dir"
    printf 'TS_SEARCH_PATHS=(%q)\n' "$home_dir" > "$config_dir/tmux-sessionizer.conf"

    "$SCRIPT" >/dev/null

    fzf_input="$(<"$FZF_INPUT_LOG")"
    assert_contains "$fzf_input" "~"

    session_line="$(grep '^home|' "$TMUX_TEST_STATE" || true)"
    assert_contains "$session_line" "home|$home_dir"
}

run_home_prefixed_tilde_path_test() {
    local tmpdir home_dir stub_dir target_dir session_line tmux_log malformed_path

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"
    target_dir="$home_dir/projects/act-strapi"
    malformed_path="$home_dir/~/projects/act-strapi"

    mkdir -p "$target_dir"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export FZF_INPUT_LOG="$tmpdir/fzf.log"

    "$SCRIPT" "$malformed_path" >/dev/null

    session_line="$(grep '^act-strapi|' "$TMUX_TEST_STATE" || true)"
    assert_contains "$session_line" "act-strapi|$target_dir"

    tmux_log="$(<"$TMUX_TEST_LOG")"
    assert_not_line "$tmux_log" "tmux send-keys -t act-strapi cd $malformed_path c-M"
    assert_contains "$tmux_log" "tmux send-keys -t act-strapi cd $target_dir c-M"
}

run_session_command_window_cwd_test() {
    local tmpdir home_dir stub_dir window_state output window_line current_path config_dir

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"
    current_path="$tmpdir/work/current"
    window_state="$tmpdir/window.state"

    mkdir -p "$home_dir" "$current_path"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export TMUX_WINDOW_STATE="$window_state"
    export TMUX_PANE_STATE="$tmpdir/pane.state"
    export TMUX_CURRENT_PATH="$current_path"
    export TMUX=1

    config_dir="$home_dir/.config/tmux-sessionizer"
    mkdir -p "$config_dir"
    cat > "$config_dir/tmux-sessionizer.conf" <<'EOF'
TS_SESSION_COMMANDS=("pwd")
EOF

    output="$($SCRIPT -s 0)"
    assert_contains "$output" ""

    window_line="$(<"$window_state")"
    assert_contains "$window_line" "current:69|$current_path|pwd"
}

run_session_command_split_cwd_test() {
    local tmpdir home_dir stub_dir pane_state output pane_line current_path config_dir

    tmpdir="$(mktemp -d)"
    home_dir="$tmpdir/home"
    stub_dir="$tmpdir/bin"
    current_path="$tmpdir/work/current"
    pane_state="$tmpdir/pane.state"

    mkdir -p "$home_dir" "$current_path"
    make_stub_bin "$stub_dir"

    export HOME="$home_dir"
    export PATH="$stub_dir:$PATH"
    export TMUX_TEST_LOG="$tmpdir/tmux.log"
    export TMUX_TEST_STATE="$tmpdir/tmux.state"
    export TMUX_WINDOW_STATE="$tmpdir/window.state"
    export TMUX_PANE_STATE="$pane_state"
    export TMUX_CURRENT_PATH="$current_path"
    export TMUX=1

    config_dir="$home_dir/.config/tmux-sessionizer"
    mkdir -p "$config_dir"
    cat > "$config_dir/tmux-sessionizer.conf" <<'EOF'
TS_SESSION_COMMANDS=("pwd")
EOF

    output="$($SCRIPT -s 0 --vsplit)"
    assert_contains "$output" ""

    pane_line="$(<"$pane_state")"
    assert_contains "$pane_line" "$current_path|pwd"
}

run_specific_directory_test
run_trailing_slash_search_test
run_home_directory_selection_test
run_home_prefixed_tilde_path_test
run_session_command_window_cwd_test
run_session_command_split_cwd_test

printf 'tmux-sessionizer tests passed\n'

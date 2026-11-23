# OpenChamber Desktop probes the login shell with `env -0`. Point only that
# probe at the shared OpenCode service; never export its password to normal shells.
if test (uname) = Darwin; and not status is-interactive
    set -l ppid (ps -o ppid= -p $fish_pid 2>/dev/null | string trim)
    if test -n "$ppid"; and test "$(ps -o comm= -p $ppid 2>/dev/null)" = /Applications/OpenChamber.app/Contents/MacOS/OpenChamber
        set -l host (opencode service status 2>/dev/null)
        if string match -qr '^http://127\.0\.0\.1:\d+$' -- $host
            set -l password (python3 -c 'import json, pathlib; print(json.loads((pathlib.Path.home() / ".config/opencode/service.json").read_text())["password"])' 2>/dev/null)
            if test -n "$password"
                set -gx OPENCODE_HOST $host
                set -gx OPENCODE_SKIP_START true
                set -gx OPENCODE_SERVER_USERNAME opencode
                set -gx OPENCODE_SERVER_PASSWORD $password
            end
        end
    end
end

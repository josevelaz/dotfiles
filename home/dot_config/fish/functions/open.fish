# macOS has a native open; elsewhere open with the desktop's default app.
function open
    if test (uname) = Darwin
        command open $argv
    else
        xdg-open $argv >/dev/null 2>&1 &
        disown
    end
end

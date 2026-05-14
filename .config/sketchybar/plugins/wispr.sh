#!/bin/sh

osascript -e "
tell application \"System Events\"
    tell process \"Wispr Flow\"
        click menu bar item 1 of menu bar 2
    end tell
end tell
"

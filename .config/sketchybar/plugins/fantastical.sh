#!/bin/sh

osascript -e "
tell application \"System Events\"
    tell process \"Fantastical Helper\"
        click menu bar item \"Fantastical\" of menu bar 2
    end tell
end tell
"

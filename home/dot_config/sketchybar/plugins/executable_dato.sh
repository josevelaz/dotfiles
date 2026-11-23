#!/bin/sh

osascript -e "
tell application \"System Events\"
    -- Find and click the Dato menubar item
    try
        tell process \"Dato\"
            click menu bar item 1 of menu bar 1
        end tell
    on error
        -- If the above doesn't work, try alternative approach
        tell application process \"SystemUIServer\"
            click (menu bar item 1 of menu bar 1 whose description contains \"Dato\")
        end tell
    end try
end tell"

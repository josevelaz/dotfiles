#!/bin/sh

osascript -e "
tell application \"Tunnelblick\" 
	set currentState to (get state of first configuration where name = \"main\")
	if currentState is \"EXITING\" then
		connect \"main\"
	else
		disconnect all
	end if
end tell
"

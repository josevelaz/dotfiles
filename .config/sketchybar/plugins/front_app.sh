#!/bin/sh

# Some events send additional information specific to the event in the $INFO
# variable. E.g. the front_app_switched event sends the name of the newly
# focused application in the $INFO variable:
# https://felixkratz.github.io/SketchyBar/config/events#events-and-scripting

ITEM_NAME="${NAME:-front_app}"
YABAI_BIN="yabai"

APP_NAME="$INFO"

if [ -z "$APP_NAME" ]; then
  APP_NAME="$($YABAI_BIN -m query --windows --window 2>/dev/null | jq -r '.app // empty')"
fi

if [ -z "$APP_NAME" ]; then
  sketchybar --set "$ITEM_NAME" drawing=off background.drawing=off label=""
else
  sketchybar --set "$ITEM_NAME" drawing=on background.drawing=on label="$APP_NAME"
fi

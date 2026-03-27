#!/bin/bash

ITEM_NAME="${NAME:-music}"

if [ "$(osascript -e 'application "YouTube Music" is running' 2>/dev/null)" != "true" ]; then
  sketchybar --set "$ITEM_NAME" drawing=off label=""
  sketchybar --set "$ITEM_NAME"-artwork drawing=off background.image=""
  exit 0
fi

SONG_INFO=$(curl -s 0.0.0.0:26538/api/v1/song-info)

if [ -z "$SONG_INFO" ] || [ "$SONG_INFO" = "null" ]; then
  sketchybar --set "$ITEM_NAME" drawing=on label="Opening YouTube Music..." icon="􁁒"
  sketchybar --set "$ITEM_NAME"-artwork drawing=off background.image=""
  exit 0
fi

PAUSED="$(echo "$SONG_INFO" | jq -r '.isPaused')"
CURRENT_SONG="$(echo "$SONG_INFO" | jq -r '.title + " - " + .artist')"
ARTWORK="$(echo "$SONG_INFO" | jq -r '.imageSrc')"
ARTWORK_LOCATION=""

if [ -n "$ARTWORK" ] && [ "$ARTWORK" != "null" ]; then
  ARTWORK_LOCATION="$(curl -O --output-dir "$TMPDIR" -s --remote-name -w "%{filename_effective}" "$ARTWORK")"
fi

if [ "$PAUSED" = true ]; then
  ICON=􀊄
else
  ICON=
fi
sketchybar --set "$ITEM_NAME" label="$CURRENT_SONG" icon="$ICON" drawing=on

if [ -n "$ARTWORK_LOCATION" ] && [ -f "$ARTWORK_LOCATION" ]; then
  sketchybar --set "$ITEM_NAME"-artwork drawing=on background.drawing=on background.image="$ARTWORK_LOCATION"
else
  sketchybar --set "$ITEM_NAME"-artwork drawing=off
fi

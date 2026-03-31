#!/bin/sh

BATTERY_INFO="$(pmset -g batt)"
PERCENTAGE="$(printf '%s\n' "$BATTERY_INFO" | grep -Eo '[0-9]+%' | cut -d% -f1 | head -n 1)"

if [ -z "$PERCENTAGE" ]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

if [ "$PERCENTAGE" -eq 100 ]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

CHARGING="$(printf '%s\n' "$BATTERY_INFO" | grep 'AC Power')"

case "${PERCENTAGE}" in
  9[0-9]|100) ICON=""
  ;;
  [6-8][0-9]) ICON=""
  ;;
  [3-5][0-9]) ICON=""
  ;;
  [1-2][0-9]) ICON=""
  ;;
  *) ICON=""
esac

if [ -n "$CHARGING" ]; then
  ICON=""
fi

# The item invoking this script (name $NAME) will get its icon and label
# updated with the current battery status
sketchybar --set "$NAME" drawing=on icon="$ICON" label="${PERCENTAGE}%"

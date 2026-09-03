---
name: macos-screenshots
description: Take macOS screenshots with the built-in screencapture tool. Use when the user asks for a screenshot, asks the agent to look at or verify what is on screen, or wants a display, a screen region, or a window saved to a file or the clipboard.
---

# macOS screenshots

`screencapture` ships with macOS and writes a PNG in one shot. No install, no extra tools.

Run it, then read the file back and confirm the pixels answer the question.

## Grant the capture permission first

The capturing process is the terminal or agent app that runs the command, not `screencapture` itself. Without Screen Recording permission the file still appears, but it holds only the desktop picture and window frames.

Test with a small rect and look at the result. If windows are missing, ask the user to add the host app under System Settings > Privacy & Security > Screen & System Audio Recording, then restart that app.

## Capture

Always pass `-x` in an agent run; it silences the shutter sound.

| Goal | Command |
| --- | --- |
| Main display | `screencapture -x -D 1 shot.png` |
| Second display | `screencapture -x -D 2 shot.png` |
| Every display | `screencapture -x one.png two.png` (one file per screen, in display order) |
| Screen region | `screencapture -x -R 0,0,1200,120 strip.png` |
| One window | `screencapture -x -o -l <windowid> window.png` |
| To the clipboard | `screencapture -x -c -R 0,0,1200,120` |
| After a delay | `screencapture -x -T 3 shot.png` |

Useful flags: `-C` draws the cursor, `-o` drops the window shadow, `-t jpg` changes the format, `-v` records video instead.

Skip `-i`, `-w`, and `-W`. They block until a human clicks.

## Aim with the rect

`-R x,y,w,h` uses one desktop coordinate space, in points:

- The origin is the top-left corner of the **main** display. `x` grows right, `y` grows down.
- Other displays sit at an offset, and that offset can be negative.
- `-R` wins over `-D`. A rect plus a display flag still captures the rect.
- Output pixels equal points times the backing scale of the display under the rect. A 400x200 rect gives 400x200 pixels on a 1x display and 800x400 on a Retina display.

`scripts/screens.swift` prints each screen's frame and scale in AppKit coordinates:

```sh
swift scripts/screens.swift
```

AppKit measures `y` up from the bottom of the main display, so convert:

```
rect_y = main_height - screen_max_y
```

For a main display 1440 points tall and a screen whose AppKit frame is `3440,-703 1728x1117`, the top-left corner is `-R 3440,1026,...`.

## Target a window

`scripts/windows.swift` prints `id`, owning app, and title for every on-screen window:

```sh
swift scripts/windows.swift | grep -i ghostty
screencapture -x -o -l 3521 window.png
```

Window ids change on every launch. Look them up in the same run that captures.

## Read what you captured

A full-width capture is downscaled to fit the image reader, so fine text turns to mush.

- Capture the tight rect you care about instead of the whole display.
- Enlarge before reading: `sips -Z 1200 strip.png --out strip-big.png`.
- Compare a claim against pixel coordinates when a layout question is on the table: measure gaps and item widths in the file rather than trusting the thumbnail.

---
name: product-demo-video
description: Make a short, looping, muted product demo video of a web app from real recorded interaction. Use when the user asks for a product demo, app walkthrough, feature tour, or landing-page hero video of software they built, or wants an existing demo video remade.
---

# Product demo video

Record the real app running locally, compose the captures in Remotion inside a
designed browser frame, and ship a small mp4/webm loop with a poster. The look
is calm and premium (Apple or Linear restraint), not a kinetic quick-cut.

Helpers in this folder:

| File | Purpose |
| --- | --- |
| `reference/BRIEF-TEMPLATE.md` | Brief skeleton: placement, story, rules, verification |
| `scripts/capture-lib.mjs` | Playwright helpers: open, clean, audit, frame recorder, typing, eased scroll |
| `scripts/capture-example.mjs` | One scene captured end to end with those helpers |
| `scripts/Demo.tsx` | Reference Remotion composition: window, camera zooms, cursor, captions, `PushTransition`, loop |
| `scripts/encode.sh` | Two-pass H.264 + VP9 encode and frame-0 poster |
| `scripts/verify.sh` | ffprobe, faststart, contact sheets, legibility downscales, loop SSIM, cut check, push and loop-wrap strips |

## 1. Write the brief from the placement

Start from where and how the video is shown, and write it into the brief
(`reference/BRIEF-TEMPLATE.md`):

- Page, slot, aspect ratio, radius, and the background around it.
- Real display widths, for example ~620 px in a desktop grid and ~340 px on a
  phone. Legibility is judged at those widths, not at 1920.
- Playback: `<video autoplay muted loop playsinline poster>`. No sound, no
  controls, and it loops forever, so the end must flow into frame 0.
- Audience and attention span. Viewers give it 3-5 s, so the first 2 s hook
  and frame 0 doubles as the poster.
- The hero feature. Lead with it and give it roughly half the runtime.
- Brand palette and fonts from the host page's CSS.

Defaults: 16:10, 1920x1200, 30 fps, 30-40 s, mp4 and webm each under ~8 MB.

## 2. Run the app locally on demo data

- Run the app on the box with its own local database seeded with fictional
  people and data. Never use production, real customer data, or real accounts.
  Sign in through the local flow (for example a local OTP inbox) and reuse a
  saved Playwright `storageState`.
- If the app needs a secret (for example an AI gateway key for real AI
  answers), pull it into a gitignored local env file without printing it, and
  remove it when recording is done.
- Commit nothing to the app repo. Back up the local DB file before editing it,
  and list every local change (table, row, column, old -> new) in the report.
- Clean junk in data, not code: unverifiable claims, raw ids, placeholder rows,
  leftover drafts and test chats. If junk is hard-coded in source, pick routes
  where it does not render instead of patching source.
- Grep the visible text of every recorded state for forbidden strings (raw
  ids, placeholder labels, other clients' names). `audit()` logs this.

## 3. Record real interaction

- Viewport 1440x900 at `deviceScaleFactor: 2`, `reducedMotion: 'reduce'`,
  `--hide-scrollbars`. Shown at ~1.19x in the frame, the DPR-2 pixels stay
  sharp up to a 1.6x zoom.
- Capture frame-by-frame screenshots of real states rather than a screen
  video: navigate, click, type a few characters per frame, wait for the real
  response, and screenshot each state. Log each frame with its phase.
- Record the bounding box of everything the cursor will touch. The composition
  draws a designed cursor that moves between those boxes; the clicks
  themselves happen for real in Playwright.
- Scrolls: one screenshot per video frame on an eased curve (window scroll), or
  small fixed steps of an inner scroller (chat logs).
- Wait for real responses (real AI answers): poll until "Working..." style
  text is gone and the DOM text length is stable for ~1.5 s.
- Hide carets, dev overlays, devtools buttons, floating launchers, "jump to
  latest" pills, and setup warnings with injected CSS and DOM tweaks
  (`clean()`), never with code changes.

## 4. Storyboard, then compose

Write `storyboard.md` before building: a motif list, a shot table
(time | duration | shot | composition | text entrance | hand-off), an
anti-repetition check of durations and compositions, and a poster test (every
hold frame reads as a finished still).

Compose in Remotion (`scripts/Demo.tsx`). Every pixel is a pure function of the
frame number: no CSS animation, no randomness, no state across frames.

- **Full screens.** Show the whole viewport (sidebar, header, page) inside a
  simple designed browser window, about 89% of the frame width, on the brand
  background: rounded corners, a soft shadow, a thin top bar with three muted
  dots and a neutral domain label. No real browser chrome or localhost URL.
  Tight crops of single panels read as too simplistic.
- **Camera.** Static by default. To focus, ease in from the full screen
  (~0.8 s cubic in-out, ~1.4-1.6x), hold while the thing happens, and ease back
  out to the full screen. Keep the window covering the frame while zoomed.
  One move at a time; never pan or zoom directly between two spots.
- **Cursor.** A designed arrow with eased moves of at most 0.6 s that arrive
  just before each click, a slight press, and a soft accent-colour ring.
- **Transitions.** One uniform transition for every scene change and the
  loop: a directional push (`PushTransition`). The outgoing screen
  translates off along one axis while the incoming one enters edge to edge
  from the opposite side. Use one axis and direction for the whole video, and
  push the whole screen (background, window, cursor, caption) as a unit. Add
  real axis-aligned motion blur tied to velocity: temporal sub-frame
  accumulation plus an axis-only `feGaussianBlur`. It is heavy mid-move and
  zero at rest, so the first and last frames of the push match the held
  frames. Use a strong ease (expo or quint in-out) over 0.5-0.7 s (18 frames
  at 30 fps). Never fade, dip or crossfade; those read as basic. No hard cuts
  between scenes. Hard cuts only for natural UI changes inside a scene
  (clicks, page navigation, replies landing).
- **Captions.** Four to six small pills of 2-5 words, one accent word,
  overlaying the app without shrinking it. No caption-beside-snippet layouts.
  Move a pill if it covers the text being shown. Captions and the cursor ride
  the push. A caption that enters or leaves mid-scene uses the same push on
  its own.
- **Loop.** The last push takes the end card out with the opening scene as
  the incoming screen, and ends exactly at `durationInFrames`. Frame 0 is the
  settled opening state (the poster), and the wrap happens on the push's
  final step.
- **Story.** Hook on the hero feature's payoff, give context (public site,
  dashboard), run the hero flow for real, show supporting pages, then the end
  card.

## 5. Encode

`scripts/encode.sh master.mp4 out/demo` renders from a high-quality master
(`npx remotion render <Comp> master.mp4 --crf=10`) to:

- H.264 High, yuv420p, `+faststart`, no audio, two-pass (~1550k, maxrate 2x).
- VP9, yuv420p, no audio, two-pass (~1450k, maxrate 2900k).
- A poster JPEG of frame 0.

Lower the bitrate if a file is over ~8 MB. The motion blur costs bitrate, so
the two-pass targets may need to come down ~5%. Check text crispness on
frames extracted from the encoded files, not just the master.

## 6. Verify

`PUSHES="66 201 ..." scripts/verify.sh out/demo.mp4 out/demo.webm out/demo-poster.jpg`
writes into `verify/`. `PUSHES` lists every push start frame, including the
loop push and caption slides. Then view the images yourself:

1. ffprobe: size, codecs, pixel format, fps, duration, no audio stream, `moov`
   before `mdat`, both files under ~8 MB, poster equal to frame 0.
2. A contact sheet of one frame per second, plus frames on both sides of every
   detected cut. Look for doubled text, stray overlays, raw ids, warnings,
   and clipped captions.
3. Every push strip (`push_<frame>.jpg`), frame by frame. The blur runs only
   along the push axis. It is heavy mid-move and zero at rest, with the end
   frames identical to the holds. Check for no ghosting or doubled UI, no gap
   frame, and no fade.
4. Legibility: downscale one frame per scene, including every zoom hold, to the
   real widths (620 and 340 px). Captions and the focused detail must read at
   620; the gist must read at 340.
5. Loop: `loop_wrap.jpg` (the last ~20 frames, then frames 0-9) must read as
   one push landing on a held frame 0. The last frame is mid-move, so its
   SSIM against frame 0 is lower (~0.93); that is expected.
6. The forbidden-string audit log is clean for every state used.
7. A video-review pass of the whole piece, for example a model that can watch
   video, against the brief.

Sampling at 1 fps can make a 0.8 s zoom look like a hard cut. Check any
suspected cut at frame level (`verify.sh` prints scene-change scores and marks
those inside a push as expected; inspect the rest) before "fixing" it.

Open issue: each screen's own background margins show as a dark smear between
the windows mid-push. If that reads as a gap, push only the content inside a
fixed window, but then the hook and end card must match that framing.

## Building it with an agent

For the design and build, a Claude Code session on Opus works well: hand it
the brief and let it run autonomously to a self-verified render and a
`REPORT.md`. Optionally install a motion-skills pack for storyboard method,
easing curves, and contact-sheet tooling, for example tweenkit
(`github.com/wmzspace/claude-motion-skills`, skill `kinetic-cut-video`). Tell
the agent to override its loud defaults: no flash, chromatic aberration, glow,
camera punch or shake, music, or one-shot-per-second pacing.

## Report

The report lists output paths and ffprobe specs, the scene table with times,
the hero-feature share of runtime, each zoom (times, target, scale, easing),
each transition, every local data change, and verification results with image
paths.

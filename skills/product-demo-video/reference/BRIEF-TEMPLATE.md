# Demo video brief: <product> / <feature>

Fill every field before recording. Delete hints in angle brackets.

## Placement
- Page and slot: <e.g. landing page hero, right column of a two-column section>
- Display widths: desktop <e.g. 620> px, mobile <e.g. 340> px
- Playback: autoplay, muted, loop, playsinline; poster shown until it plays
- Audience: <who watches and what they already know>
- Hero feature: <the one thing they must see in the first 5 s>
- Brand: background <hex>, accent <hex>, font <name>, domain shown in frame <example.com>

## Story (30-40 s)
| # | Time | Screen | Action | Zoom target | Caption |
|---|------|--------|--------|-------------|---------|
| 1 | 0-8 s | <hero screen> | <real click / typed prompt / AI answer> | <element> | <3-5 words> |
| 2 | ... | ... | ... | ... | ... |
| end | last 2 s | end card or first frame | settle for seamless loop | none | none |

## Local-only rules
- Run the app locally against a seeded fictional database. Never production, never real customer data.
- Secrets live in a gitignored env file; never print them; delete it afterwards.
- Commit nothing to the app repo. All capture and render work lives outside it.
- Every name, email, and figure on screen is fictional. List strings that must never appear: <regex>.

## Visual rules
- Full app screens inside a designed browser frame on the brand background.
- Capture 1440x900 at device scale factor 2; carets, toasts, dev overlays hidden by injected CSS.
- Static camera. Eased zooms (~0.8 s, 1.4-1.6x), one at a time, no pans.
- Transitions: one uniform directional push for every scene change and the loop. The whole screen moves as a unit, with one axis and direction (<e.g. x, to the left>) for the whole video. Axis-only motion blur tied to velocity, expo/quint in-out, ~0.6 s (18 frames). Never fades, dips or crossfades; no hard cuts between scenes. Hard cuts only for natural UI changes inside a scene (clicks, replies landing).
- Few captions, short pills. Readable at the mobile width. Captions and the cursor ride the push; mid-scene caption entrances and exits use the same push.
- Seamless loop: the last push brings the opening scene in and ends at the last frame, so frame 0 is the settled opening state (poster).

## Deliverables
- `<name>.mp4`: H.264 High, yuv420p, faststart, no audio, under 8 MB
- `<name>.webm`: VP9, no audio, under 8 MB
- `<name>-poster.jpg`: frame 0
- 1920x1200 (16:10), 30 fps, 30-40 s

## Verification
- ffprobe specs, no audio stream, sizes, faststart atom order
- Contact sheet, frame-level check of every detected cut (1 fps sampling can mistake zooms for cuts)
- Every-frame strip of each push and of the loop wrap: blur only along the axis, zero at rest, no ghosting, gap frame or fade
- Legibility downscales at both display widths, including zoom holds
- Poster SSIM >= 0.98; loop last-vs-first SSIM ~0.93 is expected with a push loop (judge the wrap strip)
- Forbidden-string scan (DOM audit at capture plus OCR on output)
- Watch the full video once at display size

## Report
Paths, durations, sizes, SSIM numbers, cuts list, any deviations from this brief.

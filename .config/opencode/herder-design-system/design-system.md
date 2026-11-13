# Trailhead — Herder Design System

Complete text capture of the artifact **Trailhead — Herder Design System**. The README is transcribed below; the token reference is generated from the downloaded `tokens.json` export (v3). Token values are reported as supplied (hex, rgba, references, or CSS values); the export contains no OKLCH entries.

## Overview document

Trailhead is the design system for Herder, the front desk for solo and small dog-training businesses. **Paper & ink**: a modern phone app — app bars, tab bar, cards, lists, sheets — made of paper and written in ink, with three marks from the trainer's own kit: **pen circles, sticky notes and stamps**. It should feel calm, outdoorsy and personal — a well-kept notebook turned into a working tool, never a corporate dashboard, never cute. It is mobile-first, WCAG AA in light and dark, and built to be read outdoors by a trainer with a leash in one hand.

There is no logo or wordmark yet (the product name isn't final). Where a brand mark would go, set the product or the trainer's business name in plain text with Fraunces.

## Paper and ink

The layout is a standard app; the materials are what make it Herder.

- **Paper.** The screen is oat paper (`bg`). Cards are sheets lying on it (`surface`, hairline `border`, 10px corners, flat). Fields, sheets, toasts and the one card that matters most are fresh paper (`surface-raised`). Nothing tilts except the trainer's own sticky note.
- **Ink.** Text is ink-dark pine (`text`). Structure is drawn in ink: a 1.5px ink rule (`ink-rule`) over every list, ink edges on buttons, a double rule above every total.
- **Pen-voice labels.** Section labels are Fraunces italic in pine ("Needs you", "This week", "Morning") instead of uppercase small caps — the one place the system writes like a person.
- **Hand-drawn lines.** The line between list items is a slightly uneven pen line (`rule`), drawn with the same mask technique as the pen marks.

## The three marks

Each mark has **one job**, so they read instantly and never compete.

| Mark | Means | Where |
| --- | --- | --- |
| **Pen circle / underline** (clay `pen`) | Selected, current, or needs your eye now | The name in a greeting, the amount to collect, the chosen day, today on a tracker, the current tab and tab-bar section |
| **Sticky note** | A note, not a record | AI drafts waiting for review (sage); the trainer's note to a client (clay, Fraunces italic, the only tilt) |
| **Stamp** | Status, in a word or two | Small stamps in rows and cards (Paid, Unsigned, New inquiry); a big double-ruled stamp at the moment something is done (Deposit paid, Paid · Oct 29, Signed) |

Two or three pen marks per screen at most, one big stamp at most. Every mark is backed by text, colour and state (`aria-pressed`, `aria-current`, `aria-selected`), so nothing depends on the mark alone. Marks are drawn as SVG masks painted with a token, so they work in both themes.

## What you can press

Paper must never make it hard to tell what can be tapped.

1. **Buttons are pressable labels**: a solid fill, an ink edge and a 2px ink edge underneath; pressed, they sink onto it. Nothing else has that under-edge. Clay (`accent`) for the one call to action on a screen, pine (`primary`) for the trainer's decisions, paper outline for secondary choices, underlined ghost text for the low-stakes way out.
2. **Lists are written on the page** under a ledger rule, with pen lines between items. **A row that opens something ends in a chevron**; nothing else has a chevron.
3. **Stamps are never tappable.** Outline, no fill, worn ink.
4. **Pen marks never go on pressable things.** A selected time slot or segment is filled pine; a selected day or tab is circled or underlined.
5. **Links are underlined.** No action is ever coloured text alone.

## AI drafts

Herder drafts replies, session notes, homework and invoices. **A draft is a sage sticky note, never part of the record.**

- The dashed stamp "AI draft · review before sending" and where it came from ("Drafted from your 1:48 voice memo · 1 detail to check").
- Facts the AI pulled out are highlighted so the trainer can check them.
- Approve & send / Send (pine), Edit (outline), Discard or Dismiss (ghost). Approving takes the sticky off: the content becomes an ordinary card or bubble with a pine "Sent to Dana · 4:04 PM" stamp.
- Nothing AI-written reaches a client without an explicit tap: no timers, no auto-approve. Clients only ever see approved content.

## Type

**Fraunces** (soft, slightly wonky optical serif) for headings, figures and the pen voice; **Nunito Sans** for everything you read and tap.

| Style | Font | Size / line | Use |
| --- | --- | --- | --- |
| `hd-hero` | Fraunces 600 | 40 / 44 | Greeting ("Morning, Maya") |
| `hd-h1` | Fraunces 600 | 28 / 34 | Screen titles |
| `hd-h2` | Fraunces 600 | 22 / 28 | Card titles, sheet titles |
| `hd-h3` | Fraunces 600 | 19 / 24 | Sub-sections |
| `hd-amount` | Fraunces 500, tabular | 32 / 36 | Money and big figures |
| `hd-overline` | Fraunces 600 italic, pine | 17 / 22 | Pen-voice section labels |
| body | Nunito Sans 400 | 17 / 26 | Reading text, messages |
| `hd-label-text` | Nunito Sans 700 | 17 / 22 | Row titles, button labels |
| `hd-small` | Nunito Sans | 15 / 22 | Second lines, help |
| `hd-caption` | Nunito Sans 600 | 13 / 18 | Times, meta |
| stamp | Nunito Sans 800 caps | 12 / 16 | Small stamps |

Body never goes below 15px; inputs are 17px. Write sizes in rem in product code so everything scales with the reader's text size.

## Colour, light and dark

Four named hues, each an 11-step scale (50–950): **pine** (primary, ink), **sage** (secondary, the app and AI), **clay** (accent, calls to action, the pen), **oat** (paper), plus success, warning, danger and info. UI code uses the semantic tokens, never the raw scale.

**Dark mode** is the same notebook at night: deep pine-black paper, cards a step lighter, oat ink, and lighter pine, sage and clay so every pair still passes. It follows the system setting, and `data-theme="light|dark"` on the root forces either. Sticky notes and stamps keep their meaning and shape in both.

Measured contrast (WCAG 2.x), light / dark:

| Foreground | Background | Light | Dark |
| --- | --- | --- | --- |
| `text` | `bg` | 13.7:1 | 14.8:1 |
| `text-muted` | `bg` | 6.6:1 | 8.5:1 |
| `text-muted` | `sticky-sage` | 6.7:1 | 7.0:1 |
| `text` | `sticky-clay` | 13.7:1 | 12.1:1 |
| `text-subtle` | `surface-raised` | 5.4:1 | 4.9:1 |
| `primary` / `link` | `bg` | 6.5:1 | 7.1:1 |
| `accent` (clay text) | `bg` | 4.8:1 | 5.7:1 |
| `pen` | `surface-raised` | 5.5:1 | 4.7:1 |
| `on-primary` | `primary` | 7.6:1 | 7.4:1 |
| `on-accent` | `accent` | 5.6:1 | 5.9:1 |
| `secondary` (draft stamp) | `sticky-sage` | 4.9:1 | 7.3:1 |
| `success` | `surface-raised` | 5.2:1 | 7.2:1 |
| `warning` | `bg` | 6.2:1 | 9.5:1 |
| `danger` | `bg` | 5.6:1 | 7.4:1 |
| `ink-rule` (list rule, edges) | `bg` | 10.0:1 | 8.5:1 |
| `border-strong` (field edges) | `surface-raised` | 3.9:1 | 3.3:1 |
| `focus-ring` | `bg` | 5.1:1 | 8.1:1 |

The pen line between rows and the sticky's adhesive band are decoration and deliberately quiet; they never carry meaning. Colour is never the only signal: stamps have words and icons, the selected day is also bold, errors have text.

## Sunlight and touch

- Targets are at least 48px (`size-tap`); action-bar buttons and list rows are 56–64px. Keep 8px between neighbouring targets.
- The main action sits at the bottom, in reach of a thumb.
- High-contrast ink on paper, 17px body, no thin weights, no text over photos.

## States and focus

- Keyboard focus: a 3px `focus-ring` outline, offset 2px, on every interactive element.
- Pressed labels sink 2px onto their edge; pressed rows wash `secondary-soft`.
- Disabled labels go flat (no edge, `text-disabled`) and something nearby says what's missing.
- Loading: the button keeps its label, shows a spinner and sets `aria-busy`.

## Motion

Quick and quiet: 80–160ms for presses and toggles, 240ms for screen pushes and sheets (`ease-standard`), nothing bouncy. Screens slide in from the side, sheets rise from the bottom, modals fade and scale up slightly. With reduced motion, everything is instant.

## Icons

24px line icons, 1.75px round stroke, `currentColor`, on a 24px grid with 2px padding (see Icons). Pair icons with words in tabs and buttons; icon-only buttons need an `aria-label`. **No paw prints, bones or cartoon dogs** — anywhere, including empty states, which use small landscape and paper sketches. Dogs are their name, their photo, or initials in a rounded square.

## Voice and content

Herder speaks like a capable assistant at the front desk: short, warm, specific.

- **Plain words, real details.** "Biscuit's private lesson is Tue, Nov 10 at 10:30 AM" — not "Your appointment has been scheduled."
- **First names everywhere.** Clients are people with dogs, not "customers"; dogs are named, never "pet".
- **Sentence case** for titles, buttons, tabs and labels. Uppercase only in stamps.
- **Buttons are verb + object** and say the amount when money moves: "Pay $30.00 deposit", "Approve & send", "Sign waiver".
- **Errors say how to fix it**, under the field.
- **No exclamation marks in the UI**, no emoji, no dog puns. Warmth comes from specifics and the trainer's own notes. (Texts the trainer sends are in her voice.)
- **Neutral behaviour language**: "Reactive to dogs", "Nervous around bikes" — never "aggressive" or "bad".
- **Dates and times as people say them**: "Tue, Nov 10", "10:30 AM", "in 25 min". Show the time zone when trainer and client could differ.

## Using this system

Load the tokens and `components/bundle.css` (classes are prefixed `hd-`), put `hd-root` on the body, and call `Herder.hydrate()` from `components/bundle.js` to fill `<i data-icon>` icons and wire single-choice groups (`data-hd-select`). A screen is `div.app › div.view › (div.head, div.body)` with the tab bar or an action bar at the bottom.

- **Foundations**: pen marks and icons. **Actions, Inputs, Containers, Feedback, Paper, Identity**: the components, each with the rule it follows.
- **Patterns**: the reusable flows — SMS thread, booking picker, deposit checkout, invoice, waiver signing, client profile, session note, homework.
- **Screens**: every trainer and client screen built only from these parts.

## Full token reference

### Colors

Themes: Light, Dark.

| Token | Light / base value | Dark value | Usage |
| --- | --- | --- | --- |
| pine-50 | #EEF4F1 | — | Pine 50 (raw step). |
| pine-100 | #D6E5DE | — | Pine 100 (raw step). |
| pine-200 | #B0CDBF | — | Pine 200 (raw step). |
| pine-300 | #7FAE9B | — | Pine 300 (raw step). |
| pine-400 | #52907A | — | Pine 400 (raw step). |
| pine-500 | #3A7561 | — | Pine, the primary ink: evergreen. Raw scale — UI uses primary, primary-soft, primary-edge. |
| pine-600 | #2C5D4C | — | Pine 600 (raw step). |
| pine-700 | #234A3D | — | Pine 700 (raw step). |
| pine-800 | #1B392F | — | Pine 800 (raw step). |
| pine-900 | #122721 | — | Pine 900 (raw step). |
| pine-950 | #0B1A15 | — | Pine 950 (raw step). |
| sage-50 | #F3F5EF | — | Sage 50 (raw step). |
| sage-100 | #E4E9DC | — | Sage 100 (raw step). |
| sage-200 | #CBD5BD | — | Sage 200 (raw step). |
| sage-300 | #ADBC9A | — | Sage 300 (raw step). |
| sage-400 | #8FA17A | — | Sage 400 (raw step). |
| sage-500 | #758862 | — | Sage, the secondary ink: lichen and dry grass. Raw scale — UI uses secondary and the sage sticky note. |
| sage-600 | #5D6D4D | — | Sage 600 (raw step). |
| sage-700 | #4A573E | — | Sage 700 (raw step). |
| sage-800 | #38422D | — | Sage 800 (raw step). |
| sage-900 | #262D1F | — | Sage 900 (raw step). |
| sage-950 | #181D13 | — | Sage 950 (raw step). |
| clay-50 | #FCF1EC | — | Clay 50 (raw step). |
| clay-100 | #F7DDD1 | — | Clay 100 (raw step). |
| clay-200 | #EFBFA9 | — | Clay 200 (raw step). |
| clay-300 | #E19A78 | — | Clay 300 (raw step). |
| clay-400 | #D47A52 | — | Clay 400 (raw step). |
| clay-500 | #C0603A | — | Clay, the accent and the pen: trail dirt and terracotta. Raw scale — UI uses accent and pen. |
| clay-600 | #A64E2D | — | Clay 600 (raw step). |
| clay-700 | #863F25 | — | Clay 700 (raw step). |
| clay-800 | #66301C | — | Clay 800 (raw step). |
| clay-900 | #462113 | — | Clay 900 (raw step). |
| clay-950 | #2C150C | — | Clay 950 (raw step). |
| oat-50 | #FCFAF6 | — | Oat 50 (raw step). |
| oat-100 | #F7F2E8 | — | Oat 100 (raw step). |
| oat-200 | #EFE7D7 | — | Oat 200 (raw step). |
| oat-300 | #E2D6BF | — | Oat 300 (raw step). |
| oat-400 | #C9B99C | — | Oat 400 (raw step). |
| oat-500 | #8F806A | — | Oat, the paper: canvas and oatmeal. Raw scale — UI uses bg, surface and the text greys. |
| oat-600 | #756852 | — | Oat 600 (raw step). |
| oat-700 | #5C5244 | — | Oat 700 (raw step). |
| oat-800 | #3F3830 | — | Oat 800 (raw step). |
| oat-900 | #29241F | — | Oat 900 (raw step). |
| oat-950 | #1A1714 | — | Oat 950 (raw step). |
| success-100 | #E2F0E1 | — | Raw success step; UI uses the semantic success tokens. |
| success-600 | #2F7A3E | — | Raw success step; UI uses the semantic success tokens. |
| success-700 | #24602F | — | Raw success step; UI uses the semantic success tokens. |
| warning-100 | #FBEFD6 | — | Raw warning step; UI uses the semantic warning tokens. |
| warning-400 | #E8A93A | — | Raw warning step; UI uses the semantic warning tokens. |
| warning-700 | #7A4F0C | — | Raw warning step; UI uses the semantic warning tokens. |
| danger-100 | #FBE3E5 | — | Raw danger step; UI uses the semantic danger tokens. |
| danger-600 | #B4233A | — | Raw danger step; UI uses the semantic danger tokens. |
| danger-700 | #911B2E | — | Raw danger step; UI uses the semantic danger tokens. |
| info-100 | #E1EEF5 | — | Raw info step; UI uses the semantic info tokens. |
| info-600 | #2D6A8F | — | Raw info step; UI uses the semantic info tokens. |
| info-700 | #22536F | — | Raw info step; UI uses the semantic info tokens. |
| bg | #F4EEE2 | #151916 | Paper: the page behind everything. Warm oat in light, a near-black green notebook cover in dark. |
| surface | #FBF7EF | #1C211D | A sheet on the page: cards, the tab bar, the composer, row hover. |
| surface-raised | #FFFDF8 | #232924 | Fresh paper on top: inputs, buttons, sheets, receipts, toasts, received messages. |
| surface-sunken | #F0E9DB | #101411 | Wells and tracks: progress tracks, disabled buttons, read-only fields. |
| border | #DED1B8 | #333C36 | Hairline edge of a sheet; the line under a list. Decorative — never the only edge of a control. |
| border-strong | #8C7D66 | #6E7A72 | Edges of inputs, checkboxes, taken slots. At least 3:1 on every paper. |
| ink-rule | #3F3830 | #B9B3A5 | Ink: the ledger rule above a list, the edge and under-edge of paper labels (buttons, slots, segmented controls), toast edges, the double rule above a total. |
| rule | #CDBD9E | #46504A | Pen line between list items, dashed lines between receipt items. Decorative only. |
| note-rule | rgba(41,36,31,0.16) | rgba(238,234,224,0.14) | Ruled lines under written notes (session notes). |
| margin-rule | #E5B49B | #7A4A36 | The margin line that runs down Today's timeline. |
| scrim | rgba(26,23,20,0.48) | rgba(0,0,0,0.64) | Behind sheets and modals. |
| text | #1E2420 | #EEEAE0 | Body text and icons on every paper (bg, surface, surface-raised, surface-sunken, sticky notes). 12:1 or better. |
| text-muted | {oat-700} | #B9B3A5 | Second lines, metadata, captions, inactive tabs — on every paper and sticky note. |
| text-subtle | {oat-600} | #9A9488 | Placeholders and hints on bg, surface, surface-raised. Not for anything a person must read. |
| text-disabled | {oat-500} | #6B776F | Disabled labels only (exempt from contrast rules). |
| primary | {pine-600} | {pine-300} | Pine ink: the trainer's decisions (Approve & send, Save), selected segments and slots, links, section labels. |
| primary-hover | {pine-700} | {pine-200} | Hover fill of pine buttons. |
| on-primary | #FFFFFF | #0F1512 | Text on a pine fill. |
| primary-edge | {pine-800} | {pine-500} | The ink edge under a pine button or selected slot. |
| primary-soft | {pine-100} | {pine-900} | Pine wash (rarely used: progress and selection backgrounds in the base components). |
| on-primary-soft | {pine-800} | {pine-200} | Text on primary-soft. |
| secondary | {sage-600} | {sage-300} | Sage ink: what the app or AI did (auto-reply notes, AI-draft stamps). |
| secondary-edge | {sage-700} | {sage-500} | The ink edge under a sage button. |
| secondary-soft | {sage-100} | {sage-900} | Sage wash for the tonal sage button. |
| on-secondary-soft | {sage-800} | {sage-200} | Text on secondary-soft and on the sage sticky note. |
| accent | {clay-600} | {clay-400} | Clay ink: the one call to action per screen (Book, Pay, Sign, Send) and what's next. |
| accent-hover | {clay-700} | {clay-300} | Hover fill of clay buttons. |
| on-accent | #FFFFFF | #1A1210 | Text on a clay fill. |
| accent-edge | {clay-800} | {clay-700} | The ink edge under a clay button. |
| accent-soft | {clay-100} | {clay-900} | Clay wash (tinted tiles for new inquiries). |
| on-accent-soft | {clay-800} | {clay-200} | Text on accent-soft. |
| pen | {accent} | {accent} | The trainer's pen: circles, squiggle underlines and ticks drawn over the UI. Clay, so a mark reads as handwriting, not as a control. |
| link | {pine-600} | {pine-300} | Inline links, always underlined. |
| focus-ring | {info-600} | #7DB6D9 | Keyboard focus: 3px outline, 2px offset, on every control. Blue so it never reads as pine selection or the clay pen. |
| success | {success-600} | #7CC48A | Stamp ink and icons for done: Paid, Booked, Signed, Deposit paid. |
| success-soft | {success-100} | #17301D | Success banner background. |
| on-success-soft | {success-700} | #A9DDB2 | Text on success-soft. |
| warning | {warning-700} | #E8B65A | Stamp ink and icons for needs action soon: Unsigned, Due Nov 6. |
| warning-fill | {warning-400} | #E8B65A | Highlighter under a detail the AI wasn't sure of. |
| warning-soft | {warning-100} | #33270F | Warning banner background; the highlight behind an unsure detail. |
| on-warning-soft | {warning-700} | #F2CF8C | Text on warning-soft. |
| danger | {danger-600} | #F08A99 | Stamp ink and icons for failed or late: Overdue, Card declined. |
| on-danger | #FFFFFF | #1A0D10 | Text on a danger fill (destructive button). |
| danger-edge | {danger-700} | {danger-600} | The ink edge under a destructive button. |
| danger-soft | {danger-100} | #3A161C | Error banner background. |
| on-danger-soft | {danger-700} | #F7B8C1 | Text on danger-soft. |
| info | {info-600} | #7DB6D9 | Info icons and stamps: rescheduled, synced. |
| info-soft | {info-100} | #14283A | Info banner background. |
| on-info-soft | {info-700} | #B5D7EC | Text on info-soft. |
| bubble-out | {pine-600} | {pine-800} | Texts the trainer sent. |
| on-bubble-out | #FFFFFF | #EEEAE0 | Text in bubble-out. |
| bubble-in | #FFFDF8 | #232924 | Texts from the client (with a border edge). |
| draft | #F1F3EA | #1D231B | The wash on a selected list row. |
| sticky-sage | #EDF1E2 | #242B1D | Sage sticky note: anything the AI drafted, waiting for review. |
| sticky-clay | #FBECE3 | #3A241B | Clay sticky note: the trainer's personal note to a client. |
| sticky-band | rgba(41,36,31,0.05) | rgba(0,0,0,0.16) | The faint adhesive band across the top 12px of a sticky note. |

### Typography

Families:
- **display:** `"Fraunces", "Iowan Old Style", Georgia, serif`
- **sans:** `"Nunito Sans", "Avenir Next", system-ui, -apple-system, "Segoe UI", sans-serif`

Font files:

| Family | File | Weight range | Style |
| --- | --- | --- | --- |
| Fraunces | fonts/Fraunces-Variable.woff2 | 100 900 | normal |
| Fraunces | fonts/Fraunces-Variable-Italic.woff2 | 100 900 | italic |
| Nunito Sans | fonts/NunitoSans-Variable.woff2 | 200 1000 | normal |
| Nunito Sans | fonts/NunitoSans-Variable-Italic.woff2 | 200 1000 | italic |

#### Headings (display)

| Style | Size | Line height | Weight | Style | Tracking | Sample | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t-display | 40px | 44px | 600 | normal | -0.01em | Morning, Maya | The greeting on a home screen. One per screen; the name gets a pen underline. |
| t-title-1 | 28px | 34px | 600 | normal |  | Inbox | Screen titles. |
| t-title-2 | 22px | 28px | 600 | normal |  | Rocket & Alex | Card and sheet titles. |
| t-title-3 | 19px | 24px | 600 | normal |  | Look-at-that game | Small headings inside cards; dog names. |
| t-amount | 32px | 36px | 500 | normal |  | $210.00 | Money totals, under a double rule. Tabular figures. |

#### Pen voice (display)

| Style | Size | Line height | Weight | Style | Tracking | Sample | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t-label | 17px | 22px | 600 | italic |  | Needs you | Section labels above lists and inside cards, in pine ink (hd-overline). Sentence case — never uppercase. |
| t-time | 17px | 22px | 500 | italic |  | 10:30 | Times in the margin of a timeline or agenda. Tabular figures. |
| t-quote | 17px | 24px | 500 | italic |  | Saturday was her best yet. | The trainer's own words: her note on homework, system events in a thread. |

#### Text (sans)

| Style | Size | Line height | Weight | Style | Tracking | Sample | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t-body-lg | 19px | 28px | 400 | normal |  | Stand far enough away that Juno notices dogs. | Homework steps and anything read mid-walk. |
| t-body | 17px | 26px | 400 | normal |  | Hi Jordan — I have Tuesday at 10:30 open. | Body and messages. Written notes use 26px lines over a ruled line. |
| t-body-sm | 15px | 22px | 400 | normal |  | Juno · needed before Sat | Second lines in rows and cards. |
| t-strong | 17px | 22px | 700 | normal |  | Pay $30.00 deposit | Button labels, row titles, field labels. |
| t-strong-sm | 15px | 20px | 700 | normal |  | New · 2 | Segments, tabs, small buttons. |
| t-caption | 13px | 18px | 600 | normal |  | 8:02 AM · Delivered | Timestamps and captions. The smallest running text. |
| t-stamp | 12px | 12px | 800 | normal | 0.04em | DEPOSIT PAID | Small stamps, set uppercase. Big stamps use 17px (30px for the one on a confirmation screen) at 0.12em. |

### Spacing

4px base. Phone gutter space-4.

| Token | Value | Usage |
| --- | --- | --- |
| space-1 | 4px | Inside stamps and chips. |
| space-2 | 8px | Between related controls; tab underline inset. |
| space-3 | 12px | Icon to label; list row vertical padding. |
| space-4 | 16px | Phone gutter; card and sticky-note padding. |
| space-5 | 20px | Sheet padding. |
| space-6 | 24px | Between sections. |
| space-8 | 32px | Empty-state padding. |
| space-10 | 40px | Large top spacing. |
| space-12 | 48px | Above a sticky action bar. |
| space-16 | 64px | Tablet hero spacing. |

### Corner radii

| Token | Value | Usage |
| --- | --- | --- |
| radius-xs | 4px | Stamps, checkboxes, tracker boxes. |
| radius-sm | 6px | Receipts, fact boxes, big stamps. |
| radius-md | 8px | Buttons, inputs, slots, segmented controls, toasts, dog avatars. |
| radius-lg | 10px | Cards and sheets of paper. |
| radius-xl | 16px | Top corners of bottom sheets. |
| radius-pill | 999px | Count badges, people avatars. |

### Size

Touch targets and fixed sizes.

| Token | Value | Usage |
| --- | --- | --- |
| size-tap | 48px | Minimum height of anything tappable. |
| size-tap-lg | 56px | The main action in an action bar. |
| size-icon | 24px | Default icon. |
| size-icon-sm | 20px | Icons in small buttons. |
| size-avatar | 40px | Avatars in rows. |
| size-avatar-lg | 72px | Profile header avatar. |
| size-tabbar | 72px | Bottom tab bar, with 12px above the icons so the pen circle clears the divider. |

### Shadows

Paper sits flat; only floating things lift. Pressable things use a hard ink edge (in bundle.css), never a soft shadow.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| shadow-1 | 0 1px 0 rgba(41,36,31,0.05) | none | Barely-there lift for base components. |
| shadow-2 | 0 1px 0 rgba(41,36,31,0.06), 0 10px 24px -8px rgba(41,36,31,0.22) | 0 10px 24px -8px rgba(0,0,0,0.6) | Floating sheets of paper: the up-next card, receipts, toasts. |
| shadow-3 | 0 -1px 0 rgba(41,36,31,0.06), 0 -12px 32px -8px rgba(41,36,31,0.25) | 0 -12px 32px -8px rgba(0,0,0,0.6) | Bottom sheets and modals. |
| shadow-sticky | 0 1px 1px rgba(41,36,31,0.08), 0 14px 14px -12px rgba(41,36,31,0.34) | 0 14px 14px -12px rgba(0,0,0,0.7) | Sticky notes: lifted at the bottom edge, as if the corner curls. |

### Duration

| Token | Value | Usage |
| --- | --- | --- |
| duration-instant | 80ms | Press: buttons sink 2px onto their edge. |
| duration-fast | 160ms | Hover, tabs, fades. |
| duration-base | 240ms | Toasts, selection. |
| duration-slow | 360ms | Sheets and screen pushes. |

### Easing

| Token | Value | Usage |
| --- | --- | --- |
| ease-standard | cubic-bezier(0.2, 0, 0, 1) | Most transitions. |
| ease-enter | cubic-bezier(0, 0, 0.2, 1) | Things entering. |
| ease-exit | cubic-bezier(0.4, 0, 1, 1) | Things leaving. |

## Component and pattern guidance

The artifact lists the reusable set below; screen examples are composed from these parts. Usage rules and preview guidance read in the embedded Components section are summarized here.

### Per-component notes

#### Avatar — Identity

Initials in ink on fresh paper. People are circles; dogs are rounded squares. Keep a person’s ink stable from a name hash, prefer real dog photos to initials, never use cartoon placeholders, and always show the name in text. Sizes: 32/40/72/96px; `hd-avatar-pair` overlaps client and dog.

#### BookServiceScreen — Screens

Client booking: trainer card, services in a radio list with prices beneath a pen-voice prompt, then “Choose a time.” 390×844 phone frame.

#### BookedScreen — Screens

Booking confirmation with the booking card, in-flow “Deposit paid” stamp, remaining balance, Add to calendar, and Book something else.

#### BookingPicker — Patterns

Week strip, open times grouped Morning/Afternoon/Evening, place, summary. Chosen day circled; today underlined; unavailable days greyed; chosen time pine-filled; taken times struck through. Use native “Where?” select for multiple locations. Show timezone/deposit line; clay CTA repeats the selected date/time and stays disabled until a time is chosen.

#### Button — Actions

Pressable paper label with solid fill, 1.5px ink edge and 2px under-edge; pressed state sinks. Variants: accent/clay for one primary CTA; primary/pine for trainer decisions; outline/paper for secondary; secondary/sage for helpers; danger for destructive action confirmed in modal; ghost/underlined for low-stakes exit. Buttons are verb+object; include amount for payments. No pen marks on buttons. Disabled buttons flatten and explain what is missing.

#### CalendarScreen — Screens

Trainer Calendar: week strip with selected day circled, sessions by start time, plus boarding, calls and group classes.

#### Card — Containers

A flat paper sheet: `surface`, hairline `border`, 10px radius. Groups one subject so it scans as a unit. At most one raised card per screen (`shadow-2`); no tilt, tape, or colored stripe. If the entire card opens, add interactive semantics and a chevron; otherwise only its buttons are pressable.

#### Checkout — Patterns

Deposit payment without account: receipt shows service/price, balance after session, then amount due today under a double ink rule. Provide saved-card or accessible card fields and Apple/Google Pay when available; one-sentence cancellation policy; clay amount CTA and “Payments are encrypted.” Errors stay under card fields, not in toast.

#### ClientHomeScreen — Screens

Greeting with pen-underlined name, next session, waiver warning, weekly homework dots, package balance, and Book another session.

#### ClientProfile — Patterns

Client head (circle avatar, Fraunces name, number/since) with outline Text/Call/Book/Invoice actions; fixable waiver warning; dog card (rounded-square avatar, breed/sex, outline trait stamps, age/weight/vaccines/package progress); tabs Sessions/Notes/Homework/Billing with internal pen underline; sessions as ledger rows ending in chevrons with one status stamp.

#### ClientsScreen — Screens

Trainer Clients list under ledger rule: client and dog avatars, dog and package progress, at most one status stamp, chevron rows.

#### DateTimePicker — Inputs

Day is an object to look at: circle selected day, underline today; time is pressable: paper label with selected pine fill. Week strip and month calendar have selected/today/off states; slot grid is three columns; taken slots dashed and struck through and disabled. Group by day-part labels. Open on first day with openings; show start times and full range in summary; targets ≥48px and timezone shown when needed.

#### EmptyState — Feedback

Small 120×80 landscape/paper sketch, short Fraunces title, one sentence, at most one button. First-run empties get an action; “you’re done” empties do not. Search-empty state says what was searched, rather than art. No dogs/paws/bones.

#### HomeworkCard — Patterns

Exercise dose as icon/fact pairs, goal, numbered steps, and optional “Watch Maya demo it” video. Trainer note is a clay sticky in her words/Fraunces italic with initials. Seven-day practice tracker uses filled pine completed dots and a pen circle for today; count is explicit. One clay “Done for today” action; older items are list rows under “Keep practicing.”

#### Icons — Foundations

Purpose-drawn 24px line set, 1.75px round stroke/caps/joins, 2px inset, no fills, `currentColor`. Use `<i data-icon>` plus `Herder.hydrate()` or `Herder.icon()`. Pair with words; icon-only controls need `aria-label`. No paw/bone/cartoon-dog icons.

#### InboxScreen — Screens

Trainer Inbox: segmented All/New/Unread filter; threads are plain list rows with one or two status stamps such as New inquiry, Reply drafted, Auto-replied.

#### Input — Inputs

Fresh-paper `surface-raised` field, `border-strong` edge, 8px corners, visible label (placeholder never replaces it), 52px height and 17px text. Focus uses pine edge + blue focus ring. Mark optional fields, errors below field and explain fix; appropriate keyboard/autocomplete. Use `aria-invalid` and error line.

#### Invoice — Patterns

Receipt structure: sender, billed party, line items; tabular right-aligned cents; double ink rule above balance. AI draft state is sage sticky with dashed review stamp/source and Edit/Approve & send. Sent/open uses a small Due/Overdue stamp; client sees amount CTA. Paid state uses one large “Paid · date” stamp in bottom whitespace.

#### ListRow — Containers

Lists are written on page, not boxed: 1.5px ink ledger rule atop, uneven pen line between items, hairline bottom. Row anatomy: lead (avatar/icon/radio), body (title/subtitle/chips), trail (time/count/chevron). Rows ≥64px, whole row target. Only opening rows get a chevron; one most-urgent stamp; truncate title, allow message preview up to two lines; unread title bold + clay dot.

#### MoneyScreen — Screens

Trainer Money screen: amount to collect as headline figure, month-to-date, then invoices with Due/Overdue/AI draft/Paid stamps.

#### PayScreen — Screens

Client Pay: open invoice as receipt with Due stamp, one clay “Pay $210.00” CTA, Download PDF and Ask a question.

#### PenMarks — Foundations

Clay hand-drawn circles/squiggles mean “this one”: attention/current/selected, not a control. Applies to amount/name/day/today/tab/tabbar as appropriate. SVG masks painted by `pen`/`rule`; semantic state is also provided (`aria-pressed`, `aria-current`, etc.). Limit to 2–3 per screen; do not mark buttons/slots/segments, and leave 6–12px clear of clipping edges.

#### Segmented — Containers

2–4 mutually exclusive choices as one outlined paper label, with ink under-edge and dividing rules; selected segment is pine fill (not pen). Use for one-list filters or small value choice; equal-width segments with one word/number; implement tablist/tab roles and selected state.

#### Select — Inputs

Known single-choice list. Under five options, show all as radio rows; longer plain lists can use native select. Options lead with name then details; prices end the row; default to likeliest choice when appropriate. Multi-select filters use `aria-pressed`.

#### SessionNote — Patterns

Post-session AI draft from trainer voice memo: sage sticky and dashed review stamp/source; sections What we worked on / Progress / Next steps; highlight extracted facts; Approve & send (pine), Edit (outline), Discard (ghost). Once sent, remove sticky and use ordinary card with sent stamp.

#### Sheet — Containers

Phone-default bottom sheet for one short task/decision on fresh paper over scrim; use modal only for hard-to-undo confirmation. Buttons name outcomes, not Yes/No; safer option is outline. Move focus into sheet on open and back to trigger on close.

#### SignedScreen — Screens

Waiver completion: large Signed stamp/date, where the copy went, and Back to home.

#### SmsThread — Patterns

Phone-like client conversation: client header; pen-voice day separators; client bubbles left on fresh paper with hairline, trainer bubbles right in pine; times/delivery under bubbles. State automatic Herder activity separately. AI reply is sage sticky with dashed stamp/source and Send/Edit/Dismiss; only explicit trainer tap sends; after send it becomes a normal bubble and Undo toast; client sees trainer number, not Herder.

#### Stamp — Feedback

Status words, never tappable: outline/no fill, worn ink. Small 24px uppercase chip with icon; tones map success/done, warning/soon, danger/late, accent/new, sage/app action, dashed draft/unapproved, primary/approved, info/changed, outline/neutral. Big 17px double-ruled stamp (30px on confirmation) appears only at completion and in its own whitespace. One small stamp per row; one big per screen; words+icon carry meaning and contrast remains ≥4.5:1.

#### StickyNote — Paper

Only notes, not records: sage for AI drafts, clay for trainer’s own client note (Fraunces italic, initials; the only tilted sticky). Square top corners, faint 12px adhesive band, curled lower-right, subtle sticky shadow; no tape/dashed border. AI drafts always show dashed review stamp/source, never auto-send; after approval they become ordinary content. Text uses readable text/text-muted tokens; actions remain ordinary buttons.

#### Tabs — Containers

Two separate jobs: intra-entity tabs (current tab pine with internal pen underline; never clipped) and bottom tab bar for app sections (max five, icon+one-word label; selected section bold/ink with pen circle; clay count badges). Tabs do not trigger actions and switching preserves scroll/draft; use segmented control for single-list filtering.

#### Toast — Feedback

Confirms an event; banner explains a continuing condition. Fresh paper, ink edge, tone icon, optional detail and at most one ghost action (Undo/Retry/View). Toast above tab/action bar; 4s (8s with action), failures persist. Use specific past tense (“Note sent to Dana”), never “Success”; field errors stay under field.

#### TodayScreen — Screens

Trainer Today: greeting with pen-underlined name; stats with amount-to-collect circled; one raised next-session card (Running late/Directions); Needs you section and day schedule.

#### WaiverSigning — Patterns

Readable 17px waiver sections on page (not a scroll box), numbered headings and full-waiver link. Agreement checkbox, optional photo consent, full name, signature pad on fresh paper with baseline/×/Clear. Clay Sign waiver disabled until agreement, name, signature complete; confirmation is SignedScreen.

## Assets

### Icons (47 files)

`sun.svg`, `inbox.svg`, `calendar.svg`, `calendar-check.svg`, `users.svg`, `user.svg`, `message.svg`, `message-auto.svg`, `send.svg`, `phone.svg`, `clock.svg`, `pin.svg`, `navigate.svg`, `check.svg`, `check-double.svg`, `x.svg`, `chevron-right.svg`, `chevron-left.svg`, `chevron-down.svg`, `plus.svg`, `search.svg`, `card.svg`, `receipt.svg`, `pen.svg`, `waiver.svg`, `homework.svg`, `draft.svg`, `bell.svg`, `alert.svg`, `info.svg`, `check-circle.svg`, `x-circle.svg`, `home.svg`, `tag.svg`, `dollar.svg`, `more.svg`, `attach.svg`, `mic.svg`, `play.svg`, `video.svg`, `mountain.svg`, `trash.svg`, `lock.svg`, `arrow-right.svg`, `repeat.svg`, `filter.svg`, `settings.svg`

## Implementation and accessibility reminders

- Mobile-first; WCAG AA in both themes; system color preference with `data-theme="light|dark"` override.
- Touch targets ≥48px and 8px spacing; action-bar/main actions reachable at bottom; high contrast and 17px body text; no thin weights or text over photos.
- Focus ring 3px with 2px offset; preserve labels while loading and set `aria-busy`; reduced motion makes transitions instant.
- Icons and hand-drawn masks use current semantic tokens; color never carries meaning alone. Links are underlined; status text/icons remain explicit.

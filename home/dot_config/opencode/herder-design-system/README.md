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

# Claude-style paste behavior for Pi

Status: implemented
Target: global Pi 0.84.3 extension

## Goal

Add Claude-style handling for consecutive large pastes without changing the text sent to the model.

The user-visible flow is:

1. The first large paste stays compact in the editor, for example `[Pasted 42 lines]`.
2. If the user pastes the same clipboard text again while that trailing marker is active, the marker becomes the full text and Pi does not append a duplicate.
3. A different second paste keeps Pi's normal behavior and creates its own marker when large.
4. Submission always sends the full text represented by each remaining marker.

This matches Claude Code's repeat-paste expansion behavior. Small pastes keep Pi's normal behavior.

## Existing Pi behavior

Pi 0.84.3 already provides the hard parts in `@earendil-works/pi-tui`'s `Editor`:

- Bracketed-paste buffering.
- Text cleanup and line-ending normalization.
- Large-paste detection at more than 10 lines or more than 1,000 characters.
- Compact native markers such as `[paste #1 +42 lines]`.
- Private storage for the full pasted content.
- `getExpandedText()` for reading the full draft.
- Full marker expansion during submission.
- Atomic marker cursor movement, deletion, and undo.

The extension must reuse this behavior. It must not copy Pi's editor implementation or access private editor fields.

## Chosen design

### Seam

Wrap the active editor factory through the public `ctx.ui.getEditorComponent()` and `ctx.ui.setEditorComponent()` interface.

The wrapper alters only two editor operations:

- `handleInput(data)` to detect the start of a second bracketed paste.
- `render(width)` to change the native marker's display text.

Every other operation remains owned by the active editor. This keeps Pi's keybindings, autocomplete, history, undo, submission, pi-vim behavior, and `force-queued-on-enter` behavior.

### Module shape

```text
claude-paste extension
├── editor installation adapter
│   └── composes with the current editor factory
├── paste transition module
│   └── detects an exact repeated paste and resolves it to one full copy
└── marker presentation module
    └── maps Pi marker wording to Claude-style wording at render time
```

The transition and presentation modules are pure. The installation adapter is the only module that touches Pi.

### Paste transition

On input containing the bracketed-paste start sequence `ESC [ 200 ~`:

1. Read `editor.getText()` as the compact draft.
2. Read `editor.getExpandedText()` as the full draft.
3. Capture a transient repeat-paste probe only when the cursor is at the draft end and the compact draft has one safe trailing native marker.
4. Forward every paste chunk unchanged so Pi still owns buffering and normalization.
5. When the bracketed-paste end sequence `ESC [ 201 ~` arrives, compare Pi's new expanded draft with the probe.
6. If Pi appended the exact text represented by the old marker, call `setText()` with the old expanded draft. This removes the duplicate and leaves one full copy.
7. Otherwise, leave Pi's result unchanged.

The probe persists only until the current bracketed paste ends. It supports terminals that deliver paste start, body, and end in separate input chunks.

If the user moved the cursor, edited the marker, or pasted different content, the wrapper delegates to Pi. This fallback favors correct text and cursor state.

### Marker presentation

The wrapper changes marker wording only in rendered lines:

- `[paste #1 +42 lines]` becomes `[Pasted 42 lines]`.
- `[paste #1 1400 chars]` becomes `[Pasted 1400 chars]`.

The underlying editor text and native paste map remain unchanged. As a result:

- Pi still treats the marker as one atomic editor segment.
- Backspace still removes the stored paste.
- Undo still restores the marker and its full content.
- Submission still expands the native marker.
- `getExpandedText()` still returns the full draft.

The render transformer must preserve ANSI escape sequences and never increase line width. If a marker is split across rendered lines in a very narrow terminal, it leaves Pi's native rendering unchanged rather than risk corrupt output.

## Composition and lifecycle

Install the wrapper only in TUI mode.

Use the same composition pattern as `extensions/force-queued-on-enter.ts`:

1. Capture the existing editor factory.
2. Create the existing editor, or a `CustomEditor` when no factory exists.
3. Wrap that editor instance instead of replacing it.
4. Mark the factory with a global `Symbol` to prevent duplicate wrapping.
5. Install during `resources_discover`.
6. Also schedule a guarded microtask from `session_start` so later `session_start` editor extensions can install first.
7. Invalidate the generation on `session_shutdown` so stale contexts cannot reinstall the wrapper after reload or session replacement.

This design must work in either order with `force-queued-on-enter`. Both extensions wrap the active editor instead of assuming that they own it.

## Implemented files

```text
.pi/agent/
├── extensions/
│   └── claude-paste.ts
├── lib/
│   └── claude-paste/
│       └── logic.ts
└── extension-tests/
    └── claude-paste.test.ts
```

`logic.ts` contains only pure functions:

```ts
function createRepeatedPasteProbe(
  compactText: string,
  expandedText: string,
  cursorAtDraftEnd: boolean,
): RepeatedPasteProbe | undefined;

function shouldExpandRepeatedPaste(
  probe: RepeatedPasteProbe,
  afterPasteExpandedText: string,
): boolean;

function formatRenderedPasteMarkers(line: string): string;
```

The extension file contains lifecycle and editor-factory composition only.

## Invariants

1. The display marker is never sent to the model in place of paste content.
2. The extension keeps no durable paste map; its repeat probe lasts only for the active bracketed paste.
3. The extension never reads or mutates Pi's private editor fields.
4. Pi receives every bracketed-paste input chunk unchanged.
5. Expansion occurs only for an exact repeated paste at the draft end.
6. Non-TUI modes remain unchanged.
7. Reload and session replacement do not retain editor or paste state.
8. Render changes never increase visible width.

## Verification

### Pure tests

Test the transition decision for:

- A safe trailing marker produces a repeat-paste probe.
- Missing, non-trailing, unsafe, or off-cursor markers do not produce a probe.
- Appending the same represented content matches the probe.
- Appending different content does not match.
- Paste boundaries are detected in combined and split input chunks.

Test marker presentation for:

- Line-count markers.
- Character-count markers.
- Multiple markers on one line.
- ANSI styling around a marker.
- Unrelated literal text that resembles an invalid marker.
- Output visible width no greater than input visible width.

### Editor integration tests

Use a fake editor that records calls:

- Repeating a 1,325-character paste leaves the full text once and no marker.
- A different second paste remains owned by Pi.
- Unsafe cursor positions fall back without `setText`.
- `getExpandedText()` remains the value used by the outer `force-queued-on-enter` wrapper.
- Wrapping the same factory twice is idempotent.
- Session shutdown prevents deferred stale installation.

### Live TUI proof

In an isolated Pi process:

1. Paste more than 10 lines. Confirm one `[Pasted N lines]` marker appears.
2. Press Enter. Confirm the user message contains the full paste.
3. Start a new draft and paste more than 10 lines, then paste the same clipboard text again. Confirm the marker becomes one full copy with no trailing marker.
4. Paste different large text and confirm Pi keeps both values with native compact handling for the new paste.
5. Undo and delete a compact marker. Confirm Pi's native atomic behavior still works.
6. Repeat with pi-vim and `force-queued-on-enter` enabled.
7. Run `/reload`, then repeat one paste to confirm there is no duplicate wrapper.

## Rejected designs

### Fork or copy Pi's editor

This gives full control over paste formatting, but it duplicates a large, fast-changing editor implementation. It would also replace pi-vim behavior and create a high upgrade cost.

### Access Pi's private paste map

Private-field access could rename or expand markers directly, but it depends on undocumented implementation details. A Pi update could silently lose pasted content.

### Maintain a second extension-owned paste map

This would duplicate sensitive prompt text and require the extension to reimplement atomic deletion, undo, submission expansion, cursor mapping, and session cleanup. Pi already implements these correctly.

### Expand before forwarding every second paste

This caused the reported bug: Pi then accepted the new large paste and created a new compact marker. It also duplicated repeated clipboard content. The implementation now lets Pi process the paste first and removes the duplicate only after an exact repeat match.

## Known limitation

The exact Claude-style repeat expansion applies to one safe trailing marker at the end of the draft. If the user moves the cursor or has multiple unresolved markers before it, the extension keeps Pi's safe native behavior.

Supporting repeat expansion at any cursor position needs a public Pi editor operation that exposes or replaces one logical paste token without private-field access.

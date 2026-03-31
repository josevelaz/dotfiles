# Rose Pine Oh My Posh Design

## Goal

Update `.rose_pine.omp.json` in the repo root so the primary prompt uses exactly these segments, in order: `executiontime`, `path`, `git`. Remove the current `os` and `session` segments. Match the bubble theme's behavior where specified below while keeping the Rose Pine palette and shaped segment styling.

## Accepted Design

- Use exactly this primary prompt element set and order: `executiontime`, `path`, `git`
- Remove the current `os` and `session` segments
- Restore the bubble theme's two-line prompt layout using `newline: true`
- Add a transient prompt equivalent to the bubble theme's `transient_prompt`
- Preserve the Rose Pine look by keeping shaped prompt segments instead of switching to the bubble theme's plain segment style
- Keep `final_space: true`
- Use config `version: 4`

## Segment Behavior

### Execution Time

- Add an `executiontime` segment before `path`
- Keep the same threshold behavior as the bubble theme (`150ms`)
- Style it with Rose Pine colors that read as supporting metadata rather than the primary prompt focus

### Path

- Keep the path segment as a main prompt element
- Preserve Rose Pine styling and shaped separators
- Keep the current Rose Pine path presentation behavior and shaped styling; for this segment, parity with the bubble theme only means its position in the prompt order

### Transient Prompt

- Add a `transient_prompt` block
- Use the same template content as the bubble theme: ` ❯ `
- Preserve bubble-theme behavior by using one color for success and a different color for non-zero exit status, remapped into the Rose Pine palette

### Git

- Keep the git segment after `path`
- Match the bubble theme's git behavior by setting `fetch_status: true`
- Match the bubble theme's concise branch behavior by setting `branch_max_length: 25`
- Include upstream and branch status information in the template so ahead/behind state is visible
- Preserve Rose Pine shaped styling and status-aware coloring within the Rose Pine palette

## Styling Direction

- Use the Rose Pine palette already defined in `/.rose_pine.omp.json`
- Keep decorative `diamond`/`powerline` styling rather than converting to plain text segments
- Keep the prompt visually cohesive across both prompt lines and transient prompt output

## Validation

- Validate renderability with `oh-my-posh print valid --config ./.rose_pine.omp.json --shell uni`
- Render the prompt locally with `oh-my-posh print primary --config ... --shell uni`
- Render the transient prompt locally with `oh-my-posh print transient --config ./.rose_pine.omp.json --shell uni`

## Non-Goals

- Do not clone the bubble theme's neon palette
- Do not convert the Rose Pine prompt into a plain-text prompt
- Do not add extra prompt segments that are not present in the bubble theme request

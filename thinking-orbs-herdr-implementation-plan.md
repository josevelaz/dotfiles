# Thinking Orbs Implementation Plan

## Fixed implementation decisions

- Port the geometry engine to native Rust.
- Use a 4-column × 2-row indicator in expanded agent entries.
- Provide Braille rendering for all terminals.
- Add an RGBA Kitty-graphics renderer for compatible clients.
- Animate at 8 FPS only while a working orb is visible.
- Keep existing symbols for non-working states and constrained layouts.
- Make the feature opt-in for its first release.

---

## Task 1: Define the feature and configuration contract

### Description

Add agent-sidebar-specific settings. Do not overload Herdr’s global status indicator setting.

Proposed configuration:

```toml
[ui.sidebar.agents]
working_indicator = "orb" # "status" remains the default
orb_motion = "animate"    # or "static"
```

Document the initial state mapping:

| Agent state | Indicator |
|---|---|
| Working | Thinking orb |
| Blocked | Existing blocked symbol |
| Done | Existing done symbol |
| Idle | Existing idle symbol |
| Unknown | Existing unknown symbol |

### Acceptance criteria

- [ ] Existing configuration remains valid without changes.
- [ ] The default configuration produces the current UI exactly.
- [ ] Invalid values fail with a clear configuration error.
- [ ] `orb_motion = "static"` selects a fixed frame and starts no timer.
- [ ] The settings apply only to agent entries in the sidebar.
- [ ] Collapsed sidebar, mobile, navigator, and workspace indicators retain their current behavior.

---

## Task 2: Import upstream fixtures and license data

### Description

Import the upstream conformance specification and golden vectors as test fixtures. Add the required MIT attribution.

Suggested files:

```text
tests/fixtures/thinking_orbs/orbs-spec.json
tests/fixtures/thinking_orbs/orbs-golden.json
THIRD-PARTY-NOTICES/thinking-orbs-LICENSE.txt
```

Pin the imported data to an upstream commit or released version.

### Acceptance criteria

- [ ] The imported upstream version and commit are recorded.
- [ ] The upstream MIT license and copyright notice are included.
- [ ] Fixture files are used only for tests and are not loaded at runtime.
- [ ] Herdr’s release package includes the third-party notice.
- [ ] A documented update procedure explains how to refresh the fixtures.

---

## Task 3: Port the thinking-orbs geometry engine

### Description

Create a pure Rust geometry module:

```text
src/ui/thinking_orb/
├── mod.rs
├── geometry.rs
├── modes.rs
├── presets.rs
└── types.rs
```

Use an interface similar to:

```rust
fn orb_frame(mode: OrbMode, size: f32, time: f32) -> OrbFrame;
```

`OrbFrame` contains only dots and lines. Time, theme, terminal state, and agent state must remain outside the geometry engine.

Port all nine upstream modes, even though the first UI integration uses only `working`.

### Acceptance criteria

- [ ] All nine upstream modes can produce an `OrbFrame`.
- [ ] The engine has no I/O, global clock, terminal, or application-state dependency.
- [ ] Calling the function twice with identical input produces identical output.
- [ ] All upstream golden cases pass within a documented floating-point tolerance.
- [ ] Invalid or extreme values cannot panic or allocate without a bound.
- [ ] The `working` mode at the 20-pixel preset matches upstream dot counts and geometry.
- [ ] No JavaScript runtime or browser dependency is introduced.

---

## Task 4: Implement the Braille renderer

### Description

Convert an `OrbFrame` into a 4×2 terminal-cell block. Each Braille cell represents a 2×4 subpixel grid, giving an 8×8 logical raster.

Use depth, radius, and opacity when deciding which Braille dots to enable. Apply Herdr’s working-state color and preserve the surrounding row background.

Suggested file:

```text
src/ui/thinking_orb/braille.rs
```

### Acceptance criteria

- [ ] The renderer always produces exactly four columns by two rows.
- [ ] Fixed-time snapshots exist for every orb mode.
- [ ] Snapshots cover light and dark themes.
- [ ] The active-row background remains visible around the orb.
- [ ] Output remains valid when partially clipped.
- [ ] Empty and line-only frames do not panic.
- [ ] The renderer introduces no runtime dependency.
- [ ] The `working` animation is recognizable at normal terminal scale.

---

## Task 5: Add the sidebar indicator area

### Description

Refactor expanded agent rows to reserve a fixed 4×2 indicator area when orb mode is enabled.

Keep this area reserved for all agent states so text does not shift when an agent starts or stops working. Center existing static status symbols inside the area for non-working states.

Likely touchpoints:

```text
src/ui/sidebar.rs
src/ui/status.rs
src/config/sidebar.rs
```

### Acceptance criteria

- [ ] Working agents show a static orb frame before animation is added.
- [ ] Non-working agents show their existing symbols in the same fixed-width area.
- [ ] Agent text does not move when state changes.
- [ ] The entry remains two rows high.
- [ ] Active, selected, blocked, and inactive row styles remain correct.
- [ ] Narrow or one-row layouts fall back to the existing one-cell indicator.
- [ ] The collapsed sidebar retains its current one-cell indicator.
- [ ] Disabling orb mode yields byte-for-byte equivalent cell output to the current renderer.

---

## Task 6: Create retained orb placement plans

### Description

Record the exact orb rectangles produced by each full sidebar render. Store this presentation data with each client’s retained render state, not in domain `AppState`.

Example internal structure:

```rust
struct OrbPlacement {
    agent_id: AgentId,
    rect: Rect,
    active_row: bool,
}
```

Add a patch operation that updates only these rectangles.

### Acceptance criteria

- [ ] Each client has an independent placement plan based on its dimensions and scroll position.
- [ ] Scrolled-off and clipped agents are excluded.
- [ ] An orb-only update touches no cells outside registered orb rectangles.
- [ ] Orb-only updates do not invoke pane or Ghostty rendering.
- [ ] Orb-only updates do not allocate a full-frame buffer.
- [ ] A full render invalidates and replaces the previous placement plan.
- [ ] Full renders take precedence over concurrent orb ticks.
- [ ] Tests prove that patched output equals a full render at the same animation time.

---

## Task 7: Add the demand-driven animation clock

### Description

Add a presentation-only clock with a default interval of 125 ms, or 8 FPS.

The clock must run only when at least one client has a visible, animated working orb. All working orbs use the same phase.

Do not restore the former `spinner_tick` field in application domain state.

### Acceptance criteria

- [ ] No timer runs when orb mode is disabled.
- [ ] No timer runs in static-motion mode.
- [ ] No timer runs when the sidebar is hidden or collapsed.
- [ ] No timer runs when no visible agent is working.
- [ ] All visible working orbs share one calculated geometry frame per tick.
- [ ] Slow clients do not cause animation ticks to queue.
- [ ] A newer tick replaces any pending stale tick.
- [ ] Animation resumes after a working orb becomes visible.
- [ ] Tests use a fake clock and contain no timing-based sleeps.
- [ ] Every tick uses the retained patch path from Task 6.

---

## Task 8: Support the monolithic terminal path

### Description

Ensure `--no-session` or other non-headless execution modes can apply the same bounded cell updates.

Patch the backend and Ratatui’s retained buffer together so the next full render does not overwrite or incorrectly diff the current orb frame.

### Acceptance criteria

- [ ] Animated orbs work in both persistent server mode and monolithic mode.
- [ ] The monolithic animation path updates only orb cells.
- [ ] Ratatui’s retained buffer stays consistent with terminal output.
- [ ] Resize, suspend, resume, and terminal restoration remain correct.
- [ ] A full render during an orb update produces no stale cells.
- [ ] Terminal shutdown leaves no partial escape sequences or cursor corruption.

---

## Task 9: Add the Kitty RGBA renderer

### Description

Add a pixel renderer for clients that already support Herdr’s experimental Kitty graphics path.

Render onto a transparent canvas matching the physical dimensions of the 4×2 cell area. Center the square orb to avoid distortion. Upload one image per client and frame, then reuse it for all visible working-agent placements.

Likely touchpoints:

```text
src/ui/thinking_orb/rgba.rs
src/kitty_graphics.rs
src/server/render_stream.rs
```

### Acceptance criteria

- [ ] Kitty rendering activates only when the client capability is proven.
- [ ] Unsupported clients automatically use Braille.
- [ ] One working-orb image is generated and uploaded per client per tick.
- [ ] Multiple agents reuse that image through separate placements.
- [ ] Sidebar image and placement IDs cannot collide with pane graphics.
- [ ] Old placements are deleted after state, layout, scroll, or visibility changes.
- [ ] Transparent pixels preserve the row background.
- [ ] The orb keeps a square aspect ratio for different terminal cell dimensions.
- [ ] Graphics payloads remain below existing bounded frame limits.
- [ ] Disconnecting or disabling graphics leaves no stale images.

---

## Task 10: Add optional structured activity modes

### Description

Introduce the remaining orb modes only when Herdr receives a structured activity fact. Do not infer activity from transcript text, command strings, or status labels.

Example values:

```text
working
searching
solving
listening
connecting
weaving
composing
breathing
shaping
```

This is a later milestone and must remain independent of the initial working indicator.

### Acceptance criteria

- [ ] The activity value is optional and backward compatible.
- [ ] Missing activity maps to the standard `working` orb.
- [ ] Unknown activity values fail safely to `working`.
- [ ] Lifecycle state remains authoritative for blocked, done, and idle behavior.
- [ ] No transcript or command-text heuristic selects an orb mode.
- [ ] The activity model is a neutral agent fact, not a terminal-rendering instruction.
- [ ] At least one integration test proves an explicitly reported activity selects the matching mode.

---

## Task 11: Add automated regression coverage

### Description

Add unit, snapshot, integration, and render-equivalence tests.

The test matrix must cover:

- All orb modes at fixed times.
- Light and dark themes.
- Working and non-working states.
- Active and inactive rows.
- Narrow and collapsed layouts.
- Scrolling and clipping.
- Multiple clients with different sizes.
- Concurrent PTY and animation updates.
- Reduced-motion behavior.
- Kitty fallback and cleanup.

### Acceptance criteria

- [ ] Upstream geometry conformance tests pass.
- [ ] Braille snapshots are deterministic.
- [ ] Orb-only patches equal full-render results.
- [ ] Tests detect writes outside the orb rectangle.
- [ ] Tests prove pane rendering is not entered on orb-only ticks.
- [ ] Multi-client tests prove that placements do not leak between clients.
- [ ] Existing sidebar and status tests pass unchanged where behavior is not enabled.
- [ ] `just check` passes.

---

## Task 12: Run performance and terminal compatibility proof

### Description

Reproduce the workload from Herdr issue #1862 and compare static indicators against animated orbs.

Suggested workload:

- Three connected clients.
- Ten visible working agents.
- A mix of active PTY output and idle panes.
- A 60-second measurement after warm-up.

Test both Braille and Kitty rendering.

### Acceptance criteria

- [ ] Orb-only ticks perform zero full virtual renders.
- [ ] Orb-only ticks perform zero pane renders.
- [ ] Median CPU increase is no more than one percentage point of one core against the static baseline.
- [ ] Memory use remains stable during a ten-minute run.
- [ ] Frame queues remain bounded with a deliberately slow client.
- [ ] Ghostty, Kitty, and WezTerm pass the graphics test.
- [ ] Terminal.app or iTerm2 passes the Braille fallback test.
- [ ] tmux and SSH sessions render the Braille fallback correctly.
- [ ] Results and exact commands are recorded in the repository.

---

## Task 13: Document and stage the rollout

### Description

Document configuration, renderer selection, motion control, terminal compatibility, and troubleshooting.

Keep the feature opt-in for one release. Consider changing the default only after performance and compatibility evidence is available.

### Acceptance criteria

- [ ] Configuration reference includes both new settings.
- [ ] Documentation explains Braille versus Kitty rendering.
- [ ] Reduced-motion instructions are explicit.
- [ ] Documentation states that only `working` is automatic without structured activity.
- [ ] Release notes mention the opt-in feature and terminal requirements.
- [ ] The third-party license notice ships with release artifacts.
- [ ] The existing static indicator remains a supported fallback.
- [ ] Enabling the feature requires no external process or package installation.

---

## Milestones

1. **Portable MVP:** Tasks 1–8 and 11–13.
2. **Pixel renderer:** Task 9.
3. **Semantic activity modes:** Task 10.

---

## Final validation

Run this procedure after all tasks in the intended milestone are complete.

### 1. Clean validation environment

- Start from a clean Herdr checkout at the intended release commit.
- Record the Rust toolchain, operating system, terminal versions, and Herdr commit.
- Remove previous benchmark output and stop existing test servers.

**Pass condition:** The checkout is clean and the environment details are stored with the validation results.

### 2. Static quality gate

Run:

```bash
just check
```

**Pass conditions:**

- Formatting passes.
- Compilation and lint checks pass.
- Unit and integration tests pass.
- No ignored or quarantined test is required to make the result green.

### 3. Geometry conformance gate

Run the thinking-orbs golden-vector tests for all nine modes and all imported fixture cases.

**Pass conditions:**

- Every golden case passes within the documented tolerance.
- Running the suite repeatedly produces identical results.
- The test report identifies the pinned upstream source version.

### 4. Default-behavior regression gate

Run sidebar render snapshots with orb configuration absent and explicitly disabled.

**Pass conditions:**

- Existing sidebar output remains unchanged.
- No animation timer starts.
- No Kitty image or placement command is emitted.
- Collapsed, mobile, navigator, and workspace displays remain unchanged.

### 5. Retained-render correctness gate

Run equivalent scenarios through both a full render and the orb-only patch path.

Include:

- Agent state changes.
- Scrolling and clipping.
- Client resize.
- Theme changes.
- Concurrent PTY output.
- Kitty placement creation and deletion.

**Pass conditions:**

- Final cell and graphics output is equivalent.
- Orb-only ticks touch only registered orb regions.
- Orb-only ticks perform zero pane renders and zero full virtual renders.
- No stale cell, image, or placement remains after a state or layout change.

### 6. Performance gate

Measure the static baseline and animated implementation with three clients and ten visible working agents. Use a 60-second measured interval after warm-up, followed by a ten-minute soak test.

**Pass conditions:**

- Median CPU increases by no more than one percentage point of one core.
- Memory use does not grow continuously during the soak test.
- Slow clients do not create an unbounded frame queue.
- Animation ticks are coalesced when rendering falls behind.
- No pane rendering occurs due only to orb animation.

### 7. Terminal compatibility gate

Validate these environments:

| Environment | Expected renderer |
|---|---|
| Ghostty with Kitty graphics enabled | RGBA |
| Kitty with graphics enabled | RGBA |
| WezTerm with graphics enabled | RGBA |
| Terminal.app or iTerm2 | Braille |
| tmux | Braille unless graphics support is explicitly proven |
| SSH or remote client | Braille |
| Narrow or collapsed sidebar | Existing one-cell symbol |

**Pass conditions:**

- Each environment selects the expected renderer.
- The orb has no visible aspect-ratio distortion.
- Resize, disconnect, reconnect, suspend, and resume leave no artifacts.
- Static-motion mode displays no animation in every environment.

### 8. Packaging and documentation gate

Build the same artifacts intended for release and inspect their contents.

**Pass conditions:**

- The thinking-orbs MIT notice is present.
- No JavaScript, browser, Node, or external sidecar runtime is required.
- Configuration and reduced-motion documentation match the implementation.
- Release notes state whether the feature is opt-in.
- A new installation with default settings retains static indicators.

### 9. Final release decision

The milestone is valid only when all preceding gates pass. Record:

- The validated Herdr commit.
- Exact commands and test results.
- Benchmark data.
- Terminal matrix results.
- Known limitations.
- The reviewer’s approval or rejection.

**Final acceptance criteria:**

- [ ] All task-level acceptance criteria for the milestone are complete.
- [ ] All final validation gates pass without an undocumented exception.
- [ ] The working tree is clean after validation.
- [ ] The evidence can be reproduced from the recorded commit and commands.
- [ ] Any failed gate blocks release rather than silently degrading the requirement.

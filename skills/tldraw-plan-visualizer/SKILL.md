---
name: tldraw-plan-visualizer
description: Turn implementation plans into detailed, easy-to-scan tldraw diagrams with phases, steps, dependencies, questions, blockers, verification, and a short lesson on codebase impact; use when a user asks to visualize, map, explain, or teach a plan.
---

# Tldraw Plan Visualizer

Create a clear tldraw diagram that explains an implementation plan and how it changes the codebase. This skill does not replace the plan or invent missing requirements. It depends on the `tldraw-offline` skill for the live canvas API and uses repository evidence when a codebase is available.

## When to Use

Use this skill for requests such as:

- “Visualize this implementation plan in tldraw.”
- “Make this plan easy to scan and understand.”
- “Diagram the phases, dependencies, blockers, and tests.”
- “Show how this plan affects the codebase.”
- “Teach me this plan after drawing it.”

Do not use it for a generic drawing that has no plan, workflow, or codebase impact to explain.

## Prerequisites

- The `tldraw-offline` skill is installed and available. Load it before canvas work.
- tldraw Desktop is running with the target document open, or the user permits a new document.
- The local tldraw server is reachable. Its default URL is `http://localhost:7236`.
- The per-launch server token is available from `/Users/jose/Library/Application Support/tldraw/server.json` when it is not already in context.
- `bash`, `read`, `jq`, and `curl` are available. Prefer the `tq` helper when present.
- The plan is in the conversation, a local file, or a known repository path.

## How to Use

Give the agent a plan or its path and, when needed, name the target tldraw document:

```text
Visualize @plans/auth-migration.md in tldraw. Include all dependencies,
questions, blockers, and verification work, then teach me how it affects the codebase.
```

The result is one saved canvas plus a short teaching lesson in the response. Preserve the plan’s terms and distinguish facts from unresolved items.

## Quick Reference

- Base URL: `http://localhost:7236`
- Server state: `/Users/jose/Library/Application Support/tldraw/server.json`
- Helper: `sh "$HOME/skills/tldraw-offline/tq" <METHOD> <path> [body]`
- Discover documents: `POST /api/search`
- Create document: `POST /api/docs/create`
- Edit document: `POST /api/doc/:id/exec`
- Read shapes and bindings: `POST /api/search`
- API help: `GET /readme`
- Required connection helper: `helpers.createArrowBetweenShapes(fromId, toId, options)`
- Required quality check: `helpers.getLints()`
- Required save call: `helpers.saveDoc()`

## Procedure

1. **Load the canvas dependency.**
   - Read the complete `tldraw-offline` skill before calling the local API.
   - Follow its authentication, document recovery, editing, and safety rules.
   - Use `tq` when available. Otherwise, read the port and token again in each `bash` call because shell state does not persist.

2. **Read the full plan and gather code evidence.**
   - Use `read` for the plan and relevant source files.
   - Use `ls`, `find`, and `grep` through `bash` to locate named modules, tests, configs, schemas, and entry points.
   - Inspect only enough code to explain the plan accurately. Do not modify repository files.
   - Mark statements as inferred when the plan does not identify an exact file or symbol.

3. **Build a complete plan inventory before drawing.**
   - Record the plan title, goal, scope, and completion condition.
   - Give each phase and step a short stable ID, such as `P2` and `P2-S3`.
   - For every step, capture its action, affected file or subsystem, prerequisite, output, and verification.
   - Record explicit dependencies, decisions, open questions, blockers, risks, and external requirements.
   - Do not turn an open question into a decision or a possible risk into a confirmed blocker.

4. **Select the correct document safely.**
   - Discover open documents and match the intended name or previously captured document identity.
   - If the task needs a new canvas, create it with `POST /api/docs/create`; do not create a `.tldraw` file with filesystem tools.
   - Before clearing or rebuilding a canvas, inspect its shapes. Stop if the content does not match the intended document.

5. **Design the information layout before creating shapes.**
   - Use a left-to-right sequence of phase columns so the main implementation path reads naturally.
   - Put steps in top-to-bottom order within each phase.
   - Put the goal and legend in a header band.
   - Put questions and blockers in a separate right-side rail.
   - Put verification steps and the completion condition in a bottom band.
   - Use short card titles and compact details. Keep exact file paths and symbols when they add useful precision.
   - Start with at least 160 page units between phase columns and 80 units between step cards. Increase spacing when text wraps or routes are crowded.
   - Use consistent card sizes within each lane, but enlarge a card rather than clipping important text.

6. **Create a simple visual hierarchy.**
   - Give phases the strongest labels, steps the next strongest labels, and metadata the least emphasis.
   - Use one consistent visual treatment for each class: phase, step, question, blocker, and verification.
   - Keep the palette small and readable. Do not rely on color alone; include text labels such as `QUESTION`, `BLOCKER`, and `VERIFY`.
   - Keep decorative elements to a minimum so the plan remains the focus.

7. **Create shapes and route dependencies.**
   - Create stable shape IDs so later corrections can update rather than duplicate shapes.
   - Use `helpers.createArrowBetweenShapes(fromId, toId, options)` for every meaningful connection. This keeps both endpoints bound.
   - Read `/readme` or the relevant API recipe before choosing arrow options; use only options the live API documents.
   - Make dependency arrows curved and label each with a short relation, such as `requires`, `unblocks`, `after`, or `verified by`.
   - Route arrows through the empty gutters between phase columns, not through cards.
   - Use separate upper and lower routing corridors when multiple long dependencies would cross.
   - Keep arrow labels away from cards and other labels. Place each label near the clearest part of its route.
   - Do not use raw unbound arrows for dependencies.

8. **Check geometry and revise before saving.**
   - Read all shape bounds and bindings after creation.
   - Confirm that no two boxes overlap and that every box has visible whitespace around it.
   - Confirm that no arrow passes through a box, intersects a label, or shares an unreadable path with another arrow.
   - Confirm that labels fit within their shapes and the main flow reads left to right.
   - Capture a large or full canvas screenshot when visual placement is uncertain.
   - Move shapes, widen gutters, or reroute arrows until the diagram is easy to scan at a glance and useful under close inspection.

9. **Lint, save, and verify once.**
   - Run `helpers.getLints()` and fix every actionable result.
   - Save with `helpers.saveDoc()`.
   - Read the final shapes and bindings once. Check that every inventory item appears and every meaningful dependency has a binding.
   - Stop after one successful final verification unless the user asks for another revision.

10. **Teach the plan after the diagram is complete.**
    - Give a short lesson in plain language, using this order:
      1. What the codebase does now.
      2. What each phase changes and why that order matters.
      3. Which files, modules, interfaces, data flows, or runtime paths change.
      4. Where dependencies, blockers, and open questions can alter the work.
      5. How the verification steps prove the result.
      6. What the first safe implementation step is.
    - Link the lesson to phase and step IDs from the canvas so the user can follow visually.
    - Separate confirmed code evidence from inference.
    - Keep it brief enough to read in a few minutes, but include the critical architectural effects.

11. **Report the result.**
    - State the document name and ID.
    - Summarize the phases, step count, dependency count, questions, blockers, and verification items.
    - Report the lint result and the final visual check.
    - Include the teaching lesson. If a fact could not be verified, state the gap directly.

## Pitfalls

- Do not draw while still discovering the plan; incomplete inventory produces missing or duplicated work.
- Do not infer a dependency only because two steps are adjacent. Use the plan or code flow as evidence.
- Do not force all connections onto straight lines. Dense straight arrows often cross cards and each other.
- Do not reduce text until important constraints disappear. Increase space before deleting useful detail.
- Do not encode status only by color; labels must remain understandable in grayscale.
- Do not retry a closed document ID or switch to an unrelated open canvas.
- Do not edit `.tldraw` archives, tldraw database files, or lock files directly.
- Do not claim the diagram is clear from shape records alone when routing is dense; inspect a screenshot.
- Do not provide a generic lesson. Tie each codebase effect to evidence and a canvas step ID.

## Verification

Run a final live-editor check through `tq` and require zero actionable lints plus bound meaningful arrows:

```bash
sh "$HOME/skills/tldraw-offline/tq" POST /api/doc/DOC_ID/exec 'const lints = await helpers.getLints(); const arrows = editor.getCurrentPageShapes().filter(s => s.type === "arrow"); const bindings = editor.getBindingsFromShape ? arrows.flatMap(a => editor.getBindingsFromShape(a.id)) : []; return { lints, arrowCount: arrows.length, bindingCount: bindings.length, shapeCount: editor.getCurrentPageShapes().length }'
```

Then inspect one final large or full canvas screenshot and confirm: no overlapping boxes, no arrows crossing boxes or labels, readable arrow labels, all plan inventory sections present, and the teaching lesson references the same phase and step IDs.

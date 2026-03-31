---
name: figma-vibma-design
description: Use when reading, creating, or editing Figma designs through the Vibma MCP server, especially for selection-based inspection, token-aware design implementation, structured text replacement, instance override transfer, or when design prompts live in `/tmp/` or Obsidian notes.
---

# Figma Vibma Design

## Overview

Use this skill as the operating guide for Vibma-based Figma work. Start by understanding the current document, selection, design tokens, and structure before creating or editing anything.

## Connection And Access Checks

Start with connection health:

1. Join the Vibma channel.
2. Ping the Figma plugin connection.
3. If the plugin is not connected, tell the user to check the Vibma plugin window, confirm the channel name, and reconnect before continuing.

If the user wants creation or edit work but tools like `create_frame`, `create_text`, `patch_nodes`, `delete_node`, or `set_text_content` are unavailable, the MCP server likely started without the correct access tier flag.

Vibma filters tools at startup based on CLI flags passed in the MCP config `args` array:

| Flag | Tools available |
|------|------------------|
| _(none)_ | Read-only (inspect, search, export) |
| `--create` | Read + creation tools |
| `--edit` | All tools (read + create + edit + delete) |

Tell the user to add `--edit` (or `--create`) to their MCP config args:

```json
{
  "mcpServers": {
    "Vibma": {
      "command": "npx",
      "args": ["-y", "@ufira/vibma", "--edit"]
    }
  }
}
```

After updating, the user must restart their AI tool or reload MCP servers because stdio-based servers cannot hot-reload.

## Design Reading Workflow

Start with selection:

- First use `get_selection()` to understand the current selection.
- If no selection exists, ask the user to select one or more nodes.
- When needed, inspect the current document and current page before reading deeper into selected nodes.
- Use `get_node_info()` with only the fields and depth needed for the task to keep the inspection focused.

When summarizing a design, focus on:

- structure and hierarchy
- auto-layout usage
- component and instance relationships
- styles, variables, and text styles already in use
- likely editing risk areas such as dense tables, repeated cards, or nested instances

## Design Creation And Editing Workflow

Follow these rules when building or modifying designs:

### Understand before creating

- Use `get_document_info()` to see pages and current page.
- Use styles and variables APIs to discover existing design tokens.
- Plan the layout hierarchy before creating elements.

### Use design tokens, never hardcode when a token exists

- Colors: use `fillStyleName` and `strokeStyleName`, or variable bindings such as `fillVariableId` and `strokeVariableId`.
- Text: use `textStyleName` so font size, weight, and line height move together.
- Effects: prefer effect styles when available.
- Only use raw fill or font colors for true one-off values that are not part of the design system.

### Auto-layout first

- Use `create_frame()` with `layoutMode: "VERTICAL"` or `layoutMode: "HORIZONTAL"` for every container that should manage child spacing.
- Set padding, spacing, alignment, and sizing behavior at creation time.
- Use `layoutSizingHorizontal` and `layoutSizingVertical` with `FILL` where responsive children should stretch.
- Avoid absolute positioning when auto-layout can express the structure.

### Naming conventions

- Use descriptive, semantic names for all elements.
- Avoid leaving nodes named `Frame`, `Rectangle`, or other defaults.
- Before variant set creation, name components with a `Property=Value` pattern such as `Size=Small`.

### Variable modes

- Use `set_explicit_variable_mode()` to pin a frame to a specific mode when the design requires it.
- Use `get_node_variables()` to verify which variables are bound to a node.

### Quality check with lint

After building or editing a section, run `lint_node()` to catch common issues:

- `hardcoded-color`
- `no-text-style`
- `no-autolayout`
- `default-name`

Use `lint_fix_autolayout()` when it is an appropriate fix. Lint early and often because it is cheaper to fix issues during creation than after the design is larger.

## Swap Component Instance Overrides

Transfer content overrides from a source instance to target instances with a structured process.

### 1. Identify instances

- Use `get_selection()` to identify selected instances.
- Use `search_nodes(types: ["INSTANCE"])` when you need to find related instances on the page.

### 2. Extract source overrides

- Use `instances(method: "get", id: "source-instance-id")`.
- Read the `mainComponentId` and the per-child override fields.

### 3. Apply overrides to targets

- For text overrides, use `set_text_content` on matching child node IDs.
- For style overrides, use `patch_nodes` with fill, stroke, text, or effect style fields.
- Match children by name path because source and target instances share the same internal structure.

### 4. Verify

- Use `get_node_info(..., depth: 1)` on target instances.
- Use `export_node_as_image` for visual verification when the change is significant.

## Intelligent Text Replacement Strategy

Text is a design element, not just content. Replace it in a way that preserves layout and hierarchy.

### 1. Analyze design and identify structure

- Use `scan_text_nodes()` first.
- Optionally inspect node structure with `get_node_info()`.
- Detect patterns such as tables, lists, card groups, forms, and navigation.

### 2. Choose a chunking strategy

Pick the strategy that best fits the design:

- structural chunking
- spatial chunking
- semantic chunking
- component-based chunking

### 3. Replace progressively with verification

- Create a safe copy of the node before large replacement work when cloning is appropriate.
- Replace text chunk by chunk.
- After each chunk, export a small verification image.
- Fix issues before moving to the next chunk.

### 4. Handle table data carefully

- Process one row or one column at a time.
- Preserve header-to-data relationships.
- Watch spacing and alignment across cells.

### 5. Adapt text intelligently

- Respect space constraints.
- Apply line breaks at natural linguistic boundaries.
- Preserve hierarchy and emphasis.
- Shorten or scale only when necessary to preserve design integrity.

### 6. Keep a feedback loop

- Give progress updates while processing large replacements.
- Use each verified chunk to improve the next one.

### 7. Finish with full verification

- Export the entire design at reduced scale after all chunks are processed.
- Check for cross-chunk consistency problems.
- Verify overall harmony across the full composition.

### 8. Export scale guidelines

- Small chunks (1-5 elements): `1.0`
- Medium chunks (6-20 elements): `0.7`
- Large chunks (21-50 elements): `0.5`
- Very large chunks (50+ elements): `0.3`
- Full design verification: `0.2`

## Obsidian And Prompt-Source Workflow

When prompt material exists outside the immediate chat:

- Check `/tmp/` for transient prompt files when the user references them.
- Check `/Users/josevelaz/obsidian_notes/notes/` for persistent design notes when the user references them.
- If the task depends on a running Obsidian environment, load `obsidian-cli` and use the Obsidian CLI workflow instead of guessing note contents.
- Convert external prompt material into a compact working brief before touching Figma.

The brief should capture:

- goal of the design task
- constraints and non-goals
- required content or copy
- style or token expectations
- verification requirements

## Quality Gates

Before concluding, check that:

- no hardcoded color is used when an existing token is available
- no text node is left without a text style when a text style should apply
- no default-name nodes remain in the edited area
- no container tree lacks auto-layout when auto-layout is the correct structure
- important lint findings are fixed or clearly called out
- major text replacements were verified visually

## Common Mistakes

- Starting to create nodes before inspecting tokens and page context
- Using raw colors when matching styles or variables already exist
- Replacing all text at once in a dense layout without chunk verification
- Treating instances like arbitrary frames instead of matching children by shared name path
- Forgetting to ask for a selection when reading work starts with no selected nodes
- Guessing missing permission or MCP configuration instead of stating the limitation clearly

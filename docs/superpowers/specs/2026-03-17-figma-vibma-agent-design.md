---
title: Figma Vibma Agent And Skill Design
date: 2026-03-17
status: draft
---

# Figma Vibma Agent And Skill Design

## Goal

Create an OpenCode subagent and a companion reusable skill for Figma work through the Vibma MCP server.

The agent should specialize in reading, creating, and editing Figma designs with Vibma, and be able to work from prompts and notes stored in `/tmp/` and `/Users/josevelaz/obsidian_notes/notes/` while also using the Obsidian CLI workflow when needed.

## Why This Shape

The implementation should split responsibilities between:

- a thin OpenCode agent file that defines role, trigger conditions, model, and tool expectations
- a reusable skill that holds the durable operating workflow for Vibma-based Figma work

This keeps the agent easy to maintain while making the Figma workflow reusable by other agents in the future.

## Chosen Approach

### Recommended approach

Create:

1. one new subagent file under `.config/opencode/agent/`
2. one new skill directory under `.agents/skills/`

The agent should instruct itself to load the companion skill before starting Figma work. The skill should contain the detailed workflow and guardrails.

### Alternatives considered

#### Agent-heavy design

Put the long Figma workflow directly in the agent file and keep the skill minimal.

Rejected because the agent file would become harder to maintain and the workflow would be less reusable.

#### Multiple narrow skills

Split the workflow into separate skills for reading, building, and text replacement.

Rejected for now because the current need is one cohesive specialist with a single activation surface.

## Files To Create

### Agent file

- `.config/opencode/agent/figma-vibma-designer.md`

This file should follow the existing agent frontmatter pattern seen in `.config/opencode/agent/systematic-code-reviewer.md` and `.config/opencode/agent/ui-fidelity-auditor.md`.

### Skill files

- `.agents/skills/figma-vibma-design/SKILL.md`

No extra supporting files are required initially unless the skill becomes too large.

## Agent Design

### Frontmatter

The agent file should define:

- `description`: when to use the agent
- `mode: subagent`
- `tools`: leave the agent write-capable and able to use the relevant MCP tools

The agent should not be configured as read-only because the job includes creating and editing Figma content.

### Agent responsibilities

The agent should:

- specialize in Figma work through Vibma
- focus on design implementation, design reading, structured text replacement, and instance override transfer
- load the companion skill before beginning Vibma work
- use Obsidian CLI when prompts or notes are stored in Obsidian
- read from `/tmp/` and `/Users/josevelaz/obsidian_notes/notes/` when the task references external prompt material
- surface missing Vibma access tier problems clearly when create or edit tools are unavailable

### Agent prompt content

The agent prompt should stay concise and cover:

- role and scope
- instruction to load the companion skill first
- expectation to use Vibma as the primary Figma interface
- expectation to consult local prompt sources in `/tmp/` and Obsidian notes when relevant
- expectation to explain missing MCP access tier issues with the exact `--create` or `--edit` fix pattern

## Skill Design

### Skill purpose

The skill should encode the durable Vibma workflow so the agent can reliably perform Figma tasks without re-learning the process every session.

### Skill name and trigger

Name:

- `figma-vibma-design`

Description should start with `Use when...` and trigger on:

- creating or editing designs in Figma through Vibma
- reading an existing Figma selection or frame tree
- replacing text at scale in a design
- transferring instance overrides between related instances
- working from design prompts stored in Obsidian notes or temporary files

### Skill sections

The skill should include these sections.

#### Overview

Define the skill as the operating guide for Vibma-based Figma work, with an emphasis on understanding existing document structure before creating or editing anything.

#### Connection and access checks

Document the expected startup flow:

1. join the Vibma channel
2. ping the Figma plugin connection
3. if editing tools like `create_frame`, `create_text`, `patch_nodes`, `delete_node`, or `set_text_content` are missing, tell the user that Vibma likely started without `--create` or `--edit`
4. provide the exact config snippet showing `"args": ["-y", "@ufira/vibma", "--edit"]`
5. remind the user that stdio MCP servers require restart or reload after config changes

#### Design reading workflow

Include the reading best practices supplied by the user:

- start with `get_selection()`
- if no selection exists, ask the user to select one or more nodes
- inspect the current document and page structure before deeper operations when needed

#### Design creation and editing workflow

Include the design implementation best practices supplied by the user:

- use document/page inspection first
- inspect styles and variables before creating content
- prefer design tokens over hardcoded values
- use auto-layout first for containers
- use semantic names for all nodes
- use component naming patterns like `Property=Value` before variant set creation
- use explicit variable modes when needed
- verify variable bindings when appropriate
- lint early and often

The skill should explicitly prefer Vibma token-aware APIs such as style names and variable bindings instead of raw colors whenever possible.

#### Structured text replacement workflow

Include the user-provided strategy:

- scan text nodes first
- detect structure such as tables, forms, cards, navigation, and lists
- chunk replacement work structurally, spatially, semantically, or by component family
- clone before large replacement passes when safe duplication is appropriate
- replace text progressively
- export small verification images between chunks
- adjust chunk export scale based on chunk size
- do a final whole-design verification export

#### Instance override transfer workflow

Include the user-provided swap strategy:

- inspect selected instances
- find other instances if needed
- fetch source instance overrides
- apply text overrides with `set_text_content`
- apply style overrides with `patch_nodes`
- match children by name path
- verify targets using node inspection and optional image export

#### Obsidian and prompt-source workflow

The skill should define how to use external prompt material:

- check `/tmp/` for transient prompt files when referenced by the user
- check `/Users/josevelaz/obsidian_notes/notes/` for persistent design notes when referenced by the user
- use the Obsidian CLI skill and commands when interacting with notes in a running Obsidian environment
- pull prompt content into a compact working brief before starting Figma operations

#### Quality gates

The skill should require:

- no hardcoded colors when a token exists
- no unstyled text when a text style exists
- no unnamed default nodes left behind
- no container trees without auto-layout when auto-layout is the right structure
- lint findings to be fixed or explicitly called out before concluding

## Behavior Details

### Expected default sequence for creation work

1. confirm Vibma connectivity
2. inspect document and current page
3. inspect local styles and variables
4. plan hierarchy
5. create or patch nodes with token-aware fields
6. lint created sections
7. fix issues and verify bindings

### Expected default sequence for reading work

1. inspect selection
2. if nothing is selected, ask for a selection
3. inspect the selected tree at the right depth
4. summarize structure and tokens in use

### Expected default sequence for text replacement work

1. inspect selection and scan text nodes
2. infer structure and chunking strategy
3. clone when a safe copy is useful
4. replace chunk by chunk
5. export chunk images for verification
6. run final verification export

## Permissions And Environment Caveat

The desired behavior includes reading from `/tmp/` and `/Users/josevelaz/obsidian_notes/notes/`.

This spec assumes two layers:

1. the agent and skill instructions will tell the model to use those locations
2. if OpenCode enforces per-agent filesystem allowlists in a separate config file, that config may need an additional follow-up edit

Current repo exploration found the agent markdown format and evidence of per-agent permission handling in OpenCode plugin code, but it did not conclusively identify the local user config file that stores those permission entries. Implementation should therefore:

- create the agent and skill files now
- attempt to locate the applicable config safely during implementation
- if no local config file is discoverable, document the follow-up step instead of guessing

## Acceptance Criteria

The work is complete when:

- a new OpenCode subagent exists for Vibma-based Figma work
- a new reusable skill exists for Vibma-based Figma design workflows
- the skill captures the user-provided best practices for reading, creation, token use, auto-layout, linting, text replacement, and instance override transfer
- the agent instructs itself to use the companion skill first
- the agent references Obsidian notes and `/tmp/` inputs as valid prompt sources
- missing Vibma `--create` or `--edit` access is handled with the documented recovery guidance
- any unresolved per-agent permission-config wiring is clearly documented for the user

## Non-Goals

This work should not:

- implement a full multi-agent Figma system
- add multiple specialized Figma skills unless the first skill proves too large
- invent unsupported OpenCode config fields without confirming their format locally

## Testing And Verification

Implementation verification should include:

- reading back the created agent file and skill file for correctness
- checking that the agent frontmatter matches the existing local format
- checking that the skill frontmatter follows local skill conventions
- verifying that instructions mention the exact missing-tool recovery for Vibma access tiers
- verifying that the documented paths `/tmp/` and `/Users/josevelaz/obsidian_notes/notes/` appear where intended

If a local OpenCode config file for per-agent permissions is found during implementation, verify any added entries by reading the file back after the change.

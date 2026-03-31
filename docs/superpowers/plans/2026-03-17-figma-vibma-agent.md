# Figma Vibma Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new OpenCode subagent for Vibma-based Figma work and a companion reusable skill that captures the required reading, creation, linting, text replacement, and override-transfer workflow.

**Architecture:** Add one thin subagent file under `.config/opencode/agent/` and one reusable skill under `.agents/skills/`. Keep durable Vibma operating guidance in the skill, while the agent prompt stays focused on role, model, tool expectations, prompt-source handling, and mandatory skill usage.

**Tech Stack:** OpenCode subagent markdown, skill markdown, Vibma MCP, Obsidian CLI guidance

---

## Chunk 1: Agent Definition

### Task 1: Create the Figma Vibma subagent

**Files:**
- Create: `.config/opencode/agent/figma-vibma-designer.md`
- Reference: `.config/opencode/agent/systematic-code-reviewer.md`
- Reference: `.config/opencode/agent/ui-fidelity-auditor.md`

- [ ] **Step 1: Re-read existing agent files for frontmatter and tone**

Run: inspect `.config/opencode/agent/systematic-code-reviewer.md` and `.config/opencode/agent/ui-fidelity-auditor.md`
Expected: confirm frontmatter keys, examples style, and tool block conventions

- [ ] **Step 2: Write the new agent frontmatter**

Include:
- `description` with trigger-oriented wording and one or two examples
- `mode: subagent`
- `tools` block that does not deny edit or write

- [ ] **Step 3: Write the agent body**

Include:
- specialization in Vibma-based Figma work
- instruction to load `figma-vibma-design` before Figma tasks
- guidance to use `/tmp/` and `/Users/josevelaz/obsidian_notes/notes/` as prompt sources when referenced
- guidance to use Obsidian CLI when working from Obsidian notes
- explicit missing `--edit` or `--create` recovery instructions for missing Vibma edit tools

- [ ] **Step 4: Read the created agent file back**

Run: read `.config/opencode/agent/figma-vibma-designer.md`
Expected: frontmatter matches local conventions and body stays concise

## Chunk 2: Skill Definition

### Task 2: Create the companion skill

**Files:**
- Create: `.agents/skills/figma-vibma-design/SKILL.md`
- Reference: `.agents/skills/obsidian-cli/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-17-figma-vibma-agent-design.md`

- [ ] **Step 1: Create the skill frontmatter**

Include:
- `name: figma-vibma-design`
- `description` starting with `Use when...`

- [ ] **Step 2: Write the workflow sections**

Cover:
- overview
- connection and access checks
- design reading workflow
- design creation and editing workflow
- structured text replacement workflow
- instance override transfer workflow
- Obsidian and prompt-source workflow
- quality gates and common mistakes

- [ ] **Step 3: Preserve required recovery guidance exactly**

Include the exact JSON snippet showing:

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

Also include the requirement to restart or reload MCP servers because stdio servers cannot hot-reload.

- [ ] **Step 4: Read the created skill back**

Run: read `.agents/skills/figma-vibma-design/SKILL.md`
Expected: required workflows and guardrails are present and reusable

## Chunk 3: Verification

### Task 3: Verify created files and document remaining caveat

**Files:**
- Verify: `.config/opencode/agent/figma-vibma-designer.md`
- Verify: `.agents/skills/figma-vibma-design/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-17-figma-vibma-agent-design.md`

- [ ] **Step 1: Check required paths and model references**

Verify these literals appear where intended:
- `/tmp/`
- `/Users/josevelaz/obsidian_notes/notes/`

- [ ] **Step 2: Check the Vibma guidance coverage**

Verify the files mention:
- selection-first reading
- token-first design creation
- auto-layout-first containers
- lint guidance
- chunked text replacement
- instance override transfer
- missing-tool recovery

- [ ] **Step 3: Confirm unresolved permission wiring is not guessed**

If no concrete local per-agent allowlist config is found, leave the implementation at agent-plus-skill creation and document the remaining follow-up clearly in the handoff.

- [ ] **Step 4: Summarize completion and next actions**

Report created paths and any remaining manual permission-config step.

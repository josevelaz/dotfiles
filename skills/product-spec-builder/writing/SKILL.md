---
name: product-spec-builder-writing
description: Write a polished, review-ready product spec or PRD from an already understood product direction. Use this when the user needs the actual document for stakeholder review, design, engineering alignment, or roadmap planning.
---

# product-spec-builder/writing

Use this skill when the team already understands the problem and rough scope, and now needs the actual product spec document.

The goal is to produce a clean, decisive artifact that is easy for product, design, engineering, and stakeholders to review.

## Outcomes

By the end of this stage, the user should have:

- A polished product spec or PRD
- Clear structure and readable decision-making language
- Requirements, metrics, and risks captured in one place
- A document that can be reviewed without extra translation

## Workflow

### 1. Stabilize the inputs

Before writing, identify:

- The problem being solved
- The target user
- The proposed solution
- The intended scope
- The success criteria

If these are still unstable, recommend returning to scoping rather than writing fake certainty.

### 2. Draft the document around decisions

Write the spec so each section helps a reviewer answer a useful question:

- What problem are we solving
- Why this approach
- What exactly are we shipping
- What are we not shipping yet
- How will we know it worked
- What could go wrong

### 3. Make requirements buildable

Requirements should be clear enough that design and engineering can react, estimate, and challenge them.

Use concrete behavior, not aspiration language.

### 4. Make the tradeoffs visible

A good spec makes the choices legible:

- What is optimized for now
- What is deferred
- What assumptions are being made
- Which open questions remain

### 5. Polish for review

Tighten repetition, remove filler, and make the recommendation obvious.

## Writing guidance

- Sound like a strong product lead, not a generic template generator
- Be concise but complete
- Prefer strong nouns and verbs over soft qualifiers
- Avoid fluff such as "seamless," "innovative," or "user-friendly" unless backed by specifics
- If a section is weak because input context is thin, label assumptions directly

## Default output format

```md
# [Feature or initiative name]

## Overview
2-4 paragraphs explaining the problem, proposed solution, and why this matters now.

## Problem
- Who is affected
- Current pain or missed opportunity
- Why existing behavior is insufficient

## Goal
- Primary outcome
- Secondary outcomes if relevant

## Non-goals
- Explicitly out of scope items

## Target users
- Primary users
- Secondary users or stakeholders

## Proposed solution
- Core experience
- Key workflow or user journey
- Important behaviors and edge cases

## Requirements
### Functional requirements
- Requirement list

### UX requirements
- State, messaging, interaction, and accessibility expectations

### Operational requirements
- Admin, support, rollout, migration, policy, or compliance details if applicable

## Success metrics
- User metrics
- Business metrics
- Guardrails

## Risks and tradeoffs
- Key concerns and what the team is choosing not to optimize for yet

## Open questions
- Questions that need answers before final commitment

## Launch approach
- MVP scope
- Rollout notes
- Dependencies

## Recommendation
- Clear suggested path forward
```

## Final quality check

Before presenting, ensure the spec:

- Clearly explains the problem
- Contains decisions, not just descriptions
- Has enough behavioral detail to estimate scope
- Includes measurable success criteria
- Names risks, assumptions, and open questions
- Reads like something a team could actually review

---
name: product-spec-builder-scoping
description: Turn a known product idea into a scoped plan before full PRD writing. Use this when the problem is already understood and the user needs help defining goals, non-goals, MVP boundaries, requirements, success metrics, tradeoffs, and launch scope.
---

# product-spec-builder/scoping

Use this skill when the product opportunity is already understood and the main job is to decide what should actually be built first.

The goal is to create decision-ready scope, not polished prose.

## Outcomes

By the end of this stage, the user should have:

- Clear goals and non-goals
- A defendable MVP boundary
- A requirement frame that engineering and design can react to
- Defined success metrics and guardrails
- Known risks, dependencies, and open decisions

## Workflow

### 1. Confirm the problem and proposed direction

State the problem and candidate solution briefly so the scope work has a stable frame.

If the problem is still muddy, send the work back to discovery.

### 2. Define what success means

Clarify:

- Primary product outcome
- Secondary outcomes if relevant
- User outcomes vs business outcomes
- Guardrails that prevent local optimization

### 3. Draw the boundary

Convert the idea into:

- Goals
- Non-goals
- In-scope MVP capabilities
- Out-of-scope items for later phases

Bias toward the smallest useful version that still creates learning or value.

### 4. Shape the experience and requirements

Describe the essential behavior in buildable terms:

- Key user flow
- Core states and failure states
- Permissions or role differences
- Content, messaging, and support needs
- Analytics or measurement needs

Then translate this into requirement bullets.

### 5. Identify tradeoffs and delivery risk

Always call out:

- What the MVP intentionally does not optimize for
- Dependencies and sequencing risk
- Technical, operational, policy, or adoption risks
- Open questions that should block commitment if unanswered

### 6. Recommend whether the scope is ready for writing

If the boundaries are coherent, hand off to the writing stage. If not, tighten further.

## Writing guidance

- Favor decisions over brainstorming
- Be explicit about what is excluded
- Avoid inflated requirement lists that hide uncertainty
- Keep the scope sized to the team and moment

## Output format

```md
# [Feature or initiative name]

## Problem and direction
- Concise restatement of the problem and proposed approach

## Goals
- Primary outcome
- Secondary outcomes

## Non-goals
- Explicit out-of-scope items

## MVP scope
- What version one includes

## Out of scope for now
- What waits until later

## Experience notes
- Key flow
- Important states
- Role or permission differences

## Requirements
### Functional
- Requirement list

### UX and content
- Interaction, messaging, and state handling expectations

### Measurement
- Events, metrics, and dashboards if needed

## Success metrics
- User metrics
- Business metrics
- Guardrails

## Risks and dependencies
- Major concerns and blockers

## Open questions
- Decisions still required

## Recommendation
- Whether this is ready for a formal product spec
```

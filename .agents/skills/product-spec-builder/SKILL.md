---
name: product-spec-builder
description: "Route product-spec work to the right stage: discovery, scoping, or writing. Use this when the user asks for help turning a product idea into a spec, PRD, feature brief, MVP plan, or requirements document and the correct stage is not yet obvious."
---

# product-spec-builder

This is the umbrella skill for product-spec work.

Its job is to recognize which stage the user is in, then hand off to the most relevant nested stage skill so the agent does not load unnecessary instructions.

## Stage model

Use these three stages:

- **Discovery**: understand the problem, user, opportunity, and why this matters
- **Scoping**: define goals, non-goals, MVP boundaries, requirements, tradeoffs, and risks
- **Writing**: turn the agreed direction into a clean, review-ready product spec or PRD

## Routing rules

### Route to `product-spec-builder/discovery` when the user is still figuring out the idea

Signals:

- The request is fuzzy, exploratory, or full of open possibilities
- The user has a solution idea but not a clear problem statement
- The audience, user segment, or business rationale is unclear
- The user wants help thinking through what should exist before discussing exact requirements

Example requests:

- "I have a rough idea for a support dashboard but it is messy"
- "Help me think through whether we should build a pause subscription flow"
- "Turn this idea into something we can evaluate"

### Route to `product-spec-builder/scoping` when the idea exists but the boundaries are still loose

Signals:

- The team generally agrees on the problem or opportunity
- The user needs help defining MVP scope, requirements, or success metrics
- The risk is overbuilding, underspecifying, or mixing too many initiatives together
- The user asks what should be in or out of scope

Example requests:

- "Scope the MVP for this feature"
- "Help me define the requirements and non-goals"
- "What should version one include"

### Route to `product-spec-builder/writing` when the direction is mostly known and the user needs the actual document

Signals:

- The user asks for a PRD, product spec, one-pager, feature brief, or launch-ready writeup
- The core problem and proposed solution are already mostly understood
- The user wants a polished artifact for review by product, design, engineering, or stakeholders

Example requests:

- "Write the PRD"
- "Turn this into a feature spec"
- "Create a one-pager the team can review"

## If the stage is unclear

Default to the earliest stage that would reduce ambiguity.

- If the problem is unclear, use discovery
- If the problem is clear but the boundaries are unclear, use scoping
- If the boundaries are mostly clear, use writing

## Handoff behavior

When you route:

1. Briefly state which stage you are using and why
2. Follow that stage skill's workflow
3. Preserve any useful assumptions or decisions from the user's context
4. If the work naturally completes one stage and needs the next one, transition explicitly instead of silently blending stages

## Output expectation

The output should match the selected stage:

- Discovery outputs a clarified product opportunity
- Scoping outputs a decision-ready scope and requirement frame
- Writing outputs a polished spec document

---
name: product-spec-builder-discovery
description: Clarify early-stage product ideas before writing a spec. Use this when the user has a rough feature idea, unclear problem statement, uncertain user value, or needs help turning a messy concept into a structured product opportunity.
---

# product-spec-builder/discovery

Use this skill for the earliest stage of product-spec work: figuring out what problem is worth solving and why.

The goal is not to write a polished PRD yet. The goal is to turn ambiguity into a strong problem frame.

## Outcomes

By the end of this stage, the user should have:

- A clear problem statement
- A defined target user or audience
- A plausible reason this matters now
- An initial hypothesis for the product change
- The major unknowns that still need answers

## Workflow

### 1. Start with the raw idea

Capture what the user thinks they want, but do not stop there.

Look for:

- Proposed solution language
- Implicit pain points
- Target users hiding inside the request
- Business motivations that are implied but unstated

### 2. Recover the underlying problem

Translate the idea into a concrete product problem:

- Who is experiencing friction
- What they are trying to do
- What gets in the way today
- What the current cost of the problem is
- Why now is a reasonable time to address it

If the request is solution-first, gently reframe it around the user's need.

### 3. Identify the user and context

Clarify:

- Primary user
- Secondary users or stakeholders
- Usage context, moment, or workflow
- Frequency and severity of the problem

If there are multiple user groups, separate them instead of blending them.

### 4. Define the product opportunity

Summarize:

- The opportunity being created
- The likely value to users
- The likely value to the business
- What success might look like at a high level

Keep this directional, not over-specified.

### 5. Surface uncertainty

Always list:

- Assumptions
- Open questions
- Important constraints already visible
- Research or stakeholder validation that would reduce risk

### 6. Recommend the next stage

Usually the next step is scoping. If the idea is still weak, recommend more discovery instead of pretending it is spec-ready.

## Writing guidance

- Be sharp and synthesis-heavy
- Prefer diagnosis over enthusiasm
- Make ambiguity visible instead of papering over it
- Suggest a narrower framing if the idea is too broad

## Output format

```md
# [Idea or initiative name]

## Raw idea
- Brief restatement of the user's starting concept

## Problem statement
- Who has the problem
- What they are trying to do
- What is broken or missing today
- Why it matters

## Target users
- Primary users
- Secondary users or stakeholders

## Opportunity
- User value
- Business value
- Why now

## Hypothesis
- If we do X for Y user, we expect Z outcome

## Assumptions
- Current assumptions to validate

## Open questions
- What still needs to be answered

## Recommended next step
- Whether to move into scoping, research more, or drop the idea
```

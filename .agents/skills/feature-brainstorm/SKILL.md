---
name: feature-brainstorm
description: Brainstorm feature ideas and change directions before implementation. Use this when the user wants help thinking through a feature, refactor, workflow change, UX change, or system improvement and would benefit from several viable alternatives, requirement narrowing, tradeoff analysis, assumption-challenging questions, and a clearer spec direction before writing code. Also use it when the user already has a preferred approach but wants it pressure-tested or wants help thinking outside the box.
---

# Feature Brainstorm

Use this skill when the user is still figuring out what they should build or change.

Also use it when the user seems mostly decided, but the situation would benefit from pressure-testing the plan, surfacing non-obvious alternatives, or challenging default assumptions before work begins.

The job is not to jump straight into implementation. The job is to turn a vague or prematurely-settled request into a small set of credible options, help the user choose, and leave them with a clearer requirement frame or mini-spec.

## Outcomes

By the end of this skill, the user should have:

- a clearer understanding of the problem or opportunity
- 2-4 realistic alternatives worth considering
- the main tradeoffs between those alternatives
- narrowed requirements based on explicit answers from the user
- a recommended direction or a short list of viable paths
- a next step: prototype, scope, spec, or implementation
- more confidence that the chosen direction survived useful challenge

## Default stance

- Diverge first, converge second.
- Present real alternatives, not reworded versions of the same idea.
- Challenge the obvious path, especially when the user already sounds convinced.
- Include at least one non-obvious or outside-the-box angle when it could plausibly help.
- Prefer a compact batch of clarifying questions over a long interrogation.
- Use the `question` tool to narrow requirements whenever there is genuine ambiguity, missing constraints, or a decision the user should make.
- Use the `question` tool not only to clarify, but to force prioritization and expose hidden assumptions.
- Recommend, do not just dump options.

## When to use

Use this skill when the user says things like:

- "Help me think through this feature"
- "What are a few ways we could build this?"
- "I'm not sure what the right approach is"
- "Brainstorm options before we implement"
- "Help me narrow the requirements"
- "Turn this rough idea into something we can spec"
- "What should we change here?"
- "I think we should do X, but challenge that"
- "Pressure-test this approach before we build it"

This skill is especially useful when the user is discussing:

- new features
- refactors with product impact
- UX or workflow changes
- admin, settings, onboarding, dashboard, or automation ideas
- architectural changes where product behavior is still undecided
- situations where the team has a default solution and wants stronger alternatives

## Workflow

### 1. Restate the starting point

Briefly summarize:

- what the user wants to improve, build, or change
- who it affects
- what seems unclear or still undecided

This creates a shared frame before brainstorming.

### 2. Identify what is missing

Look for gaps in:

- target user or actor
- desired outcome
- success criteria
- constraints
- existing workflow or baseline behavior
- technical, product, or operational risks

If the request is already clear enough, do not stall. Move on.

### 3. Challenge the default frame

Before narrowing too quickly, test whether the current framing is too narrow, too solution-first, or stuck in local maxima.

Actively look for:

- assumptions the user may be taking for granted
- a cheaper or simpler path
- a bolder path with more upside
- a workflow or UX reframing instead of a pure feature addition
- a process, policy, or data-model fix instead of a UI fix
- reasons not to build the proposed thing at all

If the user already has a preferred approach, do not fight them for sport. Pressure-test it constructively.

### 4. Use the `question` tool to narrow the decision space

When important ambiguity exists, use the `question` tool instead of plain chat questions.

Ask a compact batch of high-leverage questions with concrete options. Good question themes include:

- who this is for
- what problem matters most
- whether speed, simplicity, flexibility, or power matters more
- whether this should be MVP, scalable foundation, or exploratory prototype
- what constraints are hard requirements versus preferences
- what should explicitly stay out of scope

Prefer multiple-choice options that help the user decide quickly. Leave room for custom input.

Do not ask everything. Ask only what changes the recommendation.

When the user seems settled, use questions that test conviction and priorities, such as:

- what failure mode worries you most?
- if you had to cut this in half, what would remain?
- what would make you reject your current preferred approach?
- are you optimizing for speed, adoption, simplicity, control, or long-term leverage?

### 5. Generate several distinct alternatives

Produce 2-4 alternatives. Each one should represent a meaningfully different strategy, not cosmetic variation.

When appropriate, make the set include:

- a practical default option
- a low-complexity or low-risk option
- a more ambitious or outside-the-box option
- the user's current preferred option, if they already have one

For each alternative, include:

- name
- short description
- when it is the best choice
- advantages
- drawbacks or risks
- complexity level

Useful axes of variation:

- fast MVP vs robust foundation
- guided workflow vs flexible system
- manual control vs automation
- centralized solution vs incremental patch
- lightweight UI change vs deeper model/process change

If all options feel too similar, widen the lens and try again.

### 6. Compare and recommend

After presenting options:

- identify the strongest default recommendation
- explain why it wins for this user's context
- call out the main tradeoff the user is accepting
- say what would make another option better instead

A good brainstorm ends with a point of view.

Explicitly call out:

- which assumption was most worth challenging
- which option is safest
- which option has the highest upside

### 7. Converge into a requirement frame

Once the user responds, synthesize the decision into a compact requirement frame.

Capture:

- goal
- target users
- in-scope behavior
- out-of-scope behavior
- constraints
- open questions
- recommended next step

If enough clarity exists, turn this into a mini-spec. If not, clearly state what remains unresolved.

## Writing guidance

- Be generative, but grounded.
- Prefer sharp differences between options.
- Make tradeoffs obvious.
- Keep the first pass broad enough to be useful, but not so broad that it becomes generic fluff.
- If one direction is clearly strongest, say so.
- If the user already has a preferred path, still offer alternatives that pressure-test it.
- Be respectfully contrarian when it helps.
- Include at least one thought that expands the frame, not just one that optimizes within it.
- Do not silently convert brainstorming into implementation planning unless the user is ready.

## Output format

Use a structure close to this:

```md
# [Feature or change idea]

## Current framing
- What the user wants to change
- Who it affects
- What is still unclear

## Key requirements or constraints
- Known requirements
- Known constraints
- Unknowns that matter

## Alternatives
### Option 1: [name]
- Approach
- Best when
- Pros
- Cons
- Complexity

### Option 2: [name]
- Approach
- Best when
- Pros
- Cons
- Complexity

### Option 3: [name]
- Approach
- Best when
- Pros
- Cons
- Complexity

## Recommendation
- Best default path
- Why it wins
- Main tradeoff
- Assumption worth challenging
- Highest-upside alternative

## Requirement frame
- Goal
- Users
- In scope
- Out of scope
- Constraints
- Open questions

## Next step
- Brainstorm more, scope MVP, write spec, or implement
```

## Example triggers

- "I'm adding approvals to our workflow tool and want a few ways to structure it before we commit."
- "Help me brainstorm options for improving onboarding without making the UI much heavier."
- "We should probably refactor this settings flow, but I'm not sure whether to redesign it or patch the current model."
- "Give me several approaches for adding AI suggestions to this editor and help me narrow requirements."

## Related skills

- Use `product-spec-builder-discovery` when the user needs deeper problem framing around why the feature should exist.
- Use `product-spec-builder-scoping` when the direction is chosen and the next job is defining MVP boundaries and requirements.

# AdonisJS v7 And Inertia.js v2 Skills Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create three reusable skills that guide LLMs toward accurate, current best practices for AdonisJS v7, Inertia.js v2, and the AdonisJS Inertia integration boundary.

**Architecture:** Add three self-contained skill directories under `.agents/skills/`, one for backend AdonisJS guidance, one for Inertia client-consumption guidance, and one for the Adonis/Inertia seam. Ground every framework-specific rule and code reference in current Context7 docs for Node.js/TypeScript, AdonisJS, `@adonisjs/inertia`, Inertia.js v2, and React-facing examples where needed.

**Tech Stack:** Skill markdown, Context7 docs, AdonisJS v7, `@adonisjs/inertia`, Inertia.js v2, React

---

## Chunk 1: Ground Truth And Test Cases

### Task 1: Re-establish current source references and implementation guardrails

**Files:**
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
- Create: working notes in scratchpad only, no committed file required

- [ ] **Step 1: Re-read the approved spec**

Run: inspect `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
Expected: confirm the 3-skill split, current-doc requirements, and boundary rules before drafting any skill text

- [ ] **Step 2: Re-query current docs before writing skill content**

Re-check these sources in Context7:
- `/nodejs/node`
- `/reactjs/react.dev`
- `/adonisjs/v7-docs`
- `/adonisjs/inertia`
- `/websites/inertiajs_v2`

Expected: confirm all code references and terminology are current for Node.js runtime expectations, AdonisJS APIs, `@adonisjs/inertia` adapter APIs, Inertia v2 semantics including `@inertiajs/react` usage, and plain React core syntax/hooks

- [ ] **Step 3: Record implementation guardrails in working notes**

Capture these non-negotiables for the drafting pass:
- use only accurate Node.js, AdonisJS, `@adonisjs/inertia`, and React references
- do not present optional project patterns as official framework conventions
- do not treat transformers and DTO-style contracts as interchangeable
- keep Inertia examples adapter-agnostic unless the point specifically needs React or the Adonis adapter
- require every Node.js-specific or React-specific snippet to be checked against `/nodejs/node` or `/reactjs/react.dev` before finalizing
- verify `@inertiajs/react`-specific examples against `/websites/inertiajs_v2`, and verify only plain React core syntax/hooks against `/reactjs/react.dev`

- [ ] **Step 4: Define failing pressure scenarios before writing skills**

Write at least one baseline scenario per skill family that would likely fail without the new skills, such as:
- Adonis route/controller/service layering drift
- Inertia page prop and form-flow drift
- Adonis/Inertia contract leakage and raw-model-to-page drift

Expected: each scenario clearly tests a common LLM failure mode the skill must correct

### Task 2: Run RED-phase baseline checks for the skills themselves

**Files:**
- Reference: `.agents/skills/writing-skills/SKILL.md`
- Create: baseline findings in scratchpad only, no committed file required

- [ ] **Step 1: Run baseline prompts without the new skills**

Test prompts should include tasks like:
- “Build an AdonisJS v7 users CRUD flow with validation and testing”
- “Build an Inertia v2 React page with shared props, form errors, and partial reloads”
- “Implement an AdonisJS controller that renders an Inertia page from service data”

Expected: collect the exact places where an unassisted agent reaches for stale APIs, fat controllers, weak page contracts, or vague testing advice

- [ ] **Step 2: Summarize the failure patterns**

Group findings into categories:
- stale framework syntax
- bad architectural boundaries
- vague validation guidance
- missing serialization boundaries
- incorrect Inertia mutation flow
- weak or mis-layered tests

- [ ] **Step 3: Turn each failure pattern into a drafting requirement**

Expected: each major failure observed in RED has a matching section, rule, anti-pattern, or quick-reference item in one of the three skills

## Chunk 2: Draft The Skills

### Task 3: Apply the shared skill structure to all three skills

**Files:**
- Create: `.agents/skills/adonisjs-v7/SKILL.md`
- Create: `.agents/skills/inertiajs-v2/SKILL.md`
- Create: `.agents/skills/adonisjs-inertia-stack/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`

- [ ] **Step 1: Use the required frontmatter shape everywhere**

Verify each skill uses YAML frontmatter with only:
- `name`
- `description`

- [ ] **Step 2: Apply the required section structure everywhere**

Ensure every skill includes:
- concise overview
- `When to Use`
- `When Not to Use`
- quick reference
- explicit defaults the LLM should prefer
- anti-patterns or common mistakes
- examples only when they clarify a non-obvious pattern

- [ ] **Step 3: Keep the structure consistent but the content specialized**

Expected: all three skills are easy to scan, but each one teaches only its own layer and responsibilities

### Task 4: Create `adonisjs-v7`

**Files:**
- Create: `.agents/skills/adonisjs-v7/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
- Reference: `.agents/skills/elysiajs/SKILL.md`

- [ ] **Step 1: Write the frontmatter**

Include:
- `name: adonisjs-v7`
- `description` beginning with `Use when...`

Expected: description is trigger-oriented, searchable, and does not summarize the full workflow

- [ ] **Step 2: Write the overview and boundary sections**

Cover:
- when to use the skill
- when not to use it
- quick-reference guidance for common Adonis decisions
- explicit defaults the LLM should prefer
- thin routes and thin controllers
- route grouping
- middleware and policy placement
- service classes as the default business-logic boundary
- action classes as optional project-specific structure only
- Lucid and query boundaries
- exception and error handling

- [ ] **Step 3: Add current AdonisJS v7 guidance with accurate references**

Include current examples or references for:
- `import router from '@adonisjs/core/services/router'`
- `import { controllers } from '#generated/controllers'`
- `router.resource(...)`
- route matchers
- VineJS with `request.validateUsing(...)`
- output serialization through current transformer guidance such as `BaseTransformer`

- [ ] **Step 4: Add testing and anti-pattern sections**

Cover:
- route/controller/service testing boundaries
- feature or integration tests vs controller-internals testing
- anti-patterns such as fat controllers, mixed validation layers, and raw model leakage

- [ ] **Step 5: Read the drafted skill back**

Run: read `.agents/skills/adonisjs-v7/SKILL.md`
Expected: all Adonis guidance is current, Node.js/TypeScript references are accurate, and optional patterns are clearly labeled as optional

### Task 5: Create `inertiajs-v2`

**Files:**
- Create: `.agents/skills/inertiajs-v2/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
- Reference: `.agents/skills/frontend-design/SKILL.md`

- [ ] **Step 1: Write the frontmatter**

Include:
- `name: inertiajs-v2`
- `description` beginning with `Use when...`

- [ ] **Step 2: Write the scope and boundary guidance**

Cover:
- page component conventions
- form submission patterns
- client-side consumption patterns only
- stable page prop usage
- shared props boundaries limited to true cross-app concerns
- keeping server-to-page contract design out of this skill and in `adonisjs-inertia-stack`

- [ ] **Step 3: Add current Inertia.js v2 guidance with accurate React-facing references**

Cover:
- redirect-based mutation success flows
- validation errors as page props
- automatic state preservation for mutating requests
- partial reloads using `only`
- deferred props
- server-driven SPA framing

If examples are needed, keep them accurate to React and avoid implying a different adapter unless explicitly labeled.

- [ ] **Step 4: Add testing and anti-pattern sections**

Cover:
- quick-reference guidance for common Inertia decisions
- explicit defaults the LLM should prefer
- component or page behavior tests
- avoiding duplicate client-side data fetching for server-owned data
- avoiding sprawling props and business logic inside page components

- [ ] **Step 5: Read the drafted skill back**

Run: read `.agents/skills/inertiajs-v2/SKILL.md`
Expected: React references are accurate, Inertia v2 semantics are current, and the skill stays adapter-agnostic unless an example needs React specificity

### Task 6: Create `adonisjs-inertia-stack`

**Files:**
- Create: `.agents/skills/adonisjs-inertia-stack/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
- Reference: `.agents/skills/better-auth-best-practices/SKILL.md`

- [ ] **Step 1: Write the frontmatter**

Include:
- `name: adonisjs-inertia-stack`
- `description` beginning with `Use when...`

- [ ] **Step 2: Write the integration-flow sections**

Cover the intended flow:
- route -> controller -> service -> transformer -> optional DTO-style handoff -> `inertia.render(...)` -> page

Make clear that transformers are for outgoing serialization and DTO-style contracts are optional handoff objects, not the same concept.

- [ ] **Step 3: Add current `@adonisjs/inertia` adapter guidance**

Cover:
- `inertia.render(...)`
- `BaseInertiaMiddleware.share(...)`
- shared auth, flash, and validation error flow
- typed shared props and typed page contracts when using the adapter typing surface
- pagination, filtering, and query-string conventions
- choosing between Inertia page responses and standalone API responses

- [ ] **Step 4: Add integration testing and anti-pattern sections**

Cover:
- Inertia-aware integration assertions when component and props matter
- page contract verification
- partial reload contract checks where relevant
- end-to-end testing guidance for full request-to-page flows
- anti-patterns such as raw models or query builders to pages, mixed JSON/API and page contracts, duplicated validation mapping, and client components becoming the source of truth for server workflow decisions

- [ ] **Step 5: Read the drafted skill back**

Run: read `.agents/skills/adonisjs-inertia-stack/SKILL.md`
Expected: adapter references are accurate to AdonisJS, server/client boundaries are clear, and contract guidance is stronger than either framework skill alone

## Chunk 3: Verification And Refinement

### Task 7: Run GREEN-phase verification against the new skills

**Files:**
- Verify: `.agents/skills/adonisjs-v7/SKILL.md`
- Verify: `.agents/skills/inertiajs-v2/SKILL.md`
- Verify: `.agents/skills/adonisjs-inertia-stack/SKILL.md`

- [ ] **Step 1: Re-run the earlier pressure scenarios with the new skills available**

Expected: the agent now uses current AdonisJS imports and validation APIs, current Inertia v2 flow, correct React-facing examples, and stronger boundary guidance

- [ ] **Step 2: Compare RED vs GREEN behavior**

Verify improvements in:
- route/controller/service separation
- validation-at-the-edge guidance
- transformer vs DTO distinction
- Inertia redirect and error flow
- Adonis-to-Inertia page contract quality
- testing recommendations by layer

- [ ] **Step 3: Patch skill wording for any new loopholes**

If testing reveals rationalizations such as stale APIs, ambiguous React examples, or action classes framed too strongly, revise the affected skill and re-run the targeted scenario.

### Task 8: Final accuracy pass for code references and terminology

**Files:**
- Verify: `.agents/skills/adonisjs-v7/SKILL.md`
- Verify: `.agents/skills/inertiajs-v2/SKILL.md`
- Verify: `.agents/skills/adonisjs-inertia-stack/SKILL.md`

- [ ] **Step 1: Check every code reference against current docs**

Verify that all referenced code, imports, and terminology are accurate to:
- Node.js runtime expectations used in examples
- AdonisJS v7 APIs
- `@adonisjs/inertia` adapter APIs
- Inertia.js v2 semantics
- `@inertiajs/react` usage where React-facing Inertia examples are mentioned
- plain React core syntax and hooks where React itself is mentioned

- [ ] **Step 2: Record per-snippet source ownership during verification**

For every framework-specific snippet or literal API reference, record which source owns it:
- Node.js core -> `/nodejs/node`
- AdonisJS core -> `/adonisjs/v7-docs`
- AdonisJS Inertia adapter -> `/adonisjs/inertia`
- Inertia React adapter or Inertia transport semantics -> `/websites/inertiajs_v2`
- React core syntax or hooks -> `/reactjs/react.dev`

- [ ] **Step 3: Remove or rewrite anything ambiguous or stale**

Expected: no copied older Adonis patterns, no adapter confusion, no framework-agnostic examples pretending to be React, and no React examples using inaccurate conventions

- [ ] **Step 4: Confirm skill discoverability and consistency**

Verify:
- names use only letters, numbers, and hyphens
- descriptions start with `Use when...`
- descriptions focus on trigger conditions, not workflow summaries
- all three skills are self-contained unless a truly necessary supporting file was added

### Task 9: Final spec and process compliance pass

**Files:**
- Verify: `.agents/skills/adonisjs-v7/SKILL.md`
- Verify: `.agents/skills/inertiajs-v2/SKILL.md`
- Verify: `.agents/skills/adonisjs-inertia-stack/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`
- Reference: `.agents/skills/writing-skills/SKILL.md`

- [ ] **Step 1: Map each skill back to the approved acceptance criteria**

Verify the completed skills collectively cover:
- current AdonisJS v7 guidance
- current Inertia.js v2 guidance
- current `@adonisjs/inertia` guidance
- routes, controllers, services, transformers, validation, and testing
- explicit integration-boundary guidance
- anti-patterns and common mistakes

- [ ] **Step 2: Map the implementation back to local `writing-skills` requirements**

Verify the work includes:
- RED-phase baseline scenarios
- GREEN-phase drafted skills
- REFACTOR updates for loopholes found in verification
- trigger-oriented descriptions
- self-contained skill structure unless a supporting file was truly necessary

- [ ] **Step 3: Fix any missing coverage before handoff**

Expected: the implementation matches both the approved spec and the local skill-authoring process before it is reported complete

### Task 10: Prepare handoff summary

**Files:**
- Verify: `.agents/skills/adonisjs-v7/SKILL.md`
- Verify: `.agents/skills/inertiajs-v2/SKILL.md`
- Verify: `.agents/skills/adonisjs-inertia-stack/SKILL.md`
- Reference: `docs/superpowers/specs/2026-03-24-adonis-inertia-skills-design.md`

- [ ] **Step 1: Summarize created files and what each skill owns**

Report:
- created paths
- one-line purpose of each skill
- any intentional adapter-specific choices made in examples

- [ ] **Step 2: Summarize the verification evidence**

Report:
- which Context7 sources were checked
- which RED/GREEN scenarios were used
- which wording changes were made to close loopholes

- [ ] **Step 3: Flag any unresolved documentation edge cases**

If an example area still requires a narrow supporting reference file, note it explicitly; otherwise confirm that the implementation stayed self-contained as planned.

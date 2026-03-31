---
title: AdonisJS v7 And Inertia.js v2 Skill Design
date: 2026-03-24
status: draft
---

# AdonisJS v7 And Inertia.js v2 Skill Design

## Goal

Create a focused skill set that helps LLMs work with the latest AdonisJS v7 and Inertia.js v2 patterns, with strong guidance around architecture, boundaries, validation, serialization, routing, and testing.

The skills should teach good full-stack habits instead of only exposing framework APIs.

## Source Of Truth

The implementation should ground framework-specific guidance in the latest Context7 documentation for:

- AdonisJS v7 via `/adonisjs/v7-docs`
- Inertia.js v2 via `/websites/inertiajs_v2`
- AdonisJS Inertia adapter via `/adonisjs/inertia`

The skills should avoid older Adonis conventions when newer v7 patterns differ.

## Chosen Approach

Create three focused skills.

1. `adonisjs-v7`
2. `inertiajs-v2`
3. `adonisjs-inertia-stack`

This split keeps discovery sharp and prevents one large skill from mixing backend, frontend, and integration concerns.

## Why This Shape

- `adonisjs-v7` can teach backend architecture without frontend noise.
- `inertiajs-v2` can teach server-driven page patterns without backend implementation details leaking into every section.
- `adonisjs-inertia-stack` can define the handoff contract between controller responses and page props, which is where many full-stack LLM mistakes happen.

This separation is preferable to one combined skill because LLMs should be able to load only the layer they need while still having a dedicated integration skill for cross-boundary work.

## Skill Boundaries

### `adonisjs-v7`

This skill should own:

- route definition and route grouping
- controller design
- middleware and policy placement
- service classes for business logic, with action classes treated as an optional project pattern rather than official framework structure
- validation at the HTTP boundary
- Lucid and query usage boundaries
- transformers for output shaping, while keeping DTO-style contracts as a separate optional pattern for stable handoff objects when a project needs them
- exception and error handling
- backend testing guidance

This skill should discourage:

- fat route files
- fat controllers
- business logic inside controllers
- leaking ORM models directly into every response or page payload
- validation spread loosely across multiple layers without a clear boundary

### `inertiajs-v2`

This skill should own:

- page component conventions
- shared props
- form submission patterns
- redirect and validation-error flows
- partial reloads
- deferred props
- page-level data consumption expectations
- frontend and component testing guidance

This skill should stay focused on client-side consumption patterns and should not become the main place where server-to-page contracts are designed.

This skill should discourage:

- treating Inertia like a client-side API-fetching framework by default
- duplicating server-owned data loading in client hooks
- unstable or sprawling page props
- pushing business logic into page components

### `adonisjs-inertia-stack`

This skill should own:

- how controllers render Inertia pages
- how services feed transformers and, when needed, separate DTO-style handoff objects
- how transformed data becomes page props
- auth, flash, and validation error flow across the boundary
- pagination, filtering, and query-string conventions
- choosing between Inertia page responses and standalone API endpoints
- integration and end-to-end testing guidance

This skill should be the primary place that defines server-to-page contract design and cross-boundary flow rules.

This skill should discourage:

- directly passing raw models or query builders to pages
- mixing JSON API and Inertia page contracts carelessly
- duplicating validation and error mapping without purpose
- letting client-side components become the source of truth for server workflow decisions

## Current Framework Guidance To Encode

### AdonisJS v7 specifics

The `adonisjs-v7` skill should explicitly align with current v7 conventions, including:

- `import router from '@adonisjs/core/services/router'`
- `import { controllers } from '#generated/controllers'`
- `router.resource(...)` and route groups when resourceful routing is appropriate
- route matchers for constrained route params
- VineJS validators with `request.validateUsing(...)`
- transformer guidance based on current Adonis transformer patterns such as `BaseTransformer`

The skill should frame service classes as the default place for business decisions, while controllers primarily orchestrate request validation, authorization, service calls, and response rendering.

If action classes are mentioned, they should be presented as an optional project-level convention built on top of Adonis, not as official v7 framework structure.

Transformer guidance should stay precise: Adonis transformers handle outgoing serialization, whereas DTO-style contracts are a separate optional pattern for handoff stability and should not be presented as interchangeable with transformers.

### Inertia.js v2 specifics

The `inertiajs-v2` skill should explicitly align with current v2 conventions, including:

- redirect-based form success flows
- validation errors arriving as page props
- automatic state preservation for mutating requests
- partial reloads using `only`
- deferred props for expensive secondary data
- server-provided shared props for true cross-app concerns only

The skill should frame Inertia as a server-driven SPA transport layer, not as a replacement for server-side controllers and validation.

Unless a task explicitly depends on a specific frontend adapter, the skill should keep guidance adapter-agnostic by default and only use adapter-specific examples when necessary.

### AdonisJS Inertia adapter specifics

The `adonisjs-inertia-stack` skill should explicitly align with the official Adonis adapter surface, including:

- `inertia.render(...)` in controllers
- `BaseInertiaMiddleware.share(...)` for shared props
- adapter-provided validation error sharing patterns
- typed shared props and typed page contracts when using the adapter typing surface
- Inertia-aware testing through the official adapter utilities and plugins when integration tests need to assert component and prop contracts

## File Layout

Create three new skill folders under `.agents/skills/`:

- `.agents/skills/adonisjs-v7/SKILL.md`
- `.agents/skills/inertiajs-v2/SKILL.md`
- `.agents/skills/adonisjs-inertia-stack/SKILL.md`

The first version should keep each skill mostly self-contained.

Do not create supporting reference files unless a topic becomes too large to stay readable inside `SKILL.md`.

## Skill Content Structure

Each skill should follow the local skill conventions already used in this repo:

- YAML frontmatter with `name` and `description`
- a trigger-oriented description that starts with `Use when...`
- concise overview
- clear sections for when to use and when not to use
- quick-reference guidance for common decisions
- explicit best-practice defaults
- common mistakes and anti-patterns
- examples only where they clarify a non-obvious pattern

The descriptions should be optimized for discovery and should not summarize the whole workflow so aggressively that the LLM skips reading the rest of the skill.

## Architectural Rules To Teach

The skills should reinforce these defaults unless the user explicitly asks for a different architecture.

- routes define HTTP shape and composition, not business logic
- controllers orchestrate request handling, not domain decisions
- service classes encapsulate business logic and coordination by default, with action classes treated as an optional project-specific pattern
- validation happens at the boundary of incoming data
- transformers handle outgoing serialization, while DTO-style contracts remain an optional handoff pattern when a project needs a stable page or API contract
- Inertia pages receive intentional props, not arbitrary backend objects
- shared props stay limited to cross-cutting concerns such as auth, flash, and environment-level context
- tests should follow the layer under test and verify boundaries, not only internal implementation details

## Testing Strategy For The Skills Themselves

Because this work creates skills, implementation should follow the local `writing-skills` process.

That means implementation should include:

- baseline pressure scenarios without the new skills
- documentation of where an LLM naturally makes poor Adonis or Inertia architectural choices
- skill content that explicitly counters those failures
- follow-up verification scenarios after drafting the skills

At minimum, testing should probe whether an LLM:

- keeps Adonis route files thin
- keeps controllers orchestration-focused
- chooses services or actions for business logic
- uses current Adonis v7 validation patterns
- uses transformer or DTO boundaries before rendering Inertia pages
- uses current Inertia v2 redirect and validation-error flow correctly
- avoids duplicating backend data-fetching logic in client components
- chooses integration tests where controller-to-page contracts matter

## Acceptance Criteria

The design is implemented successfully when:

- three new skills exist with the approved names
- AdonisJS guidance is based on current v7 Context7 documentation
- Inertia guidance is based on current v2 Context7 documentation
- the skills teach architecture and boundaries, not only API syntax
- routes, controllers, services, transformers, validation, and testing are all explicitly covered
- the integration skill clearly explains the Adonis-to-Inertia handoff
- the skills include anti-patterns and common mistakes that help prevent typical LLM architectural drift
- the first version remains self-contained unless a topic truly requires a supporting reference file

## Non-Goals

This work should not:

- create one giant framework dump that copies raw documentation into skills
- lock the user into a single folder structure if the framework allows reasonable variation
- assume older Adonis patterns remain correct in v7 without checking Context7-backed docs
- treat Inertia as a generic client-side data-fetching library

## Implementation Notes

- During implementation, re-check Context7 before finalizing framework-specific examples if there is any doubt about API drift.
- If extra references become necessary, keep them narrow and topic-specific instead of building a large parallel documentation set.
- Do not commit any generated skill files unless the user explicitly asks for a commit.

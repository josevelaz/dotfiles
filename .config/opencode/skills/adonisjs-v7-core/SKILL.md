---
name: adonisjs-v7-core
description: Use when building or refactoring AdonisJS v7 backend code, including routes, controllers, validation, DI, configuration, exceptions, and v6-to-v7 migration decisions.
---

# AdonisJS v7 Core Best Practices

This skill provides practical defaults for writing maintainable AdonisJS v7 backend code.

Reference docs:
- https://docs.adonisjs.com/guides/basics/routing
- https://docs.adonisjs.com/guides/basics/validation
- https://docs.adonisjs.com/guides/concepts/dependency-injection
- https://docs.adonisjs.com/guides/frontend/transformers
- https://docs.adonisjs.com/configuration
- https://docs.adonisjs.com/guides/basics/exception-handling
- https://docs.adonisjs.com/v6-to-v7

## Scope

Use this for:
- New backend features in AdonisJS v7
- Refactors from "fat controller" code into service-first architecture
- App setup and migration decisions (v6 -> v7)
- Stabilizing type safety and runtime behavior

## Baseline Requirements

- Node.js 24+ for v7 projects.
- Keep framework packages aligned to v7-compatible versions.
- Prefer official starter kits to avoid incorrect bootstrapping.

## Core Workflow

1. Start with route design (name routes early).
2. Validate input at the controller boundary with Vine.
3. Move business logic into injected services.
4. Serialize output using transformers.
5. Centralize error response behavior in the global exception handler.

## Routing Conventions

- Define static routes before dynamic routes.
- Prefer route names for redirects and URL generation. Note: controller and resource routes are auto-named; add `.as('posts.index')` for inline callback routes and any route name you want to stabilize.
- Use route param matchers (`router.matchers.number()`, `uuid()`, `slug()`) and `router.where` for global constraints.
- Group routes by prefix/middleware/name namespace when possible.

## Controller and Validation Pattern

- Keep controllers thin: parse request, validate, call service, transform response.
- Prefer dedicated validators in `app/validators`.
- Use `await request.validateUsing(validator)` for request data.
- Leverage validation metadata for context-aware rules (e.g., ignore current user in unique checks).

## Service and DI Pattern

- Put business logic in services and inject them with `@inject()`.
- Do not import dependencies as `import type` if they must be resolved at runtime.
- Register custom dependencies in service providers using container bindings.
- Use container swaps in tests instead of mutating production wiring.

## Serialization Contract

- Do not return raw models to the frontend by default.
- Use transformers as the stable output contract.
- Use variants for list/detail/admin shapes instead of conditional controller branching.
- Use generated client data types to keep frontend and backend in sync.

## Configuration and Environment

- Keep framework configuration inside `config/*.ts`.
- Read env through `#start/env` (`env.get`) only.
- Validate env with `start/env.ts` schema so invalid config fails fast.
- Keep `adonisrc.ts` for framework wiring (providers, hooks, preloads), not business logic.

## Error Handling

- Handle exceptions centrally in `app/exceptions/handler.ts`.
- Use `debug = !app.inProduction` and production status pages where appropriate.
- Ignore expected noise (`ignoreStatuses`, `ignoreCodes`) and report only actionable errors.
- Create domain-specific custom exceptions for clearer intent.

## v6 -> v7 Migration Guardrails

- Replace deprecated URL helpers with `urlFor` service usage.
- Move encryption key setup to `config/encryption.ts`.
- Update `adonisrc.ts` hooks naming and Vite build hook integration.
- Update test file globs to brace syntax (`*.spec.{ts,js}`).
- Apply Inertia v7 file moves and middleware-based shared props if using Inertia.

## Definition of Done

- Routes are named and ordered correctly.
- Validation exists at all HTTP boundaries.
- Controllers are thin and services are injected.
- Responses use transformers or explicit serialized DTOs.
- Exception behavior is predictable for HTML, Inertia, and JSON clients.
- Env schema validation covers required runtime variables.

---
name: adonisjs-v7-inertia-react-meta
description: Use when delivering end-to-end features in AdonisJS v7 + Inertia.js + React and you need a single workflow that coordinates architecture, typing, security, and testing from start to finish.
---

# AdonisJS v7 + Inertia + React Meta Workflow

This skill orchestrates the full implementation path for your stack and keeps work consistent across backend, frontend, security, and tests.

## Trigger Conditions

Use this skill when the request involves any full feature or multi-file change in an AdonisJS v7 + Inertia + React codebase, especially when it spans routes, controllers, React pages, forms, shared props, auth, or tests.

## Operating Mode

For each feature, apply these companion skills in order:

1. `test-driven-development`
2. `adonisjs-v7-core`
3. `adonisjs-v7-inertia-react`
4. `adonisjs-v7-security-testing`
5. `adonisjs-v7-testing`

If one sub-area is not relevant (for example no auth change), skip only that part, not the whole workflow.

## End-to-End Workflow

1. Define behavior and write failing tests first.
2. Design/confirm route identifiers used by the app (controller/resource routes are auto-named; add `.as(...)` for callback routes) and request contracts.
3. Implement controller boundary with `request.validateUsing(...)`.
4. Move business rules into injected services.
5. Serialize response data with transformers.
6. Render Inertia page props with explicit typed shapes.
7. Decide navigation vs background data: use Inertia visits for page transitions; use Tuyau + React Query for non-navigation JSON data.
8. Update React pages/forms using route names and generated types.
9. Apply security middleware/Shield/auth constraints for changed flows.
10. Re-run tests and ensure no security regressions.

## Non-Negotiables

- No production behavior change without a failing test first.
- No unvalidated external input crossing controller boundaries.
- No raw model leakage as frontend contract when a transformer is appropriate.
- No hardcoded critical paths when route names are available.
- No auth/security-sensitive endpoint merged without regression tests.

## Implementation Checklist

- Routes are named and ordered (static before dynamic).
- Validators exist for params/query/body as required.
- Controllers are thin and delegate to services.
- Transformer output matches frontend data needs.
- Inertia shared props are minimal and centralized.
- React pages use generated contract types (`Data.*`, `InertiaProps`).
- CSRF/session/auth behavior is correct for full and partial visits.
- Exceptions/reporting behavior remains consistent for HTML/Inertia/JSON.

## Completion Standard

A change is complete only when architecture, typing, security, and tests all pass together. Do not optimize one axis by weakening another.

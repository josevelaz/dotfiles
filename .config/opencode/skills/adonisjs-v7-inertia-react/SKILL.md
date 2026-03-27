---
name: adonisjs-v7-inertia-react
description: Use when building full-stack features with AdonisJS v7 + Inertia.js + React, including shared props, typed page props, deferred data, route-aware links/forms, SSR, and frontend/backend contract safety.
---

# AdonisJS v7 + Inertia + React

This skill provides implementation defaults for AdonisJS v7 apps using Inertia and React.

Reference docs:
- https://docs.adonisjs.com/guides/frontend/inertia
- https://docs.adonisjs.com/guides/frontend/api-client
- https://docs.adonisjs.com/guides/frontend/transformers
- https://docs.adonisjs.com/guides/frontend/vite
- https://docs.adonisjs.com/guides/security/securing-ssr-applications
- https://docs.adonisjs.com/guides/basics/routing
- https://docs.adonisjs.com/v6-to-v7

## Scope

Use this for:
- New pages, forms, and flows in Inertia React apps
- Migrating Inertia integration from older Adonis versions to v7
- Improving type safety between controllers and React pages
- SSR setup and hydration correctness

## Project Structure Defaults

- Keep Inertia code under `inertia/`:
  - `inertia/app.tsx`
  - `inertia/ssr.tsx` (if SSR enabled)
  - `inertia/pages/**`
  - `inertia/layouts/**`
  - `inertia/tsconfig.json`
- Keep backend in standard Adonis folders; do not import backend runtime files directly into frontend code.
- Use generated client types from `.adonisjs/client` as the contract boundary.

## Controller Rendering Pattern

- Render pages with `inertia.render('users/index', props)`.
- Keep controller props minimal and explicit.
- Prefer transformers for complex resource payloads.
- For pagination, pass transformer pagination output (data + metadata) instead of raw paginator objects.

## Shared Props Pattern

- Define shared props in `app/middleware/inertia_middleware.ts`.
- Use `ctx.inertia.always(...)` for values required on every visit.
- Treat session/auth availability as conditional during edge cases (e.g., early 404 lifecycle paths).
- Keep shared props stable and small (auth user summary, flash, validation errors, feature flags).

## Data Loading Controls

Use `ctx.inertia` helpers intentionally:

- `optional(async () => ...)`: include only during partial reload requests.
- `always(async () => ...)`: always include, even for partial reloads.
- `defer(async () => ..., group?)`: fetch after first paint.
- `merge(...)` / `.merge()` / `.deepMerge()`: append or merge payload for infinite-scroll style UIs.

## React Navigation and Forms

- Prefer `Link` and `Form` from `@adonisjs/inertia/react`.
- Pass route names (`route`, `routeParams`) rather than hardcoded paths when possible.
- Use `urlFor(..., { qs })` for query strings.
- Keep route names stable to preserve refactor safety. Controller/resource routes are auto-named; add `.as(...)` for callback routes you reference from the frontend.

## Tuyau (Type-Safe API Client)

If you are using the inertia-react starter kit with Tuyau:

- Wrap your app with `TuyauProvider` (from `@adonisjs/inertia/react`) so Inertia `Link`/`Form` route props stay type-safe.
- Prefer Tuyau for JSON endpoints used by React Query and background requests.
- Keep route names stable; Tuyau generation and typed calls depend on route identifiers.
- Ensure controllers call `request.validateUsing(...)` so Tuyau can infer typed request payloads.
- Set `Accept: application/json` for Tuyau requests so error shapes (like validation) are predictable.
- Use transformers for responses consumed by Tuyau so generated client types match the serialized network shape.

## React Query (TanStack Query) Best Practices

- Decide per use-case:
  - Inertia navigation for page transitions and form submissions that end in redirects.
  - React Query for non-navigation data (search/autocomplete, background refresh, polling, "load more" widgets) where you do not want a full Inertia visit.
- Avoid double-fetching the same data:
  - If the controller already provides data as page props, use it as the initial render source and only use React Query for subsequent refreshes.
  - If React Query owns the data, keep initial page props minimal and let the query populate the UI.
- Use stable query keys that include route params and filters (page, sort, search).
- Invalidate queries after successful mutations (Inertia form or Tuyau mutation) instead of refetching everything.
- Prefer "contract tests" on the server (transformer output + pagination metadata) so the query cache always receives a consistent shape.

## Type Safety Contract

- Define backend outputs with transformers.
- Use generated `Data.*` types in React pages.
- Type page components with `InertiaProps<...>`.
- If using Tuyau, ensure backend uses `request.validateUsing(...)` so request/response typing is inferred correctly.

## SSR and Asset Setup

- Enable SSR in both:
  - `vite.config.ts` (Inertia plugin SSR config)
  - `config/inertia.ts`
- Ensure `resources/views/inertia_layout.edge` includes correct Vite tags for React refresh/dev behavior.
- Use the Adonis Vite build hook in `adonisrc.ts`.

## Security Defaults for Inertia Apps

- Install and configure Shield.
- Enable XSRF cookie for Ajax/Inertia requests (`enableXsrfCookie`).
- Keep CSRF protection active for form posts.
- Apply CSP deliberately, including Vite dev URLs/nonces as needed.

## Common Pitfalls to Avoid

- Returning unbounded, heavy props from every page visit.
- Sharing too much mutable state in global shared props.
- Relying on path strings instead of route names for critical navigation.
- Returning raw Lucid models and expecting frontend rich types.
- Enabling SSR in only one location (Vite or Inertia config, but not both).

## Definition of Done

- Page routes/controllers return typed, minimal props.
- Shared props are centralized and intentional.
- Frontend uses generated contract types (no duplicated manual interfaces).
- Links/forms use route-name semantics where practical.
- CSRF and session behavior work across full and partial visits.
- SSR path (if enabled) renders and hydrates without mismatch.

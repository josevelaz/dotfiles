---
name: inertiajs-v2-core
description: Use when implementing or troubleshooting Inertia.js v2 (especially with React), including createInertiaApp setup, pages/layouts, links, forms, validation errors, redirects, shared data, partial reloads, asset versioning, progress indicators, and TypeScript typing.
---

# Inertia.js v2 Core

This skill captures Inertia.js v2 best practices, with a bias toward React adapter usage.

Reference docs:
- https://inertiajs.com/docs/v2/getting-started
- https://inertiajs.com/docs/v2/installation/server-side-setup
- https://inertiajs.com/docs/v2/installation/client-side-setup
- https://inertiajs.com/docs/v2/the-basics/pages
- https://inertiajs.com/docs/v2/the-basics/links
- https://inertiajs.com/docs/v2/the-basics/forms
- https://inertiajs.com/docs/v2/the-basics/responses
- https://inertiajs.com/docs/v2/the-basics/redirects
- https://inertiajs.com/docs/v2/the-basics/validation
- https://inertiajs.com/docs/v2/data-props/shared-data
- https://inertiajs.com/docs/v2/data-props/partial-reloads
- https://inertiajs.com/docs/v2/advanced/asset-versioning
- https://inertiajs.com/docs/v2/advanced/progress-indicators
- https://inertiajs.com/docs/v2/advanced/typescript

## What Inertia Is (And Is Not)

- Inertia is a protocol and set of adapters that let you build server-driven apps with SPA-style navigation.
- There is no client-side router and no required API layer; controllers/routes return page components + props.
- Inertia is glue between your backend framework and your frontend framework.

## Baseline Architecture

- Server responsibilities:
  - Render Inertia responses (component identifier + props).
  - Provide a root HTML template that boots the client app.
  - Centralize shared props and asset versioning in middleware.
- Client responsibilities:
  - Boot via `createInertiaApp`.
  - Resolve pages by name (often via `import.meta.glob`).
  - Use adapter primitives (`Link`, `useForm`, `router`) for navigation and mutations.

## Client Setup (React)

- Use `createInertiaApp({ resolve, setup, id? })`.
- Ensure the `id` used by `createInertiaApp` matches the server root element id.
- Prefer deterministic `resolve(name)` mapping for pages:
  - Vite: `import.meta.glob('./Pages/**/*.tsx', { eager: true })` for simple setups.
  - Consider code splitting only when the app benefits from it.

## Pages and Layouts

- Keep page props minimal and explicit.
- Use persistent layouts to avoid remounting global UI on every visit.
- Apply a default layout inside `resolve()` when a page does not specify one.
- Manage document title/meta via the adapter head manager (`Head`).

## Links and Visits

- Use the adapter `<Link>` component for navigation.
- Prefer rendering non-GET actions as `<button>` (via `as="button"`) instead of non-GET anchors.
- Use visit options intentionally:
  - `preserveScroll` for infinite lists.
  - `preserveState` when you want to keep local component state.
  - `replace` for idempotent navigations where history should not grow.
  - `only` for partial reloads.

## Forms and Mutations

- Use `<Form>` for HTML-form-like workflows, or `useForm()` when you need programmatic control.
- Use `errorBag` when multiple forms exist on a single page.
- Keep request lifecycle hooks (`onStart`, `onProgress`, `onSuccess`, `onError`, `onFinish`) close to the form that owns the UX.
- Avoid forcing controlled inputs unless necessary; uncontrolled + `name` attributes are often simpler.

## Validation and Error Handling

- Inertia validation is redirect-based:
  - On validation failure, the server redirects back and shares errors via props.
  - The client reads errors from `page.props.errors`.
- Treat `errors` as part of your contract; keep shapes stable.
- Do not default to 422 JSON validation behavior for browser flows unless you are intentionally building an API endpoint.

## Responses and Prop Size

- Everything you return as props is visible client-side.
- Keep props small because Inertia stores history state, and browsers impose limits.
- Use lazy/optional props (server-side adapter feature) to avoid computing heavy data when not needed.

## Redirects

- After non-GET Inertia requests, respond with redirects to GET endpoints.
- Use 303 semantics after PUT/PATCH/DELETE so the follow-up request becomes GET.
- For external redirects, use Inertia location responses (409 + `X-Inertia-Location`).

## Shared Data

- Keep shared props minimal; they ship on every response.
- Prefer namespacing to avoid collisions.
- Use shared props for auth context, flash, feature flags, and global UI needs.

## Partial Reloads

- Use partial reloads to update subsets of props when staying on the same page component.
- Pair partial reloads with lazy/optional props so the server does not do unnecessary work.
- Use `router.reload({ only: [...] })` for refresh patterns.

## Asset Versioning

- Set an asset version string in middleware.
- When version changes, Inertia forces a full reload to pick up new assets.

## Progress Indicators

- Configure progress in `createInertiaApp({ progress: ... })`.
- Disable default progress when using custom loading UI, and wire `router` events instead.

## TypeScript

- Use module augmentation of `@inertiajs/core` `InertiaConfig` for shared props, flash data, and error value typing.
- Type `usePage<Props>()` and `useForm<T>()` to enforce contract consistency.

## Definition of Done

- Server returns correct Inertia responses and redirect semantics.
- Shared props and asset versioning are centralized in middleware.
- Client setup resolves pages deterministically and uses adapter primitives.
- Validation errors and redirects behave correctly for browser-driven flows.
- Props remain minimal and stable as a contract.

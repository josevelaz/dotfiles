---
name: adonisjs-inertia-stack
description: Use when designing or modifying the AdonisJS and Inertia integration layer, including page props, shared auth and flash data, validation error flow, pagination, filtering, and request-to-page tests.
---

# AdonisJS Inertia Stack

Use this skill for the seam between AdonisJS and Inertia. It owns controller-to-page contracts, shared props, render flow, and tests that prove the request-to-page boundary is correct.

## When to Use

- rendering Inertia pages from Adonis controllers
- deciding what data should cross from services into page props
- wiring auth, flash messages, shared props, and validation errors
- defining pagination, filters, and query-string conventions
- choosing between Inertia page responses and standalone JSON APIs
- testing end-to-end request-to-page behavior

## When Not to Use

- backend-only Adonis architecture with no Inertia pages
- page-only React consumption work with no server contract decisions

## Quick Reference

- **Render:** use `inertia.render(...)` in controllers
- **Shared props:** define app-wide shared props with `BaseInertiaMiddleware.share(...)`
- **Errors:** expose validation errors through the adapter's normal sharing flow
- **Typing:** augment `@adonisjs/inertia/types` for shared props and page contracts when type safety matters
- **Tests:** use the official Inertia test utilities/plugins when asserting components and props from HTTP requests

## Defaults

- route -> controller -> service -> transformer -> optional DTO-style handoff -> `inertia.render(...)` -> page
- services produce data for presentation; controllers decide what crosses the page boundary
- transformers shape outgoing data; DTO-style handoff objects are optional explicit contracts, not a synonym for transformers
- shared props stay cross-cutting and small
- page props are intentional, stable, and easy to test

## Accurate Adonis Adapter Patterns

### Rendering from controllers

```ts
import type { HttpContext } from '@adonisjs/core/http'

export default class UsersController {
  async index({ inertia }: HttpContext) {
    return inertia.render('Users/Index', {
      users: [],
      filters: { search: '' },
    })
  }
}
```

### Shared props middleware

```ts
import type { HttpContext } from '@adonisjs/core/http'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  async share(ctx: HttpContext) {
    return {
      auth: {
        user: ctx.auth.user,
        isAuthenticated: ctx.auth.isAuthenticated,
      },
      flash: ctx.session?.flashMessages.all() ?? {},
      errors: this.getValidationErrors(ctx),
    }
  }
}
```

## Contract Guidance

### Controller-to-page handoff

- controllers should render page names and send stable props
- services should not know page component names
- transform or map outbound data before rendering when raw models would leak persistence details

### Shared auth, flash, and errors

- keep shared props for auth state, flash, and other cross-app context
- let validation errors flow through the adapter instead of inventing parallel conventions
- keep page-specific data in page props, not in global shared payloads

### Pagination, filtering, and query strings

- define one stable prop contract for filters, current query state, and pagination metadata
- keep filter parsing and query decisions on the server
- use partial reloads deliberately when only subsets of props should refresh

### Choosing page responses vs JSON APIs

- use Inertia page renders for navigation-oriented server-driven UI flows
- use standalone JSON endpoints when the consumer is not an Inertia page or when an explicit API boundary is the better design
- do not mix page-prop shapes and API response shapes carelessly

## Testing Guidance

- test full request-to-page behavior when the controller/page contract matters
- assert component name and critical props using the official adapter testing utilities
- add tests for auth gates, flash flows, validation errors, filters, pagination, and partial reload behavior where relevant
- keep end-to-end tests focused on real user flows, not only isolated controller units

## Common Mistakes

- passing raw models or query builders directly to pages
- letting client components become the source of truth for server workflow decisions
- mixing JSON API and Inertia page contracts without a clear boundary
- duplicating validation and error mapping across too many layers
- using shared props for page-specific records or collections

## Anti-Patterns

- service returns model -> controller forwards model -> page receives persistence shape directly
- controller builds unstable props with no explicit contract for filters or pagination
- page logic compensates for weak server boundaries by re-fetching or re-shaping core data on the client

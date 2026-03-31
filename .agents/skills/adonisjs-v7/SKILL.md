---
name: adonisjs-v7
description: Use when creating or modifying AdonisJS v7 routes, controllers, validation, services, Lucid queries, transformers, exception handling, or backend tests.
---

# AdonisJS v7

Use this skill for AdonisJS v7 backend work. Prefer thin routes, thin controllers, validation at the HTTP boundary, service classes for business logic, and integration-oriented tests.

## When to Use

- defining routes or route groups in `start/routes.ts`
- building controllers, validators, middleware, or policies
- moving business logic out of controllers and into services
- shaping outbound data before sending JSON or page props
- writing backend tests around request, authorization, validation, and persistence flows

## When Not to Use

- pure Inertia page/component work with no Adonis changes
- frontend-only React concerns
- cross-boundary Adonis/Inertia contract design; use `adonisjs-inertia-stack`

## Quick Reference

- **Routes:** use `import router from '@adonisjs/core/services/router'`
- **Controllers:** use generated controller references such as `import { controllers } from '#generated/controllers'` when wiring routes
- **Resources:** use `router.resource(...)` for standard CRUD shapes
- **Params:** use route matchers like `router.matchers.number()` or `router.matchers.uuid()` for constrained params
- **Validation:** validate in controllers with `await request.validateUsing(...)`
- **Business logic:** default to service classes; treat action classes as optional project structure, not official framework structure
- **Queries:** keep Lucid/query composition out of views and out of large route handlers
- **Serialization:** transform outbound data intentionally; do not leak raw ORM models by default

## Defaults

- routes define HTTP shape, grouping, naming, middleware, and auth boundaries
- controllers orchestrate request validation, authorization, service calls, and responses
- service classes encapsulate business rules and multi-step workflows
- validation happens before business logic runs
- transformers handle outgoing serialization; DTO-style handoff objects are optional and separate
- tests should verify behavior at the route/request boundary more often than controller internals

## Accurate v7 Patterns

### Routes and groups

```ts
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import { middleware } from '#start/kernel'

router
  .group(() => {
    router.get('/users', [controllers.Users, 'index']).as('users.index')
    router.post('/users', [controllers.Users, 'store']).as('users.store')
  })
  .prefix('/admin')
  .use(middleware.auth())

router.resource('posts', controllers.Posts).apiOnly()
```

### Validation at the edge

```ts
import type { HttpContext } from '@adonisjs/core/http'
import { createPostValidator } from '#validators/post'

export default class PostsController {
  async store({ request }: HttpContext) {
    const payload = await request.validateUsing(createPostValidator)
    return payload
  }
}
```

### Node.js and TypeScript references

- prefer standard ESM imports in examples
- when a Node built-in appears, prefer the `node:` scheme, for example `import path from 'node:path'`
- keep framework examples TypeScript-first unless the task explicitly asks for plain JavaScript

## Architecture Guidance

### Routes

- keep route files declarative
- use groups for shared prefix, middleware, or naming concerns
- avoid inline business logic except for trivial health or static endpoints

### Controllers

- accept `HttpContext`
- validate incoming data
- authorize if needed
- call a service
- return a response or render target

Controllers should not become the place where query composition, transaction orchestration, or domain rules pile up.

### Services

- use services for domain decisions, coordination, and multi-step mutations
- keep services framework-light when practical
- accept validated data, not raw request objects, unless there is a clear reason not to

### Lucid and query boundaries

- keep heavy query composition out of page components and out of route definitions
- keep reusable query logic in focused service or query-layer code
- do not pass unfinished query builders around presentation layers

### Transformers and response shaping

- use current AdonisJS transformer patterns for outbound serialization when a stable response shape matters
- treat transformers as output shaping
- treat DTO-style objects as optional handoff contracts when a project wants an explicit boundary before rendering or responding
- do not teach transformers and DTOs as interchangeable terms

### Errors and exceptions

- let validation failures surface through the framework's normal error handling
- centralize repeated error mapping instead of scattering ad hoc response logic across controllers
- keep domain-specific failure handling explicit and readable

## Testing Guidance

- prefer feature/integration tests for routes, middleware, auth, validation, and persistence flows
- test services directly when they hold important branching logic
- verify inputs, outputs, and side effects rather than private controller details
- add focused tests for authorization and validation failure paths

## Common Mistakes

- fat route files that embed query logic or workflow decisions
- fat controllers that validate, query, mutate, transform, and branch on domain rules in one method
- mixing validation across request parsing, services, and models without a clear edge boundary
- leaking Lucid models directly into every response shape
- presenting optional action classes as if Adonis v7 requires them
- using stale pre-v7 route or controller patterns

## Anti-Patterns

- `route -> large controller -> view/json` with no service boundary for real business logic
- validation inside services when the data originated at HTTP input and could have been validated earlier
- raw query builders or ORM objects crossing directly into page payload design
- tests that only instantiate controllers instead of exercising request behavior

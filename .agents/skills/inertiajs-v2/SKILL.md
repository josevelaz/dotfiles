---
name: inertiajs-v2
description: Use when building or updating Inertia.js v2 pages, props, forms, partial reloads, shared data, redirects, validation error handling, or frontend tests.
---

# Inertia.js v2

Use this skill for Inertia.js v2 page and client-consumption work. Treat Inertia as a server-driven SPA transport layer, not as a default client-side data-fetching architecture.

## When to Use

- building Inertia pages or layouts
- defining page prop expectations on the client side
- using `@inertiajs/react` forms or router visits
- handling validation errors, redirects, shared data, partial reloads, or deferred props
- writing behavior-focused frontend tests around Inertia pages

## When Not to Use

- pure AdonisJS backend architecture with no page/client concern
- detailed controller-to-page contract design; use `adonisjs-inertia-stack`
- generic React-only patterns that do not involve Inertia

## Quick Reference

- **Forms:** prefer `useForm` from `@inertiajs/react`
- **Success flow:** mutations usually succeed by redirect, not by returning ad hoc JSON
- **Errors:** validation errors arrive as page props in Inertia's normal flow
- **State:** `post`, `put`, `patch`, and `delete` requests preserve component state automatically on validation errors
- **Reloads:** use `router.get(..., { only: [...] })` or equivalent partial reload options when only part of a page needs refreshing
- **Deferred props:** use them for expensive or secondary data, not core page identity data
- **Shared data:** keep shared props limited to true cross-app concerns

## Defaults

- pages consume server-provided props instead of duplicating server-owned fetching logic
- forms use Inertia helpers instead of mixing manual fetch flows without a strong reason
- shared props stay small and cross-cutting
- page components focus on presentation, local UI state, and user interactions
- business logic and authoritative workflow decisions remain on the server

## React-Facing Examples

### Forms

```tsx
import { useForm } from '@inertiajs/react'

export function UserForm() {
  const { data, setData, post, processing, errors } = useForm({
    name: '',
    email: '',
  })

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    post('/users')
  }

  return (
    <form onSubmit={submit}>
      <input value={data.name} onChange={(e) => setData('name', e.target.value)} />
      {errors.name && <p>{errors.name}</p>}

      <input value={data.email} onChange={(e) => setData('email', e.target.value)} />
      {errors.email && <p>{errors.email}</p>}

      <button disabled={processing} type="submit">Create user</button>
    </form>
  )
}
```

### Partial reloads

```tsx
import { router } from '@inertiajs/react'

router.get('/users', { search: 'John' }, { only: ['users'] })
```

## Page Guidance

### Page component conventions

- keep pages thin and readable
- separate reusable UI into components when the page starts mixing layout concerns and local interactions
- keep page names and prop shapes stable

### Form submission patterns

- prefer `useForm` for common create/update/delete flows
- rely on redirect-based server success flows unless the task clearly calls for something else
- surface validation errors from props instead of rebuilding parallel client validation systems by default

### Shared props

- reserve shared props for auth state, flash messages, locale, app metadata, and similar cross-app concerns
- do not use shared props as a dumping ground for page-specific datasets

### Deferred props and reload strategy

- use deferred props for non-critical or expensive secondary data
- use partial reloads to refresh specific prop subsets instead of re-fetching everything
- do not use partial reloads to hide weak page boundaries

## Testing Guidance

- test user-visible behavior and prop-driven rendering
- verify form submission state, error display, and success transitions
- test interactive page behavior without re-implementing server logic in the test itself

## Common Mistakes

- treating Inertia like a default fetch-and-cache client architecture
- duplicating server-owned loading in `useEffect`
- overloading shared props with page-specific data
- putting business logic into page components
- making prop contracts large, unstable, or poorly named
- using React examples that do not actually match `@inertiajs/react`

## Anti-Patterns

- page components that become mini clients for server-owned resources
- form flows that ignore Inertia redirects and validation handling
- local component state becoming the source of truth for server workflow decisions

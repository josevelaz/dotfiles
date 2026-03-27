---
name: adonisjs-v7-security-testing
description: Use when implementing authentication, SSR security hardening, exception/reporting policy, and test strategy in AdonisJS v7 apps, especially with Inertia + React.
---

# AdonisJS v7 Security and Testing

This skill provides safe defaults for auth, HTTP security, and automated tests.

Reference docs:
- https://docs.adonisjs.com/guides/auth/session-guard
- https://docs.adonisjs.com/guides/security/securing-ssr-applications
- https://docs.adonisjs.com/guides/testing/introduction
- https://docs.adonisjs.com/guides/basics/exception-handling
- https://docs.adonisjs.com/guides/basics/validation

## Scope

Use this for:
- Securing session-based full-stack apps
- Hardening SSR and browser-facing endpoints
- Establishing exception reporting policy
- Setting up or improving test suites

## Authentication Strategy

- For Inertia + React apps on the same top-level domain, use session guard.
- Keep auth concerns explicit:
  - `initialize_auth_middleware` sets up `ctx.auth`.
  - `middleware.auth()` actually protects routes.
- Protect private routes at group boundaries.
- Apply `guest` middleware on login/register pages.
- Use `silent_auth` for public pages with optional user context.

## Login Session Practices

- Use `auth.use('web').login(user, rememberMe?)` and `logout()`.
- Use remember-me tokens only when needed and configure expiry intentionally.
- Prefer `auth.getUserOrFail()` where nullability is not acceptable.
- Customize unauthorized redirect behavior in auth middleware for UX consistency.

## Shield Security Baseline

- Install `@adonisjs/shield` and keep middleware enabled.
- CSRF:
  - Keep CSRF on for all browser mutation routes.
  - Use exceptions only for trusted webhook endpoints.
  - Enable XSRF cookie for Inertia/Ajax requests.
- CSP:
  - Start with report-only mode, then enforce.
  - Include Vite dev origins/nonces where required.
- Headers:
  - Enable HSTS with cautious rollout.
  - Enable clickjacking protection (X-Frame-Options or CSP `frame-ancestors`).
  - Enable `nosniff` via content-type sniffing protection.

## Tuyau + React Query Security Notes

- Prefer same-origin requests for session-guard apps.
- For React Query calls made via Tuyau, set `Accept: application/json` and ensure cookies are included (session + XSRF).
- Do not disable CSRF for JSON endpoints used by the browser unless they are truly external-callback/webhook routes.

## Exception and Reporting Policy

- Centralize handling in `app/exceptions/handler.ts`.
- Keep `debug` disabled in production.
- Return format-aware responses (HTML/Inertia/JSON) through central logic.
- Suppress expected noise via ignored status/error code lists.
- Add request/user context to error reports.
- Use custom exception classes for domain errors.

## Validation as Security Boundary

- Validate every external input path with Vine.
- Validate params/query/body together for sensitive endpoints.
- Use metadata-aware validators for authorization-adjacent rules.
- Never trust controller inputs before `validateUsing`.

## Testing Strategy (Japa)

- Maintain suites in `adonisrc.ts` (at minimum `unit` and integration/browser-style suites).
- Use `tests/bootstrap.ts` for plugin setup and per-suite hooks.
- Start the HTTP server only for suites that need it.
- Use `.env.test` for deterministic test configuration.
- Use container swaps and test doubles for external side effects.

## Security Test Checklist

- Guest users are redirected/blocked from protected routes.
- Authenticated users are prevented from guest-only routes.
- CSRF invalid/missing token paths are tested.
- Validation failures return correct shape for HTML/Inertia/JSON contexts.
- Error pages and API errors do not leak stack traces in production mode.
- Session lifecycle (login/logout/remember-me) is covered by tests.

## Definition of Done

- Route protection and guard behavior are explicit and tested.
- Shield settings are intentional, not defaults left unreviewed.
- Exception handler behavior is stable across frontend and API contexts.
- Critical security paths have regression tests.

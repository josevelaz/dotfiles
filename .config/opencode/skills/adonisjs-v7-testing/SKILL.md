---
name: adonisjs-v7-testing
description: Use when creating, refactoring, or troubleshooting tests in AdonisJS v7 projects, including Japa suite setup, HTTP/browser tests, test environment isolation, and CI-friendly execution.
---

# AdonisJS v7 Testing

This skill provides practical defaults for testing AdonisJS v7 applications with Japa.

Reference docs: https://docs.adonisjs.com/guides/testing/introduction

## Scope

Use this skill for:
- Creating new tests and suites
- Stabilizing flaky tests
- Building test infrastructure for HTTP, browser, and unit tests
- Improving CI reliability and failure triage

## Testing Stack Defaults

- Use Japa with `@japa/plugin-adonisjs`.
- Keep suite definitions in `adonisrc.ts` under `tests.suites`.
- Keep shared test runtime setup in `tests/bootstrap.ts`.
- Use `.env.test` for test-only configuration.

## How Japa Works

- Japa is the test runner; Adonis integrates it through `@japa/plugin-adonisjs`.
- `adonisrc.ts` defines suites (file globs + timeout), and each suite controls how tests are grouped and executed.
- `tests/bootstrap.ts` wires plugins and suite lifecycle hooks once for the whole run.
- Each test file declares groups and tests; groups can own setup/teardown hooks to isolate side effects.
- The test context is injected by plugins (assertions, HTTP/browser helpers, auth/session helpers).
- Run scope can be narrowed using suite name, file filters, test-name filters, tags/groups, and rerun-failed mode.
- Best default: run the smallest scope while developing, then run the full relevant suite before finishing.

## Standard Workflow

1. Choose suite (`unit`, `functional/http`, or `browser`) based on behavior under test.
2. Generate test file with Ace command.
3. Write failing test first.
4. Implement minimum production code.
5. Re-run targeted tests, then full relevant suite.
6. Refactor while tests remain green.

## Suite Selection Rules

- `unit`: pure business logic, minimal framework boot, fastest feedback.
- `functional/http`: route, middleware, auth, validation, and response behavior.
- `browser`: end-to-end page flow and user interactions.

Default to the smallest suite that proves the behavior.

## Core Commands

- Run all tests: `node ace test`
- Run one suite: `node ace test unit`
- Generate test: `node ace make:test posts/index --suite=browser`
- Filter by file: `node ace test --files="tests/functional/users.spec.ts"`
- Filter by test name: `node ace test --tests="users can login"`
- Re-run failed tests: `node ace test --failed`
- Watch mode during development: `node ace test --watch`

## Bootstrap and Server Lifecycle

- Register plugins in `tests/bootstrap.ts` once.
- Start the HTTP server only for suites that require network requests.
- Keep expensive setup out of unit suites.
- Use suite hooks for deterministic setup/teardown.

## Data and Isolation Practices

- Keep tests independent and order-agnostic.
- Seed only the data required per test case.
- Prefer factories/builders over large fixture files.
- Avoid hidden global state shared between tests.
- Use container swaps/fakes for external integrations.

## HTTP and Validation Assertions

- Assert status code, payload shape, and key headers.
- Assert validation failures with expected error structure.
- Verify content negotiation behavior (HTML/Inertia/JSON) where relevant.
- Test auth boundary behavior for guest and authenticated users.

## Inertia + React Testing Best Practices

- Test server behavior first (functional HTTP): route protection, redirects, validation, and prop contracts.
- Assert the payload contract shape passed to pages, not component implementation details.
- Verify validation failures for browser flows: redirect behavior plus errors/flash availability through shared props.
- For forms, cover both success and failure paths, including CSRF/session behavior.
- For lists, assert stable transformed output and pagination metadata, not database model internals.
- When using partial reload/deferred data, add explicit tests for initial payload vs follow-up payload behavior.
- Keep browser tests focused on critical user journeys; keep data logic assertions in unit/functional suites.

## Tuyau + React Query Testing Notes

- Treat JSON endpoints consumed by React Query as part of your public contract:
  - Assert response shape and status codes.
  - Assert validation errors (422) are stable for `Accept: application/json`.
- Prefer transformers for JSON responses and test the transformer output shape.
- Ensure endpoints used by queries are deterministic and do not depend on implicit global state.
- After mutations, add tests that verify the server-side state change (the query invalidation is a frontend concern; the backend must remain correct).

## CI Reliability Rules

- Avoid network dependence on third-party services in test runs.
- Keep test timeouts intentional per suite.
- Prefer explicit waits/conditions over arbitrary sleeps.
- Keep `.env.test` complete so CI does not rely on developer-local values.

## Common Anti-Patterns

- Overusing browser tests for logic that belongs in unit or HTTP tests.
- Asserting implementation details instead of observable behavior.
- Running entire suites while debugging one failing test.
- Sharing mutable fixtures across test files.

## Definition of Done

- New behavior is covered by at least one failing-then-passing test.
- Tests run green locally with targeted and suite-level commands.
- Suite placement is appropriate for execution cost and confidence.
- Test setup is deterministic and CI-safe.

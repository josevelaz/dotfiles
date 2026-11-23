---
name: feature-e2e
description: End-to-end feature tests. Use when asked to turn acceptance criteria or a user journey into runnable E2E coverage, or to improve what existing feature tests prove.
---

# Feature E2E

Test one user promise at a time. A passing test must prove the outcome, not just that the user reached the last screen.

## 1. Choose the promises

Read the feature brief, repo guidance, nearby E2E tests, and runner config. Map each in-scope acceptance criterion to an existing test, a new case, or a gap to report. If given only a journey, state the promises you infer and flag unclear behavior. Cover the main success path and the failure, recovery, or boundary cases that change the user outcome. Use the fewest distinct cases that prove those behaviors. Name each case for the outcome it proves.

Use the repo's runner; ask before adding one. For the `e2e` runner, read [E2E-RUNNER.md](E2E-RUNNER.md).

## 2. Define the proof

For each case, name the actor, starting state, action, and evidence that distinguishes success from a plausible failure. Get expected values from known fixtures or an independent source, not the result under test. For exact output, compare the full parsed result so extra or missing records fail. For server persistence, read the result in a fresh session. For a denial, check that the blocked data, download, or side effect was not delivered. If a permission is the promise, check the capability, not just the role label.

## 3. Arrange, act, assert

Start close to the behavior. Set up with existing fixtures, test APIs, or saved sessions; exercise the behavior under test through the user's entry point. Cross the real boundaries the feature promises to cross. Give each case its own data and clean it up even on failure, or use disposable state. Give each actor a separate session when the flow spans accounts. Use synthetic data in an authorized test environment and sandbox outward effects such as email or payments. For a flow that uses a Mailpit inbox, load the `mailpit` skill.

Use accessible roles and names or stable test IDs. Wait for the state the next step needs with a bounded retrying check, not a fixed delay. For agent-driven steps, give one goal and its inputs, let the agent choose the path, and verify the outcome separately. Keep secrets in the runner's credential store, out of prompts and shared artifacts. Use exact assertions for machine-readable evidence.

## 4. Verify the test

Run the case by itself on the relevant target without automatic retries. Confirm it ran rather than relying on the exit code. When safe, make the product return a plausible wrong result in disposable test state. Confirm that the intended assertion fails, then restore the state or temporary change and rerun.

Read the first failure and its trace before changing the test. Use the evidence to distinguish a product defect from a test or setup problem. Run the relevant suite if cases share fixtures or state. Report the command, target, result, and artifact path or run log, plus any skipped or unverified case or challenge.

Source: [Five tips for writing good agentic tests](https://e2e.com/blog/5-tips-for-writing-good-agentic-tests).

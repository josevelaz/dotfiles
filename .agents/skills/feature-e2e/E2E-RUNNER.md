# The e2e runner

Use the repo's `e2e` skill if available. Otherwise run `e2e guide <topic>` with the repo's package manager and installed version. Use `writing-tests` for fixtures and actions, `agent` for goals and replay, and `running` for run flags and reports.

- Use `agent.act` for a single user goal where the route can vary. Pass values through the runner's supported parameters or fixture inputs. Use locator actions when the target or exact input is part of the contract.
- Prefer locator or engine matchers for exact evidence. `agent.assert` judges the current screen once; use a retrying matcher or `agent.waitFor` for a state that arrives later. Ask a model judge a concrete question only when a deterministic check cannot express the proof.
- Replay records an `act` only after a supported check passes. Plain-value assertions and `expect.poll` do not confirm recordings. Keep them when they prove the outcome; add a screen or route check only when it verifies a real part of the behavior.
- Keep replay on for focused debug runs. Use `--retries 0` and check for per-test retry settings that override it. Once the case passes, run it once live with `--no-cache` and normal timeouts. A replay hit is not proof the live agent can still complete it.

Sources: [How agentic testing works](https://e2e.com/blog/how-does-agentic-testing-actually-work) and [agentic mobile testing](https://e2e.com/blog/agentic-mobile-testing-with-e2e-and-agent-device).

# Implementation plans

Before you edit files or run commands that change state, make an implementation plan. Skip the plan only for one-step tasks, such as a single small edit or a question you can answer directly.

Build the plan from what you learn by reading the code, not from guesses. Each plan has:

- a one-sentence goal that restates the request;
- ordered steps, each small enough to finish and check on its own;
- the files or areas each step touches;
- which steps you will delegate, and to which subagent;
- how you will check the result, such as tests, builds, or a verifier run;
- open questions or risks, if any.

Show the plan to the user as a short list in the chat before you start the work, and keep that list current as you go. Do not save plans to files unless the user asks.

Follow the plan as you work. Mark each step done in that list when it is finished and checked. If you learn something that changes the plan, update the list and tell the user before you continue. If a step is blocked, say which one and why. Do not skip it without telling the user.

# Delegation

Delegate the work to subagents.

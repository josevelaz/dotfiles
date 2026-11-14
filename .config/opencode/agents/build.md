# Implementation plans

Before you edit files or run commands that change state, make an implementation plan. Skip the plan only for one-step tasks, such as a single small edit or a question you can answer directly.

Build the plan from what you learn by reading the code, not from guesses. Each plan has:

- a one-sentence goal that restates the request;
- ordered steps, each small enough to finish and check on its own;
- the files or areas each step touches;
- which steps you will delegate, and to which subagent;
- how you will check the result, such as tests, builds, or a verifier run;
- open questions or risks, if any.

Record the plan with the `todo` tool: set the goal, add each step as a task, and mark the current task. Show the plan to the user in a short list before you start the work. Do not save plans to files unless the user asks.

Follow the plan as you work. Mark each task done when it is finished and checked. If you learn something that changes the plan, update the tasks and tell the user before you continue. If a step is blocked, mark it blocked and say why. Do not skip it without telling the user.

# Orchestration

When you orchestrate work across tickets, you coordinate and subagents do the work.

- Delegate code, including UI, to an implementer subagent, review to a reviewer subagent, and browser QA to a tester subagent. Write no product code yourself.
- Read each ticket live from the tracker before acting on it.
- Work one ticket at a time, in dependency order. Start a ticket only when every blocker is done and merged.
- Give each ticket its own worktree and branch from the latest main, or reuse the ticket's existing branch and PR. Pass the worktree path to every subagent, and run subagents in it one at a time.
- Run each ticket through: implement, review, fix accepted findings, full validation, tester proof against every acceptance criterion, PR, ticket to review.
- Gate on proof: a ticket moves to review only with passing validation and per-criterion evidence. Put the evidence, the review findings you accepted or rejected and why, and your decisions in the PR body.
- Test schema and data changes on a database branch made for that ticket. Leave shared and production databases untouched.
- Stop and report before changing product scope or acceptance criteria, data model, auth, security, or secrets, or before touching paid services, DNS, or production.
- Tickets move forward only. When stuck, mark the ticket blocked, comment a recommended fix, and stop work on it.

---
description: Execute an approved plan task by task
agent: execute
---

Execute the approved plan named below through implementation, independent acceptance, and scoped QA under the execute agent's workflow. This command authorizes focused Conventional Commits for accepted tasks or explicitly coupled delivery groups; preserve the shared commit safeguards.

Plan: $ARGUMENTS

Resolve the plan file at `.opencode/plans/$ARGUMENTS.md`. When the argument names a full path to an existing plan file, use that path instead. When no plan name is given, report the blocker and do not invent plan content.

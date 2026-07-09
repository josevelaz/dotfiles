---
name: pr-review
description: PR review pair-review workflow. Use when the user gives a GitHub pull request URL, wants an interactive review walkthrough, or wants help deciding approve/request-changes without outsourcing the decision.
---

# Interactive GitHub PR Review

Pair-review the PR with the user. Your job is not to approve, reject, or summarize on the user's behalf; it is to make them confident enough to make the review decision themselves.

Optimize for understanding over speed. Teach the codebase while reviewing it.

## Ground rules

- Treat the user as the reviewer; you are the senior engineer beside them.
- Review in logical execution order, not file order.
- Prefer short walkthrough sections with pauses over one long report.
- Show the batch tracker whenever entering, leaving, or resuming a batch. Each line must include attention-item progress: total items once known and the current item when one is active.
- Guide findings one at a time; never dump the full finding list for a selected batch.
- Accumulate user-approved feedback in a project-root Markdown draft, publish only after user approval, then delete the draft only after it has been published to GitHub.
- Explore repository context whenever changed lines are not enough.
- Separate confirmed defects from concerns and author questions.
- Continually connect implementation details to product behavior, user impact, and operational risk.

## Workflow

### 1. Gather the PR map

Given a PR URL, parse the owner, repo, and PR number. Prefer the GitHub CLI when available:

```bash
gh pr view <url> --json title,body,author,baseRefName,headRefName,state,isDraft,mergeable,additions,deletions,commits,files,reviews,comments,reviewThreads,closingIssuesReferences
gh pr diff <url> --patch
```

If the CLI is unavailable or unauthenticated, ask the user to authenticate, provide the diff/metadata, or grant another access path. Do not pretend to have reviewed unavailable data.

Collect at least:

- title, description, author, draft/merge state
- linked issues and product context in the PR body
- commits and their intent signals
- changed files, additions/deletions, and generated/lockfile markers
- review comments, unresolved threads, and author responses when available
- patch/diff contents

Completion criterion: you can state what changed, why it appears to exist, which files changed, and what discussion already happened.

### 2. Build context before judging

Inspect surrounding repository code before identifying issues. Read definitions, callers, tests, schemas, config, docs, ADRs, or prior implementations that affect the PR's behavior.

Use the PR map to identify systems touched, then retrieve context for each system until you understand:

- the pre-PR behavior or contract
- the new behavior or contract
- the main data/control flow
- external boundaries: APIs, database, auth, jobs, queues, UI, config, deployments
- existing test style and coverage expectations

Completion criterion: for every touched system, you can explain the relevant current behavior without relying only on the diff.

### 3. Create logical batches

Group changes by reviewable intent, not by file path. Common batches:

- feature or product behavior
- public API or contract changes
- business/domain logic
- data model, migrations, persistence
- UI and interaction behavior
- security, permissions, validation, privacy
- performance, concurrency, caching
- tests and fixtures
- infrastructure, CI, build, dependencies
- refactoring or mechanical cleanup

Order batches by execution/data flow: inputs and contracts → domain/data changes → behavior → presentation → tests/infrastructure. Keep cross-cutting risk batches near the behavior they affect.

Give each batch a short title and one-line summary. Maintain a visible tracker that shows both batch progress and attention progress:

```markdown
- [ ] Batch 1 — <title>: <one-line summary> — items: not queued
- [x] Batch 2 — <title>: <one-line summary> — items: 3/3 done
- [ ] Batch 3 — <title>: <one-line summary> — items: 2/4 current, concern ← current
```

Use `[x]` only for completed batches. Mark the current batch with `← current` whether or not it is complete. Before a batch's attention queue exists, show `items: not queued`. Once queued, show total attention items and the current item number/category without listing the queue. For completed batches, show all items done.

Completion criterion: every meaningful changed file belongs to exactly one primary batch, cross-references are noted, and the tracker can show completed, pending, current batch, total attention items, and current attention item.

### 4. Open with the orientation

Start the walkthrough with a concise overview:

- problem the PR solves
- user or business impact
- systems affected
- likely execution path through the system
- complexity and risk level, with reasons
- review plan: the logical batches and order, shown as the batch tracker

Then pause and ask what depth the user wants before entering the first batch. Keep showing the tracker as the shared map for where the walkthrough is.

### 5. Walk one batch at a time

For each batch, start by showing the tracker with this batch marked `← current`, then teach before judging:

1. Introduce the concepts, components, abstractions, and data flow involved.
2. Explain what the old implementation did, when relevant.
3. Explain what the PR changes and why that matters to product behavior.
4. Inspect the code changes and surrounding context.
5. Build the internal human-attention queue, grouped into:
   - **Likely defects** — high-confidence correctness, security, data-loss, compatibility, or product issues.
   - **Concerns to investigate** — plausible risks that need more context, tests, or author confirmation.
   - **Questions for the author** — design intent, tradeoffs, missing rationale, ambiguous requirements.
6. Update the tracker with the queue total and the current item number/category, without listing the queue.
7. Present only the current attention item. Explain its evidence, consequence, confidence, and what the user could do with it.
8. Ask whether to discuss this item, draft a comment, investigate it further, skip it, or move to the next item.
9. After the item is resolved, record its user-approved outcome in the feedback draft: requested change, author question, accepted concern, skipped/deferred item, or no-feedback decision. Do not record hidden queue items or private analysis.
10. Continue one item at a time until the queue is empty or the user chooses to leave the batch. Update the tracker before each item so the user always knows `current/total`.
11. Note tests that prove the behavior and gaps that leave important behavior unproven.

Do not reveal the whole attention queue unless the user explicitly asks for the full list. If they ask for a summary, give counts by bucket rather than every item. The tracker may expose only totals and the current item's category.

Completion criterion: the user has enough context to explain this batch's purpose, how it works, how many attention items exist, which one is current, and what decision or comment it supports.

### 6. Pause interactively

After each attention item and at the end of each batch, stop and offer choices instead of continuing automatically:

- discuss this item more
- draft a review comment or author question
- investigate related code outside the PR
- compare against the previous implementation
- discuss why a design decision may have been made
- show the batch tracker
- continue to the next item or batch

Adapt depth to the user's answers. If they ask a question, answer it by reading more code or metadata when needed; then return to the current item or batch flow.

### 7. Maintain the feedback draft

Use one project-root Markdown draft for the whole review session:

1. Create a project-root draft named `pr-review-feedback-XXXXXX.md`. The file must live directly in the repository root, not in `/tmp` or a subdirectory.
2. Before writing feedback, ensure the feedback filename pattern is ignored by git. If `.gitignore` exists, add `pr-review-feedback-*.md` when missing. If it does not exist, create one containing `pr-review-feedback-*.md`.
3. After each resolved attention item, append the user-approved outcome to the draft. Record requested changes, author questions, accepted concerns, skipped/deferred items, and no-feedback decisions clearly enough to reconstruct the review path.
4. Keep private notes, hidden queues, and speculative items the user did not choose to surface out of the draft.
5. Before approval, read the draft back and present an approval packet containing:
   - the complete GitHub-ready feedback text
   - a summary of requested changes
   - a summary of the changes made in the entire PR
   - any author questions the user chose to keep
6. Ask the user to approve, edit, or discard the feedback. Do not publish to GitHub without explicit user approval.
7. After approval, publish the approved feedback to GitHub using the available authenticated path. If publishing is unavailable, tell the user what is missing and keep the draft.
8. Delete the draft only after the approved feedback has been successfully published to GitHub. If deletion fails, tell the user the path and retry or ask how to proceed. Leave the `.gitignore` entry in place for future reviews.

Completion criterion: `pr-review-feedback-*.md` is git-ignored, every resolved attention item has a user-approved draft outcome, the approval packet includes requested-change and whole-PR-change summaries, GitHub publication has succeeded or the draft remains, and the draft is deleted only after successful publication.

### 8. Close with review readiness

After all batches, summarize:

- overall assessment
- highest-risk areas
- strongest implementation decisions
- remaining questions
- likely review posture: appears ready for approval, needs clarification, or likely requires changes
- reasoning behind that posture

Make the recommendation advisory. The final approval/request-changes decision belongs to the user.

Completion criterion: the user can independently decide what review action to take and has concrete comments/questions if needed.

## Issue discipline

Use this standard for attention items:

- Call something a **likely defect** only when code/context strongly supports it.
- Call something a **concern** when it is plausible but unproven.
- Ask an **author question** when intent, requirement, or tradeoff is unclear.
- Avoid nitpicks unless they affect maintainability, readability of a critical path, or project conventions.
- Tie each item to consequence: what user, system, data, or reviewer decision it affects.

## Interaction style

Be conversational and compact. Explain enough to teach, then pause. Prefer diagrams in text, short examples, or small before/after snippets when they clarify behavior. Do not dump the full static report unless the user explicitly asks for one.

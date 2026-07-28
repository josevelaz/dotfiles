---
name: greptile-cli
description: Greptile review — use when the user asks to review the current branch with Greptile, inspect its effective review rules, continue a Greptile review, or manage Greptile CLI access and settings.
---

# Greptile CLI

Greptile reviews the current branch against its base. Keep the review tight: establish the repository and account state, inspect the applied rules, then run or resume the requested review.

## Review

1. Confirm the CLI is available with `greptile --version` and the user is signed in with `greptile whoami`.
   - If either check fails, state the prerequisite and stop. Use `greptile login` only when the user asks to sign in.
   - Completion: the CLI version and active account are known, or the user has a clear next action.

2. Establish the review scope and rules.
   - Let Greptile use its default base unless the user names one. Record an omitted base as `Greptile default`; do not claim its branch name unless the CLI confirms it.
   - Inspect root rules with `greptile config --json`. For every known file in the review scope, run `greptile config --json "<path>"` to inspect its scoped rules and instructions.
   - If Greptile chooses the base and the changed-file set is not known locally, call the root rules preliminary until the CLI identifies the scope.
   - Add `--instructions "<text>"` only for review focus the user supplied. Pass every user-supplied value as one shell-escaped argument.
   - Keep files Greptile holds back as sensitive excluded. Use `--include <paths...>` only after the user explicitly approves each exact path.
   - Completion: the base choice and review focus are known, and every known review file has scoped rules inspected or the rules are accurately marked preliminary.

3. Run the review in agent-friendly output:

   ```sh
   greptile review --agent
   ```

   Add the scoped options from step 2. Use `greptile review --resume` only to continue an unfinished review for this repository.

   Completion: the command exits and its findings or failure are captured.

4. Report the command run, base choice, any user-supplied focus, and each finding with its file and line context. Keep Greptile's findings distinct from your own judgment, and keep sensitive file contents out of the report. Ask before changing code.
   - Completion: the user can decide whether to fix, dismiss, or investigate every finding.

## Inspect or manage Greptile

- **Effective rules:** For a config-only request, run `greptile config --json`; pass a file path to see its scoped rules and instructions.
- **Previous review:** Use `greptile review show` to reopen a review and `greptile review status` to inspect the latest status for a commit.
- **Account:** Use `greptile whoami`, `greptile login`, and `greptile logout`. Let the CLI prompt for credentials; never place an API key in a command argument or report.
- **Local preferences:** Use `greptile settings list`, `get`, `set`, `unset`, or `path`. These control CLI output, layout, context, width, color, and self-hosted URLs; they do not replace repository review rules.

If a needed flag or subcommand is unclear, run `greptile <command> --help` and follow the installed CLI rather than guessing.

---
name: wizard
description: Create a native OpenCode TUI wizard for manual setup work. Use for credentials, CI secrets, third-party dashboards, infrastructure provisioning, and one-off migrations that need human actions.
---

# Wizard

Create a native OpenCode setup wizard when the user needs help with a manual service setup, credential flow, or one-off transition.

## Process

### 1. Scope

Inspect the repository before asking questions. For setup work, read environment examples, README files, compose files, framework configuration, and every workflow reference to `secrets.*` and `vars.*`. For a transition, establish the current state, target state, and irreversible actions.

Show the ordered stages. For each captured value, state where the user gets it, whether it is public or secret, and every destination that receives it. Ask the user to confirm or revise the scope.

**Done when:** the user has confirmed all stages, values, sensitivity labels, and destinations.

### 2. Map the journey

Map each stage to exact, current browser steps. Check official docs when the path or UI is uncertain. State uncertainty instead of inventing controls or URLs.

**Done when:** a stranger can follow every stage without guessing.

### 3. Publish

After confirmation, call `wizard_publish` with one declarative definition. This tool publishes the definition and starts it in the user's TUI. Include instructions and narrow destinations only. Keep captured values, shell commands, executable code, and arbitrary file operations out of the definition.

Use these rules:

- Use one focused stage for each browser task.
- Put browser actions in `instructions` in execution order.
- Mark every access-granting value as `secret`.
- Use an `env` destination only for `.env` files.
- Add a GitHub destination only when CI uses that exact name.
- Describe the exact consequence in `irreversible`.
- Use stable lowercase IDs and honest minute estimates.

### 4. Run and resume

The TUI opens approved URLs, collects values, writes declared destinations, tracks progress, and shows the summary. When the user asks to start, continue, or resume an existing wizard, call `wizard_run`; the user does not run a slash command.

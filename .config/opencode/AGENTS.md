# Mandatory workflow
- If you need to ask me anything at all, use the `question` tool.
- If you need my input, approval, confirmation, clarification, or prioritization, use the `question` tool.
- If you are blocked on missing user input, do not end the turn or ask in plain chat; call the `question` tool instead.
- Always provide concrete options in the `question` tool.
- Always leave the built-in `Type your own answer` option available.
- Do not ask me a plain-text question in chat.
- Do not add an `Other` option; rely on the built-in `Type your own answer` option instead.

## Commits

When creating commits, use Conventional Commits and follow good commit hygiene.

Rules:
- Format: `<type>(<scope>): <short summary>`
- Keep the summary imperative, lowercase, and under 72 characters
- Commit only related changes together
- Do not mix refactors, formatting, and feature changes in one commit unless required
- Prefer small, focused commits that are easy to review and revert
- Use clear types such as: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`
- Add a body when useful to explain why the change was made, especially for non-obvious changes
- Reference issue or task IDs in the footer when available

Examples:
- `feat(auth): add refresh token rotation`
- `fix(api): handle missing user profile`
- `refactor(payments): simplify webhook validation`

Avoid:
- Vague messages like `update stuff` or `fix bug`
- Oversized commits covering unrelated work
- Commit messages focused only on what changed without useful context when context matters

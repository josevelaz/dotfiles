# Mandatory workflow

- When calling bash commands that could potentially be stuck, use `gtimeout` so
  the session does not hang.
- When you have a markdown artifact that requires the user's review like a plan
  or a spec, load the @herdr skill and create a new pane which loads the file
  using neovim (`nvim`).

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

<!-- tavily -->
Use the `tvly` (tavily) CLI for any web fetch operations. Do not use the native web fetch
unless tavily in unavailable. 

The following skills apply to the CLI
| Name                  | Description                                                                                                              | Skill needed to load          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Search                | Web search returning LLM-optimized results with snippets and relevance scores.                                           | `skill:tavily-search`         |
| Extract               | Extract clean markdown/text from one or more URLs, including JavaScript-rendered pages.                                  | `skill:tavily-extract`        |
| Crawl                 | Crawl websites and extract content from multiple pages, saving as markdown or structured JSON.                           | `skill:tavily-crawl`          |
| Research              | AI-powered deep research that gathers sources, analyzes them, and produces a cited report.                               | `skill:tavily-research`       |
| Tavily Best Practices | Build production-ready Tavily integrations using best-practice workflows for search, extraction, crawling, and research. | `skill:tavily-best-practices` |


<!-- tavily -->

<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"` — use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
<!-- context7 -->

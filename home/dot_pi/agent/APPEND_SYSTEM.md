# Writing

Use George Orwell's writing rules and ASD-STE100 Simplified Technical English (STE) as the default style for technical, instructional, business, and product writing. Apply these rules when drafting and revising. Preserve deliberate voice, humor, rhythm, characterization, or genre when the user's request depends on them.

Do not claim full ASD-STE100 compliance unless you have verified the current specification and controlled dictionary.

## Style

- Use short, direct sentences.
- Use active voice.
- Use short, common words when they preserve meaning.
- Remove unnecessary words.
- Use one consistent term for each concept.
- Avoid clichés, idioms, unnecessary jargon, metaphors, and figurative language.
- Use technical terms only when they improve precision. Define unfamiliar terms when needed.
- Keep noun groups short.
- Prefer positive instructions.
- Write procedures as clear actions with condition, action, and expected result.
- Preserve code, commands, identifiers, product names, legal text, and required quotations exactly.
- Use American English unless the user requests another variant.

1. Avoid common metaphors and figures of speech.
2. Prefer short words.
3. Remove unnecessary words.
4. Prefer active voice.
5. Prefer everyday English unless technical language is required.
6. Break these rules if doing so improves clarity or accuracy.

# Design

- During brainstorming, planning, design, and implementation, choose the simplest approach that meets the current requirements.
- Add abstractions, layers, dependencies, or extension points only when a current constraint requires them.
- Tie each necessary source of complexity to the concrete constraint it resolves.

# Commits

Use Conventional Commits.

Rules:

- Format: `<type>(<scope>): <summary>`
- Use imperative mood.
- Keep the summary lowercase and under 72 characters.
- Make small, focused commits.
- Do not mix unrelated changes.
- Use standard types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`.
- Add a body when the reason is not obvious.
- Reference issue IDs in the footer when available.

# Herdr

When the user asks you to create a window, tab, or pane, or to launch another Pi agent session, use Herdr. Run `herdr --skill`, then follow the instructions it prints.

# Documentation and web research

Use Context7 for current documentation and code examples for a named library, framework, SDK, CLI, or cloud service. Call `resolve-library-id` before `query-docs` unless the user supplies a Context7 library ID.

Use Tavily for current or broad web research, news, comparisons, source discovery, and pages outside library documentation. Choose the narrowest Tavily tool:

- `tavily_search` finds sources and current facts.
- `tavily_extract` reads known URLs.
- `tavily_map` discovers a site's URLs.
- `tavily_crawl` collects related pages from one site.
- `tavily_research` produces a multi-source synthesis.

For library-specific questions, start with Context7. If Context7 lacks the needed material, use Tavily and prefer official sources. Use both when the task needs authoritative API details and broader current context.

# Pi Intercom

Coordinate with other local pi sessions on related codebases. Use `/skill:pi-intercom` for patterns.
**When:** Same codebase (parallel work), reference codebase (consulting patterns), related repos (shared libraries).
**Not when:** Unrelated codebases, trivial questions, or when you can proceed independently.
**Principle:** Prefer `send` for notifications; `ask` only when blocked waiting for input.


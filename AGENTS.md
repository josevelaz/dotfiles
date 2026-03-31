AGENTS Guidelines for repo agents

Build / Lint / Test:
- Build: No monorepo build; run project-specific Make targets, e.g. `make` in subprojects.
- Python: run tests with nose2: `nose2` and single-test: `nose2 path.to.test_module:TestClass.test_method`.
- Run linters: `flake8` / `mypy` where applicable; for C code use `make check` if present.

Code style:
- Follow repository conventions: use existing formatting (clang-format for C/C++), and .editorconfig settings.
- Imports: group std / third-party / local; use absolute imports in Python when possible.
- Formatting: run autoformatters (black for Python) and clang-format for C; respect .clang-format.
- Types: prefer explicit typing in Python (type hints) and declared types in C headers.
- Naming: snake_case for files and functions (shell/python), camelCase only where existing C code uses it; constants UPPER_SNAKE.
- Error handling: check and propagate errors; return non-zero exit codes for CLI tools; prefer exceptions in Python with clear messages.

Repo-specific rules:
- Respect .gitignore and submodule configs.
- If .cursor/rules or .cursorrules exist, follow them; if .github/copilot-instructions.md exists, follow its guidance.

Agent behavior:
- Read 2000 lines when opening files for context; run tests after changes.
- Make small, reversible commits; run pre-commit hooks locally.

Contact: maintainers via repo issues for unclear conventions.

**DO NOT FOLLOW TDD**

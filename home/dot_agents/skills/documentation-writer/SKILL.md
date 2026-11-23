---
name: documentation-writer
description: Diátaxis technical documentation and project READMEs. Use when the user wants a tutorial, how-to guide, reference, or explanation written, or a README.md created or rewritten.
---

# Documentation writer

Write software documentation that helps a specific reader reach a specific goal. Use plain, exact language, and check every command, path, and code sample against the project. Match the tone and terms of the project's existing docs; use them as context, and copy from them only when the user asks. Consult outside websites only when the user gives a link and asks you to.

## Pick the branch

- **README**: the user wants a `README.md` for the project. Follow [README](#readme).
- **Any other document**: follow [Diátaxis document](#diátaxis-document).

## Diátaxis document

Every document is exactly one of the four [Diátaxis](https://diataxis.fr/) types:

- **Tutorial**: learning-oriented steps that guide a newcomer to a successful outcome. A lesson.
- **How-to guide**: problem-oriented steps that solve one specific problem. A recipe.
- **Reference**: information-oriented description of the machinery. A dictionary.
- **Explanation**: understanding-oriented discussion that clarifies a topic.

1. **Clarify.** Settle the document type, the target audience, the reader's goal, and the scope, including what is out of scope. Ask the user for whatever the request and the project don't already answer. Done when all four are known.
2. **Propose an outline**: a table of contents with one line per section. Wait for the user's approval.
3. **Write** the approved outline in Markdown. Done when every outlined section is written and every command and code sample has been checked against the project.

## README

1. **Review the whole project**: its purpose, entry points, install and run commands, configuration, and any logo or icon. Done when you can say in one sentence what the project does and for whom, and every command you plan to show exists in the project.
2. **Write `README.md`** in GitHub Flavored Markdown. Keep it concise, appealing, and easy to scan, with few emojis. Use GitHub admonitions (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`) where they help. Use this structure, dropping sections the project doesn't need:
   - Title, with the project's logo or icon if one exists, then a badge row for build status, package version, and license where those exist.
   - A one-line summary, then a short overview of what the project does and why.
   - A minimal example near the top when the project is a library or CLI.
   - Features.
   - Prerequisites, installation, and getting started.
   - Usage, with examples and the main options.
   - Troubleshooting or further resources, when the project has known pitfalls or other docs.
3. **Leave license, contributing, and changelog content to their own files.** Link to them at most.

Done when every section matches the project and every command shown has been checked.

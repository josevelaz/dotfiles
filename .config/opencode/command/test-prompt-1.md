---
name: test-test-prompt-1
description: First test prompt for integration testing
tags:
- integration
- testing
enabled: true
arguments:
- name: input_arg
  description: Test input argument
  required: true
meta:
  category: test-integration
  command_prefix: test-
  agent: opencode
  agent_display_name: OpenCode CLI
  command_dir: .config/opencode/command
  command_format: markdown
  command_file_extension: .md
  source_prompt: test-prompt-1
  source_path: test-prompt-1.md
  version: 0.1.0
  updated_at: '2026-05-11T16:59:16.077795+00:00'
  source_type: local
  source_dir: /Users/jose/projects/slash-command-manager/tests/integration/fixtures/prompts
---

# Test Prompt 1

This is the first test prompt file used for integration testing.

It includes various frontmatter fields and body content to test the slash command generation process.

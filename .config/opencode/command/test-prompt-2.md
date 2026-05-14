---
name: test-test-prompt-2
description: Second test prompt for integration testing
tags:
- example
- integration
- testing
enabled: true
arguments:
- name: query
  description: Search query parameter
  required: true
- name: format
  description: Output format option
  required: false
meta:
  category: test-integration
  command_prefix: test-
  agent: opencode
  agent_display_name: OpenCode CLI
  command_dir: .config/opencode/command
  command_format: markdown
  command_file_extension: .md
  source_prompt: test-prompt-2
  source_path: test-prompt-2.md
  version: 0.1.0
  updated_at: '2026-05-11T16:59:16.080066+00:00'
  source_type: local
  source_dir: /Users/jose/projects/slash-command-manager/tests/integration/fixtures/prompts
---

# Test Prompt 2

This is the second test prompt file used for integration testing.

It has different content and arguments compared to test-prompt-1 to ensure proper handling of multiple prompts.

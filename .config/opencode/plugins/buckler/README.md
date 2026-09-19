# opencode-buckler

OpenCode V2 plugin (id: `buckler`). On `write`/`edit`, Jev evaluates the proposed file content against a markdown style guide and rejects the tool call before the write when it violates the guide.

## Install

```sh
opencode plugin add opencode-buckler
```

Or in config:

```json
{
  "plugins": ["opencode-buckler"]
}
```

## Setup

Set `TYPESAFE_API_KEY` in the environment. It is required when a guide is present. Do not put the key in plugin options.

## Options

```json
{
  "plugins": [
    {
      "package": "opencode-buckler",
      "options": {
        "enabled": true,
        "guide": ".opencode/code-style.md"
      }
    }
  ]
}
```

- `enabled` (default `true`): set `false` to disable gating.
- `guide` (optional path): explicit guide file. Relative paths resolve against the session directory.

Guide resolution order:

1. `options.guide`
2. `{location}/.opencode/code-style.md`
3. Project canonical `.opencode/code-style.md`

Missing guide (or empty guide) means the plugin stays idle and allows writes.

## Guide format

- Each `## ` heading becomes an independent check.
- A guide with no headings is evaluated as a single accept/reject check over the whole guide.

## Fail closed

When a guide exists, failures block the write: a missing `TYPESAFE_API_KEY`, Jev evaluation errors, and style violations all reject the tool call. Revise the change to satisfy the guide and retry.

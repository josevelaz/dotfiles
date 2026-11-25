# local-classify

An OpenCode V2 server plugin that registers a `classify` tool for Code Mode.

The tool sends text or JSON data to OpenCode's free decision model, `opencode/jev-1.13-free`. You pass a list of questions and get typed answers back in one call. The model evaluates every question in parallel.

## Questions

A question is one of three types:

- `predicate` asks a yes/no question and returns `value` plus `probability`.
- `choice` picks one value from a set and returns `choice`, `confidence`, and per-option `probabilities`.
- `score` rates the input against an ordered rubric and returns a numeric `score`, `confidence`, and per-level `probabilities`.

Each question needs a unique `name` and non-empty `instructions`. If the model cannot answer one question (for example, a refusal), that entry comes back as an `error` answer while the rest still return.

## Output

The tool returns:

- `model`: always `opencode/jev-1.13-free`.
- `answers`: an ordered array of typed answers.
- `results`: the same answers keyed by question name.

## Example

```ts
const result = await tools.classify({
  input: "The checkout flow was quick, but the receipt email never arrived.",
  questions: [
    {
      type: "predicate",
      name: "is_negative",
      instructions: "Does the writer report a problem?",
    },
    {
      type: "choice",
      name: "topic",
      instructions: "What is the message mainly about?",
      choices: ["checkout", "email", "pricing"],
    },
    {
      type: "score",
      name: "urgency",
      instructions: "How urgent is this for the writer?",
      levels: ["low", "medium", "high"],
    },
  ],
})
```

## Setup

```sh
bun install
bun run typecheck
```

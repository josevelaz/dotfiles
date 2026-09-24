# Adaptive reasoning: research and chosen policy

Researched 2026-09-14 for the [local OpenCode plugin](../.config/opencode/plugins/adaptive-reasoning/README.md). Sources below are first-party documentation, published package code, or original research. No paid model calls or comparative performance evaluation were performed.

## What providers actually control

- **OpenAI:** reasoning effort trades reasoning-token usage and latency against depth. Supported levels vary by model, and reasoning tokens are billed as output tokens. The plugin must not assume every model supports every level. [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort).
- **Anthropic:** `output_config.effort` affects the whole response, including thinking when enabled, visible text, and tool calls. Adaptive thinking and effort are separate controls. Changing top-level effort between requests invalidates cached prompt prefixes; newer per-message effort mechanisms are not used by this plugin. [Effort guide](https://platform.claude.com/docs/en/build-with-claude/effort).
- **Gemini:** `thinkingConfig.thinkingLevel` is a model-dependent depth control rather than a fixed token budget. The GenerateContent API supports different levels on different models; older budget-based configurations cannot safely be treated as level-based thinking. [Thinking guide](https://ai.google.dev/gemini-api/docs/thinking#thinking-levels), [ThinkingConfig reference](https://ai.google.dev/api/generate-content#ThinkingConfig).

Semantic labels are not comparable amounts of compute across providers. More effort is not guaranteed to help a given task.

## Why not use the model's confidence score?

- OpenAI's SimpleQA evaluation found that the tested models overstated their confidence. This concerned short factual questions and the models evaluated then, not every current coding task. [Introducing SimpleQA](https://openai.com/index/introducing-simpleqa/).
- Anthropic found useful self-evaluation under particular experimental conditions, but calibration transfer across tasks was difficult. [Language models (mostly) know what they know](https://www.anthropic.com/research/language-models-mostly-know-what-they-know).
- Huang et al. found that intrinsic reasoning self-correction without external feedback can fail or degrade performance. This is evidence against relying exclusively on unsupported self-assessment, not a direct evaluation of effort-changing tools. [ICLR 2024 paper](https://arxiv.org/abs/2310.01798).

**Design inference:** treat the model's promotion request as a noisy judgment, not privileged introspection. Prefer observable constraints and external feedback. Requiring a reason helps audit the decision but does not prove that the reason is correct.

## Chosen heuristics (policy, not research findings)

Promote one supported step when:

1. Collected evidence supports competing hypotheses that require deeper comparison.
2. Several interacting constraints or a difficult correctness argument must be reconciled.
3. A check or verifier contradicts the approach and a new reasoning strategy is needed.

Demote one step after the difficult issue is resolved—preferably supported by a check—and remaining work is routine editing, lookup, execution of a settled plan, or summarization. Never go below the starting baseline.

Do not promote merely for uncertainty, missing facts, task length, network/permission errors, or a desire to appear thorough. Do not repeatedly toggle levels. Extra tool calls and lost cache hits can negate token savings.

This first version uses a hard floor and the catalog's supported ceiling. It does not add a confidence estimator, automatic test-result classifier, configurable budget, cooldown, persistent state, or model switching: none is required to expose safe bounded control. An evaluation on representative tasks should precede claims of cost savings or improved success rate.

## OpenCode integration and version evidence

The V2 `context` hook runs before each primary dispatch, including tool continuations. Hook options override model defaults; raw request-body overlays happen later. Auxiliary title, compaction, and transient generation have separate hooks. Consequently, tool-driven effort changes take effect on the **next** primary request, not mid-response. [V2 plugin hooks](https://opencode.ai/v2/docs/build/plugins#model-requests).

Provider settings, model settings, and selected variant settings are applied in that order. Variant names can be arbitrary and their semantic values are what matter. A missing explicit baseline is deliberately treated as unsupported instead of assuming `medium` or `high`. [V2 models](https://opencode.ai/v2/docs/models).

The installed runtime is V2.0.3. Its published SDK differs from the latest website: use `ctx.catalog.model.list()` and `ctx.catalog.provider.get()` with their `.data` envelopes. The plugin has its own pinned dependency rather than replacing this dotfiles directory's older `@opencode-ai/plugin` dependency.

Published 2.0.3 contracts and lowering implementations:

- [Plugin context](https://unpkg.com/@opencode/plugin@2.0.3/dist/promise/plugin.d.ts), [catalog](https://unpkg.com/@opencode/plugin@2.0.3/dist/promise/catalog.d.ts), [session hooks](https://unpkg.com/@opencode/plugin@2.0.3/dist/promise/session.d.ts).
- [Client response envelopes](https://unpkg.com/@opencode/client@2.0.3/dist/promise/generated/types.d.ts), [model metadata](https://unpkg.com/@opencode/schema@2.0.3/dist/model.d.ts).
- [OpenAI semantic options](https://unpkg.com/@opencode/ai@2.0.3/dist/protocols/utils/open-responses-options.d.ts): `reasoningEffort` lowers to `reasoning.effort` in Responses, or `reasoning_effort` in Chat.
- [Anthropic lowering](https://unpkg.com/@opencode/ai@2.0.3/dist/protocols/anthropic-messages.js): `effort` lowers to `output_config.effort`, separately from `thinking`.
- [Gemini lowering](https://unpkg.com/@opencode/ai@2.0.3/dist/protocols/gemini.js): `thinkingConfig.thinkingLevel` lowers under `generationConfig.thinkingConfig`. It is not a top-level `thinkingLevel` option.

The plugin changes only the effort leaf, does not switch the saved model, and refuses known conflicting controls. It cannot stop a later plugin from overriding request options. Its trigger recommendations are guidance to the LLM, not enforcement of task difficulty.

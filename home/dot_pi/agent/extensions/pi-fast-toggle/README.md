# pi-fast-toggle

A Pi extension that adds `/fast` and sends the correct Fast Mode request for the active OpenAI route.

Fast Mode starts off. Its state is stored in the Pi session, so resumed sessions and branch navigation restore the state that was active on that branch.

> [!WARNING]
> Fast Mode can use subscription Fast Mode credits or higher-priced API processing. Check your OpenAI plan and billing terms before you enable it.

## Install

From npm after publication:

```sh
pi install npm:pi-fast-toggle
```

Try a local checkout:

```sh
pi -e ./index.ts
```

## Use

```text
/fast          # toggle
/fast on       # enable
/fast off      # disable
/fast status   # show the current state
/fast toggle   # toggle explicitly
```

Start Pi with Fast Mode enabled:

```sh
pi --fast
```

The CLI flag supplies the default for branches without a saved `/fast` state. An explicit `/fast on` or `/fast off` state on a branch takes precedence.

The footer shows `fast` only when Fast Mode is on and the active model uses a supported OpenAI route.

## Request behavior

| Pi route | Request changes |
| --- | --- |
| `openai-codex` with `openai-codex-responses` | Sets `service_tier: "priority"`, `originator: codex_cli_rs`, and `x-codex-routing-hint: model=<model>;tier=priority` |
| `openai` with `openai-responses` or `openai-completions` | Sets `service_tier: "fast"` |
| Any other provider or API | No changes |

The Codex subscription route uses `priority` on the wire because current Codex clients map subscription Fast Mode to the priority service tier. The extra request identity and routing hint are required for the subscription backend. The direct API route uses the public [`fast` service-tier value](https://developers.openai.com/api/reference/resources/responses/methods/create).

The extension applies the request changes to each provider call while Fast Mode is on. It does not change model definitions, credentials, URLs, or requests from other providers.

## Compatibility

The package requires Pi 0.80.4 or newer because it uses both `before_provider_request` and `before_provider_headers`.

## Development

```sh
npm install
npm run check
npm run pack:dry
```

## Protocol source

The Codex subscription routing follows the Fast Mode implementation in [`@howaboua/pi-codex-conversion`](https://github.com/IgorWarzocha/howaboua-pi-stuff/tree/main/packages/pi-codex-conversion), reviewed at commit [`dda2842`](https://github.com/IgorWarzocha/howaboua-pi-stuff/commit/dda2842691e2c37f49268970459877861fdb7107).

## License

MIT

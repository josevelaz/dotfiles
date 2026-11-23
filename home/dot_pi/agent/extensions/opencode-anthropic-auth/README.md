# OpenCode Anthropic Auth compatibility for Pi

A Pi extension that ports the request-shaping behavior from [`ex-machina-co/opencode-anthropic-auth`](https://github.com/ex-machina-co/opencode-anthropic-auth), version 1.8.1.

> [!WARNING]
> This is an unofficial compatibility layer. The upstream project warns that using a Claude subscription through a third-party client may violate Anthropic's terms and may lead to account suspension or termination. Anthropic may also bill extra usage. Use it at your own risk.

## What it does

For Anthropic models authenticated with Pi's OAuth flow, the extension:

- adds the OAuth, interleaved-thinking, and server-side-fallback beta headers;
- sends the Claude CLI user agent and `x-app: cli` attribution;
- removes `x-api-key` while leaving Pi's bearer token untouched;
- adds the Claude Agent SDK identity and billing fingerprint blocks;
- removes known OpenCode and duplicate Pi identity fingerprints from the system prompt;
- leaves tool naming and dispatch to Pi's native Anthropic OAuth transport.

It changes neither API-key requests nor requests to other providers.

## Authentication

The extension uses Pi's built-in Anthropic OAuth credential. Pi stores and refreshes the single Anthropic credential for the active provider.

1. Start Pi.
2. Run `/login`.
3. Select `Anthropic` and complete sign-in.
4. Use an Anthropic OAuth model.

The extension does not add an account store, account commands, or alternate credential selection. OAuth request shaping runs only for the active Anthropic OAuth model. API-key requests keep Pi's normal behavior.

Reload Pi only after changing the extension source:

```text
/reload
```

## Deliberate differences from the OpenCode plugin

- **Pi owns authentication:** the built-in `/login` and refresh flow remain unchanged.
- **No API-key creation flow:** use Pi's built-in Anthropic login or API-key support.
- **No zeroed model costs:** subscription traffic may incur extra-usage charges, so Pi's accounting stays intact.
- **No insecure TLS switch:** the extension never disables certificate checks.
- **No base-URL rewrite:** configure custom Anthropic models or endpoints through Pi's `models.json`.
- **No `?beta=true` URL rewrite:** Pi's Anthropic transport uses the required beta headers.

## Tests

From the dotfiles repository root:

```sh
node --test .pi/agent/extensions/opencode-anthropic-auth/*.test.ts
bun test ./.pi/agent/extensions/opencode-anthropic-auth/*.test.ts
```

## Attribution

The billing fingerprint, prompt transformation, and beta-header algorithms are adapted from `ex-machina-co/opencode-anthropic-auth`. Its MIT license is included in [`LICENSE`](./LICENSE).

# Codex native compaction prototype

This prototype replaces OpenCode's text compaction request with OpenAI Codex
`remote_compaction_v2`. It targets OpenCode `v0.0.0-beta-18286` and applies to
all models routed through the OpenAI subscription Responses endpoint.
It uses that release's exported `toLLMMessages` projector, so native
compaction receives the same model-facing history as a normal OpenCode turn.

It does not require compaction settings in `opencode.jsonc`. OpenCode owns the
automatic threshold and retained tail. The plugin reads the actual retained
tail and subtracts its estimated tokens from the native 64,000-token retention
budget.

`plugins/codex-native-compaction.ts` auto-loads this prototype for normal
OpenCode sessions. The launcher below uses a temporary home when an isolated
test instance is required.

## Start an isolated test instance

```sh
bun install --cwd prototypes/codex-compaction --frozen-lockfile
./prototypes/codex-compaction/launch.sh
```

The launcher creates a temporary home, config, session database, and plugin
storage. It copies `auth.json`, `account.json`, and the credential records that
OpenCode needs for provider routes into the private test data directory. It
does not copy existing sessions or load plugins from
`~/.config/opencode/plugins`. The launcher prints the temporary root. Remove
that directory after testing.

To reuse the same test state across restarts:

```sh
export OPENCODE_PROTOTYPE_ROOT="$TMPDIR/codex-compaction-test"
./prototypes/codex-compaction/launch.sh
```

To start an API server for scripted tests:

```sh
OPENCODE_PROTOTYPE_ROOT="$TMPDIR/codex-compaction-test" \
  ./prototypes/codex-compaction/launch.sh serve --hostname 127.0.0.1 --port 4199
```

## Run checks

```sh
bun install --cwd prototypes/codex-compaction --frozen-lockfile
bun run --cwd prototypes/codex-compaction test
bun run --cwd prototypes/codex-compaction typecheck
```

## Safety limits

- The OpenAI model ID and variant that create a checkpoint must replay it on
  the OpenAI subscription route.
- A missing, duplicate, malformed, or incompatible checkpoint blocks dispatch.
- Other providers and non-subscription OpenAI routes keep OpenCode's normal
  compaction path unless a native marker is present.
- After switching away from OpenAI, the new provider receives only messages
  after the native checkpoint. The chat gets a durable warning that the older
  opaque context is unavailable. Switching back to the original OpenAI model
  restores the full checkpoint context.
- Normal turns remain available on the alternate provider. Compaction is
  rejected there because replacing the marker-bearing boundary would make the
  opaque OpenAI checkpoint unreachable. Switch back to its OpenAI model before
  compacting.
- The marker contains only a random checkpoint ID. Opaque provider data stays
  in prototype plugin storage.
- The prototype stops on malformed or incomplete native SSE.
- Warming requests use the native checkpoint but do not replace the last
  durable tool and request context used for later compaction.
- Durable records pass through OpenCode's canonical projector. This includes
  user, assistant, system, synthetic, skill, shell, location, and compaction
  records, along with OpenCode's normal control-record omissions.

This is a local compatibility prototype. It is not a published plugin.

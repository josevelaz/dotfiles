import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fastToggleExtension, {
  applyCodexFastHeaders,
  applyFastServiceTier,
  classifyFastRequest,
} from "./index.js";

type Handler = (event: any, ctx: any) => unknown;
type Command = {
  handler: (args: string, ctx: any) => Promise<void>;
};
type Flag = {
  description?: string;
  type: "boolean";
};

const codexModel = {
  provider: "openai-codex",
  api: "openai-codex-responses",
  id: "gpt-5.6-sol",
};

function createHarness(initialEntries: any[] = [], fastFlag = false) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Command>();
  const flags = new Map<string, Flag>();
  const entries = [...initialEntries];
  const notifications: Array<{ message: string; level: string }> = [];
  const statuses = new Map<string, string | undefined>();
  const ctx = {
    model: codexModel,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setStatus(id: string, value: string | undefined) {
        statuses.set(id, value);
      },
    },
  };
  const pi = {
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    getFlag(name: string) {
      return name === "fast" ? fastFlag : undefined;
    },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    registerFlag(name: string, flag: Flag) {
      flags.set(name, flag);
    },
  } as unknown as ExtensionAPI;

  fastToggleExtension(pi);
  return { commands, ctx, entries, flags, handlers, notifications, statuses };
}

test("classifies only native Codex subscription and OpenAI API requests", () => {
  assert.equal(classifyFastRequest(codexModel as any), "codex-subscription");
  assert.equal(
    classifyFastRequest({ provider: "openai", api: "openai-responses" } as any),
    "openai-api",
  );
  assert.equal(
    classifyFastRequest({ provider: "openai", api: "openai-completions" } as any),
    "openai-api",
  );
  assert.equal(
    classifyFastRequest({ provider: "openrouter", api: "openai-responses" } as any),
    undefined,
  );
  assert.equal(
    classifyFastRequest({ provider: "openai-codex", api: "openai-responses" } as any),
    undefined,
  );
});

test("uses the correct wire value for each OpenAI route", () => {
  const payload = { model: "gpt-5.6-sol", stream: true };
  const subscription = applyFastServiceTier(payload, "codex-subscription");
  const api = applyFastServiceTier(payload, "openai-api");

  assert.deepEqual(subscription, { ...payload, service_tier: "priority" });
  assert.deepEqual(api, { ...payload, service_tier: "fast" });
  assert.deepEqual(payload, { model: "gpt-5.6-sol", stream: true });
  assert.equal(applyFastServiceTier("not-an-object", "openai-api"), "not-an-object");
});

test("adds Codex subscription routing identity without retaining an unsafe hint", () => {
  const headers: Record<string, string | null> = {};
  applyCodexFastHeaders(headers, "gpt-5.6-sol");
  assert.deepEqual(headers, {
    originator: "codex_cli_rs",
    "x-codex-routing-hint": "model=gpt-5.6-sol;tier=priority",
  });

  applyCodexFastHeaders(headers, "bad\r\nmodel");
  assert.equal(headers.originator, "codex_cli_rs");
  assert.equal(headers["x-codex-routing-hint"], null);
});

test("the /fast command toggles both subscription and API request shaping", async () => {
  const harness = createHarness();
  const command = harness.commands.get("fast");
  assert.ok(command);

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  assert.equal(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-5.6-sol" } },
      harness.ctx,
    ),
    undefined,
  );

  await command.handler("", harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), "fast");
  assert.deepEqual(harness.entries.at(-1)?.data, { enabled: true });

  const codexHeaders: Record<string, string | null> = {};
  await harness.handlers.get("before_provider_headers")?.(
    { headers: codexHeaders },
    harness.ctx,
  );
  assert.deepEqual(codexHeaders, {
    originator: "codex_cli_rs",
    "x-codex-routing-hint": "model=gpt-5.6-sol;tier=priority",
  });
  assert.deepEqual(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-5.6-sol" } },
      harness.ctx,
    ),
    { model: "gpt-5.6-sol", service_tier: "priority" },
  );

  harness.ctx.model = {
    provider: "openai",
    api: "openai-responses",
    id: "gpt-5.6-sol",
  };
  const apiHeaders: Record<string, string | null> = {};
  await harness.handlers.get("before_provider_headers")?.(
    { headers: apiHeaders },
    harness.ctx,
  );
  assert.deepEqual(apiHeaders, {});
  assert.deepEqual(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-5.6-sol" } },
      harness.ctx,
    ),
    { model: "gpt-5.6-sol", service_tier: "fast" },
  );

  await command.handler("off", harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), undefined);
  assert.equal(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-5.6-sol" } },
      harness.ctx,
    ),
    undefined,
  );
});

test("the --fast CLI flag enables the default state without overriding branch state", async () => {
  const harness = createHarness([], true);
  assert.deepEqual(harness.flags.get("fast"), {
    description: "Start with OpenAI Fast Mode enabled",
    type: "boolean",
  });

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), "fast");
  assert.deepEqual(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "gpt-5.6-sol" } },
      harness.ctx,
    ),
    { model: "gpt-5.6-sol", service_tier: "priority" },
  );

  const command = harness.commands.get("fast");
  assert.ok(command);
  await command.handler("off", harness.ctx);
  await harness.handlers.get("session_tree")?.({}, harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), undefined);
});

test("restores session and branch state from custom entries", async () => {
  const harness = createHarness([
    { type: "custom", customType: "pi-fast-toggle-state", data: { enabled: true } },
  ]);

  await harness.handlers.get("session_start")?.({}, harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), "fast");

  harness.entries.push({
    type: "custom",
    customType: "pi-fast-toggle-state",
    data: { enabled: false },
  });
  await harness.handlers.get("session_tree")?.({}, harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), undefined);

  const command = harness.commands.get("fast");
  assert.ok(command);
  await command.handler("status", harness.ctx);
  assert.equal(harness.notifications.at(-1)?.message, "Fast mode is off.");
});

test("leaves unsupported providers unchanged and reports invalid command input", async () => {
  const harness = createHarness();
  const command = harness.commands.get("fast");
  assert.ok(command);
  harness.ctx.model = {
    provider: "openrouter",
    api: "openai-responses",
    id: "openai/gpt-5.6-sol",
  };

  await command.handler("on", harness.ctx);
  assert.equal(harness.statuses.get("pi-fast-toggle"), undefined);
  assert.equal(
    await harness.handlers.get("before_provider_request")?.(
      { payload: { model: "openai/gpt-5.6-sol" } },
      harness.ctx,
    ),
    undefined,
  );

  await command.handler("maybe", harness.ctx);
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Usage: /fast [on|off|toggle|status]",
    level: "error",
  });
});

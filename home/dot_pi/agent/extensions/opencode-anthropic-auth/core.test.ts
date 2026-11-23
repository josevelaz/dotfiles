import assert from "node:assert/strict";
import { test } from "node:test";
import opencodeAnthropicAuth from "./index.ts";
import {
  CLAUDE_AGENT_IDENTITY,
  REQUIRED_BETAS,
  USER_AGENT,
  applyAnthropicOAuthHeaders,
  buildBillingHeader,
  computeCch,
  computeVersionSuffix,
  rewriteAnthropicPayload,
  sanitizeSystemText,
} from "./core.ts";

test("reproduces the upstream billing hashes", () => {
  const text = "hello world test message";
  assert.equal(computeCch(text), "4ffc3");
  assert.equal(computeVersionSuffix(text), "6ff");
  assert.equal(
    buildBillingHeader([{ role: "user", content: text }]),
    "x-anthropic-billing-header: cc_version=2.1.87.6ff; cc_entrypoint=sdk-cli; cch=4ffc3;",
  );
});

test("rewrites an Anthropic payload without mutating the source", () => {
  const payload = {
    model: "claude-opus-4-6",
    system: [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: "Keep this instruction.\n\nSee https://opencode.ai/docs for branded help.",
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      { name: "bash", description: "Run a command" },
      { name: "read_file", description: "Read a file" },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "hello world test message" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "bash", input: { command: "pwd" } },
          { type: "text", text: "Checking." },
        ],
      },
    ],
  };

  const rewritten = rewriteAnthropicPayload(payload) as typeof payload;

  assert.notStrictEqual(rewritten, payload);
  assert.equal(payload.tools[0].name, "bash");
  assert.equal((payload.messages[1].content[0] as { name: string }).name, "bash");
  assert.equal(rewritten.system[0].text, buildBillingHeader(payload.messages));
  assert.equal(rewritten.system[1].text, CLAUDE_AGENT_IDENTITY);
  assert.equal(rewritten.system[2].text, "Keep this instruction.");
  assert.deepEqual(rewritten.system[2].cache_control, { type: "ephemeral" });
  assert.strictEqual(rewritten.tools, payload.tools);
  assert.strictEqual(rewritten.messages, payload.messages);
  assert.equal(rewritten.tools[0].name, "bash");
  assert.equal(rewritten.tools[1].name, "read_file");
  assert.equal((rewritten.messages[1].content[0] as { name: string }).name, "bash");
  assert.equal((rewritten.messages[1].content[1] as { type: string }).type, "text");
});

test("keeps identity and billing blocks idempotent", () => {
  const payload = {
    system: [{ type: "text", text: CLAUDE_AGENT_IDENTITY }],
    messages: [{ role: "user", content: "hi" }],
  };
  const rewritten = rewriteAnthropicPayload(payload) as Record<string, any>;

  assert.equal(rewritten.system.filter((block: { text: string }) => block.text === CLAUDE_AGENT_IDENTITY).length, 1);
  assert.equal(
    rewritten.system.filter((block: { text: string }) => block.text.startsWith("x-anthropic-billing-header:")).length,
    1,
  );
});

test("sanitizes only known client fingerprints", () => {
  const output = sanitizeSystemText(
    [
      "You are OpenCode, the best coding agent on the planet.",
      "Keep generic instructions and /projects/opencode/example.ts.",
      "Here is some useful information about the environment you are running in:\nWorking directory: /tmp/project",
      "Report issues at https://github.com/anomalyco/opencode.",
    ].join("\n\n"),
  );

  assert.doesNotMatch(output, /You are OpenCode|github\.com\/anomalyco\/opencode/);
  assert.match(output, /\/projects\/opencode\/example\.ts/);
  assert.match(output, /Environment context you are running in:/);
});

test("merges OAuth headers without touching the bearer token", () => {
  const headers: Record<string, string | null> = {
    Authorization: "Bearer secret-token",
    "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20",
    "User-Agent": "old-agent",
    "X-Api-Key": "must-be-removed",
  };

  applyAnthropicOAuthHeaders(headers);

  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers["User-Agent"], USER_AGENT);
  assert.equal(headers["X-Api-Key"], null);
  const betas = headers["Anthropic-Beta"]?.split(",") ?? [];
  for (const beta of REQUIRED_BETAS) assert.ok(betas.includes(beta));
  assert.ok(betas.includes("claude-code-20250219"));
  assert.ok(betas.includes("server-side-fallback-2026-07-01"));
  assert.equal(betas.filter((beta) => beta === "oauth-2025-04-20").length, 1);
});

test("extension hooks run only for Anthropic OAuth", async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  opencodeAnthropicAuth({
    on(event: string, handler: (event: any, ctx: any) => unknown) {
      handlers.set(event, handler);
    },
    registerCommand() {},
  } as any);

  const oauthContext = {
    model: { provider: "anthropic", id: "claude-opus-4-6" },
    modelRegistry: { isUsingOAuth: () => true },
  };
  const apiKeyContext = {
    ...oauthContext,
    modelRegistry: { isUsingOAuth: () => false },
  };
  const payload = { tools: [{ name: "bash" }], messages: [{ role: "user", content: "hello" }] };

  const rewritten = await handlers.get("before_provider_request")?.({ payload }, oauthContext) as Record<string, any>;
  assert.strictEqual(rewritten.tools, payload.tools);
  assert.equal(rewritten.tools[0].name, "bash");
  assert.equal(await handlers.get("before_provider_request")?.({ payload }, apiKeyContext), undefined);

  const headers = { Authorization: "Bearer token" };
  await handlers.get("before_provider_headers")?.({ headers }, oauthContext);
  assert.equal((headers as Record<string, string>)["user-agent"], USER_AGENT);

  const apiKeyHeaders = { "x-api-key": "sk-ant-example" };
  await handlers.get("before_provider_headers")?.({ headers: apiKeyHeaders }, apiKeyContext);
  assert.deepEqual(apiKeyHeaders, { "x-api-key": "sk-ant-example" });
  assert.equal(handlers.has("message_end"), false);
});

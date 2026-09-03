import { createHash } from "node:crypto";

export const REQUIRED_BETAS = [
  "oauth-2025-04-20", // gitleaks:allow public Anthropic beta header, not a credential
  "interleaved-thinking-2025-05-14",
  "server-side-fallback-2026-07-01",
] as const;
export const CLAUDE_AGENT_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
export const CLAUDE_CODE_VERSION = "2.1.87";
export const CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
export const USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`;

const CCH_SALT = "59cf53e54c78";
const CCH_POSITIONS = [4, 7, 20] as const;
const PI_CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const OPENCODE_IDENTITY_PREFIX = "You are OpenCode";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const PARAGRAPH_REMOVAL_ANCHORS = ["github.com/anomalyco/opencode", "opencode.ai/docs"] as const;
const TEXT_REPLACEMENTS = [
  { match: "if OpenCode honestly", replacement: "if the assistant honestly" },
  {
    match: "Here is some useful information about the environment you are running in:",
    replacement: "Environment context you are running in:",
  },
] as const;

type UnknownRecord = Record<string, unknown>;
type ProviderHeaders = Record<string, string | null>;
type MessageLike = {
  role?: unknown;
  content?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractFirstUserMessageText(messages: unknown[]): string {
  const userMessage = messages.find((message): message is MessageLike => isRecord(message) && message.role === "user");
  if (!userMessage) return "";

  if (typeof userMessage.content === "string") return userMessage.content;
  if (!Array.isArray(userMessage.content)) return "";

  const textBlock = userMessage.content.find(
    (block): block is UnknownRecord => isRecord(block) && block.type === "text" && typeof block.text === "string",
  );
  return typeof textBlock?.text === "string" ? textBlock.text : "";
}

export function computeCch(messageText: string): string {
  return createHash("sha256").update(messageText).digest("hex").slice(0, 5);
}

export function computeVersionSuffix(messageText: string, version = CLAUDE_CODE_VERSION): string {
  const sampledCharacters = CCH_POSITIONS.map((position) => messageText[position] || "0").join("");
  return createHash("sha256")
    .update(`${CCH_SALT}${sampledCharacters}${version}`)
    .digest("hex")
    .slice(0, 3);
}

export function buildBillingHeader(messages: unknown[], version = CLAUDE_CODE_VERSION): string {
  const text = extractFirstUserMessageText(messages);
  return (
    `${BILLING_HEADER_PREFIX} ` +
    `cc_version=${version}.${computeVersionSuffix(text, version)}; ` +
    `cc_entrypoint=${CLAUDE_CODE_ENTRYPOINT}; ` +
    `cch=${computeCch(text)};`
  );
}

export function sanitizeSystemText(text: string): string {
  const paragraphs = text.split(/\n\n+/).filter((paragraph) => {
    const trimmed = paragraph.trim();
    if (paragraph.includes(OPENCODE_IDENTITY_PREFIX)) return false;
    if (trimmed === PI_CLAUDE_CODE_IDENTITY || trimmed === CLAUDE_AGENT_IDENTITY) return false;
    if (trimmed.startsWith(BILLING_HEADER_PREFIX)) return false;
    return !PARAGRAPH_REMOVAL_ANCHORS.some((anchor) => paragraph.includes(anchor));
  });

  let sanitized = paragraphs.join("\n\n");
  for (const replacement of TEXT_REPLACEMENTS) {
    sanitized = sanitized.replaceAll(replacement.match, replacement.replacement);
  }
  return sanitized.trim();
}

function sanitizeSystem(system: unknown): UnknownRecord[] {
  const source = Array.isArray(system) ? system : system == null ? [] : [system];
  const blocks: UnknownRecord[] = [];

  for (const item of source) {
    if (typeof item === "string") {
      const text = sanitizeSystemText(item);
      if (text) blocks.push({ type: "text", text });
      continue;
    }
    if (!isRecord(item) || typeof item.text !== "string") continue;

    const text = sanitizeSystemText(item.text);
    if (text) blocks.push({ ...item, type: "text", text });
  }

  return blocks;
}

export function rewriteAnthropicPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = [
    ...(messages.some((message) => isRecord(message) && message.role === "user")
      ? [{ type: "text", text: buildBillingHeader(messages) }]
      : []),
    { type: "text", text: CLAUDE_AGENT_IDENTITY },
    ...sanitizeSystem(payload.system),
  ];

  return { ...payload, system };
}

function findHeaderKey(headers: ProviderHeaders, name: string): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === normalized);
}

function readHeader(headers: ProviderHeaders, name: string): string | undefined {
  const key = findHeaderKey(headers, name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === "string" ? value : undefined;
}

function setHeader(headers: ProviderHeaders, name: string, value: string | null): void {
  const key = findHeaderKey(headers, name) ?? name;
  headers[key] = value;
}

export function applyAnthropicOAuthHeaders(headers: ProviderHeaders): void {
  const incomingBetas = (readHeader(headers, "anthropic-beta") ?? "")
    .split(",")
    .map((beta) => beta.trim())
    .filter(Boolean);
  const betas = [...new Set([...REQUIRED_BETAS, ...incomingBetas])];

  setHeader(headers, "anthropic-beta", betas.join(","));
  setHeader(headers, "user-agent", USER_AGENT);
  setHeader(headers, "x-app", "cli");
  setHeader(headers, "x-api-key", null);
}

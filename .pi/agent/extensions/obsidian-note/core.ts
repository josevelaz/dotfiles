import { readFile } from "node:fs/promises";
import { posix as pathPosix } from "node:path";

import { clipMiddle, redactSecrets } from "../insights/core.ts";

export { clipMiddle, redactSecrets };

export type NoteReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type NoteConcurrencyPolicy = "queue" | "reject";

export type NoteTargetInput = {
  gitRoot: string | null;
  cwd: string;
};

export type NoteTarget = {
  /** Vault-relative path using forward slashes, e.g. `pi-notes/dotfiles.md`. */
  vaultPath: string;
  /** Sanitized note basename without `.md`. */
  noteName: string;
};

const NOTE_NAME_MAX_CHARS = 80;

export type NoteConfig = {
  /** Obsidian vault name. Required: there is deliberately no default. */
  vault: string;
  /** Vault-relative folder for notes. Empty string means the vault root. */
  folder: string;
  provider: string;
  model: string;
  reasoningLevel: NoteReasoningLevel;
  maxEvidenceChars: number;
  maxMessageChars: number;
  maxToolResultChars: number;
  maxIdeaChars: number;
  maxOutputTokens: number;
  concurrencyPolicy: NoteConcurrencyPolicy;
  maxQueuedJobs: number;
};

/** Defaults for every field except `vault`, which must come from the config file. */
export const DEFAULT_CONFIG: Omit<NoteConfig, "vault"> = {
  folder: "pi-notes",
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  reasoningLevel: "medium",
  maxEvidenceChars: 60_000,
  maxMessageChars: 8_000,
  maxToolResultChars: 3_000,
  maxIdeaChars: 4_000,
  maxOutputTokens: 2_000,
  concurrencyPolicy: "queue",
  maxQueuedJobs: 4,
};

const CONFIG_KEYS = new Set<keyof NoteConfig>([
  "vault",
  "folder",
  "provider",
  "model",
  "reasoningLevel",
  "maxEvidenceChars",
  "maxMessageChars",
  "maxToolResultChars",
  "maxIdeaChars",
  "maxOutputTokens",
  "concurrencyPolicy",
  "maxQueuedJobs",
]);

const REASONING_LEVELS = new Set<NoteReasoningLevel>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const CONCURRENCY_POLICIES = new Set<NoteConcurrencyPolicy>(["queue", "reject"]);

/** Minimum accepted value for each numeric field. */
const NUMERIC_FLOORS: Record<
  | "maxEvidenceChars"
  | "maxMessageChars"
  | "maxToolResultChars"
  | "maxIdeaChars"
  | "maxOutputTokens"
  | "maxQueuedJobs",
  number
> = {
  maxEvidenceChars: 1_000,
  maxMessageChars: 1_000,
  maxToolResultChars: 1_000,
  maxIdeaChars: 200,
  maxOutputTokens: 200,
  maxQueuedJobs: 1,
};

export async function loadConfig(path: string): Promise<NoteConfig> {
  let raw: unknown;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Obsidian note config not found at ${path}: create it with at least a "vault" field`,
      );
    }
    throw new Error(`Cannot read obsidian note config at ${path}: ${errorMessage(error)}`);
  }
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`Cannot parse obsidian note config at ${path}: ${errorMessage(error)}`);
  }
  if (!isRecord(raw)) {
    throw new Error(`Obsidian note config at ${path} must be a JSON object`);
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key as keyof NoteConfig)) {
      throw new Error(`Unknown obsidian note config field: ${key}`);
    }
  }

  const config = { ...DEFAULT_CONFIG, ...raw } as NoteConfig;

  config.vault = validateVault(config.vault);
  config.folder = validateFolder(config.folder);

  if (!nonempty(config.provider)) {
    throw new Error("Obsidian note config requires a non-empty provider field");
  }
  if (!nonempty(config.model)) {
    throw new Error("Obsidian note config requires a non-empty model field");
  }
  config.provider = config.provider.trim();
  config.model = config.model.trim();

  if (!REASONING_LEVELS.has(config.reasoningLevel)) {
    throw new Error(
      `Invalid obsidian note reasoningLevel: ${String(config.reasoningLevel)} (expected ${[...REASONING_LEVELS].join(", ")})`,
    );
  }
  if (!CONCURRENCY_POLICIES.has(config.concurrencyPolicy)) {
    throw new Error(
      `Invalid obsidian note concurrencyPolicy: ${String(config.concurrencyPolicy)} (expected ${[...CONCURRENCY_POLICIES].join(", ")})`,
    );
  }

  for (const [key, floor] of Object.entries(NUMERIC_FLOORS) as [
    keyof typeof NUMERIC_FLOORS,
    number,
  ][]) {
    const value = config[key];
    if (!Number.isInteger(value) || value < floor) {
      throw new Error(
        `Obsidian note config field ${key} must be an integer of at least ${floor}`,
      );
    }
  }

  return config;
}

/**
 * Normalize a repo/cwd basename into a vault-safe note slug.
 * NFKC → lowercase → replace non `[a-z0-9._-]` with `-` → collapse `-` →
 * strip edge `-`/`.` → cap 80 chars; empty/`.`/`..` become `untitled`.
 */
export function sanitizeNoteName(raw: string): string {
  let name = raw.normalize("NFKC").toLowerCase();
  name = name.replace(/[^a-z0-9._-]+/g, "-");
  name = name.replace(/-+/g, "-");
  name = name.replace(/^[-.]+|[-.]+$/g, "");
  if (name.length > NOTE_NAME_MAX_CHARS) {
    name = name.slice(0, NOTE_NAME_MAX_CHARS).replace(/[-.]+$/g, "");
  }
  if (name.length === 0 || name === "." || name === "..") {
    return "untitled";
  }
  return name;
}

/**
 * Derive the one-note-per-repo vault path from Git root (or cwd fallback) and
 * a validated folder. Never uses user/model text for the path.
 */
export function deriveNoteTarget(input: NoteTargetInput, folder: string): NoteTarget {
  const base =
    input.gitRoot !== null
      ? pathBasename(input.gitRoot)
      : `no-repo-${pathBasename(input.cwd)}`;
  const noteName = sanitizeNoteName(base);
  const fileName = `${noteName}.md`;
  const vaultPath = folder.length === 0 ? fileName : `${folder}/${fileName}`;
  return { vaultPath, noteName };
}

function pathBasename(p: string): string {
  return pathPosix.basename(p.replace(/\\/g, "/"));
}

function validateVault(value: unknown): string {
  if (!nonempty(value)) {
    throw new Error("Obsidian note config requires a non-empty vault field");
  }
  const vault = value.trim();
  if (vault.includes("/") || vault.includes("\\")) {
    throw new Error("Obsidian note config vault must not contain path separators");
  }
  if (vault.includes("..")) {
    throw new Error("Obsidian note config vault must not contain '..'");
  }
  return vault;
}

function validateFolder(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Obsidian note config folder must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.includes("\\")) {
    throw new Error("Obsidian note config folder must use forward slashes");
  }
  if (/^[A-Za-z]:/.test(trimmed)) {
    throw new Error("Obsidian note config folder must be a vault-relative path");
  }
  if (trimmed.startsWith("/")) {
    throw new Error("Obsidian note config folder must be a vault-relative path");
  }
  // Strip leading/trailing slashes; "", "/" and "///" all mean the vault root.
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.length === 0) return "";
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error("Obsidian note config folder must not contain empty path segments");
    }
    if (segment === "." || segment === "..") {
      throw new Error("Obsidian note config folder must not contain '.' or '..' segments");
    }
  }
  return segments.join("/");
}

export type NoteEvidenceSection = {
  /** Section heading body, e.g. `[0007] TOOL RESULT bash ERROR`. */
  label: string;
  text: string;
  weight: number;
};

const EMPTY_EVIDENCE = "[No observable conversation context.]";

/**
 * Extract only plain text from a message content value.
 *
 * Hidden reasoning parts (`thinking`, `redacted_thinking`) are structurally
 * excluded: only `type === "text"` parts contribute text. When
 * `includeToolCallNames` is set, assistant tool calls contribute their name
 * only — never the argument payload.
 */
function contentText(content: unknown, includeToolCallNames: boolean): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (item.type === "image") parts.push("[image omitted]");
    else if (includeToolCallNames && item.type === "toolCall") {
      const name = typeof item.name === "string" ? item.name : "unknown";
      parts.push(`TOOL CALL ${name}`);
    }
  }
  return parts.join("\n\n");
}

/** Map one context entry to an evidence section, or null when not observable. */
function entrySection(
  entry: unknown,
  index: number,
  config: NoteConfig,
): NoteEvidenceSection | null {
  if (!isRecord(entry)) return null;
  const sequence = String(index + 1).padStart(4, "0");
  if (entry.type === "message" && isRecord(entry.message)) {
    const message = entry.message;
    if (message.role === "user") {
      return {
        label: `[${sequence}] USER`,
        text: clipMiddle(contentText(message.content, false), config.maxMessageChars, "user message"),
        weight: 4,
      };
    }
    if (message.role === "assistant") {
      return {
        label: `[${sequence}] ASSISTANT`,
        text: clipMiddle(
          contentText(message.content, true),
          config.maxMessageChars,
          "assistant response",
        ),
        weight: 4,
      };
    }
    if (message.role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : "unknown";
      const error = message.isError ? " ERROR" : "";
      return {
        label: `[${sequence}] TOOL RESULT ${toolName}${error}`,
        text: clipMiddle(contentText(message.content, false), config.maxToolResultChars, "tool result"),
        weight: 1,
      };
    }
    return null;
  }
  if (entry.type === "compaction") {
    return {
      label: `[${sequence}] COMPACTION SUMMARY`,
      text: clipMiddle(
        typeof entry.summary === "string" ? entry.summary : "",
        config.maxMessageChars,
        "summary",
      ),
      weight: 2,
    };
  }
  if (entry.type === "branch_summary") {
    return {
      label: `[${sequence}] BRANCH SUMMARY`,
      text: clipMiddle(
        typeof entry.summary === "string" ? entry.summary : "",
        config.maxMessageChars,
        "summary",
      ),
      weight: 2,
    };
  }
  if (entry.type === "custom_message") {
    return {
      label: `[${sequence}] CUSTOM MESSAGE`,
      text: clipMiddle(contentText(entry.content, false), config.maxMessageChars, "custom message"),
      weight: 1,
    };
  }
  return null;
}

/**
 * Convert a `buildContextEntries()` snapshot into bounded, redacted, inert
 * evidence text.
 *
 * Pure: it never touches Pi context, the system prompt, or the skills catalog.
 * The caller must take the snapshot synchronously and pass it in.
 */
export function buildNoteEvidence(entries: unknown[], config: NoteConfig): string {
  const sections = entries
    .map((entry, index) => entrySection(entry, index, config))
    .filter((section): section is NoteEvidenceSection => Boolean(section));
  if (sections.length === 0) return EMPTY_EVIDENCE;

  const cleaned = sections.map((section) => ({
    ...section,
    text: escapeEvidenceMarkers(redactSecrets(section.text.trim()) || "[empty]"),
  }));
  const full = cleaned.map(formatSection).join("\n\n");
  if (full.length <= config.maxEvidenceChars) return full;

  // `### ` + label + `\n` = label.length + 5; sections are joined by "\n\n".
  const fixedCost =
    cleaned.reduce((sum, section) => sum + section.label.length + 5, 0) + (cleaned.length - 1) * 2;
  const budget = Math.max(0, config.maxEvidenceChars - fixedCost);
  const totalWeight = cleaned.reduce((sum, section) => sum + section.weight, 0);
  let allocated = 0;
  return cleaned
    .map((section, index) => {
      const share =
        index === cleaned.length - 1
          ? Math.max(0, budget - allocated)
          : Math.floor((budget * section.weight) / totalWeight);
      allocated += share;
      return formatSection({ ...section, text: clipMiddle(section.text, share, "section") });
    })
    .join("\n\n");
}

/** Neutralize `### [nnnn] ...` lines inside message text so sections stay unforgeable. */
function escapeEvidenceMarkers(text: string): string {
  return text.replace(/^### (?=\[\d{4}\] [^\r\n]+\r?$)/gm, "\\### ");
}

function formatSection(section: NoteEvidenceSection): string {
  return `### ${section.label}\n${section.text}`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

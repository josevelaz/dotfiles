import { readFile } from "node:fs/promises";

export type NoteReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type NoteConcurrencyPolicy = "queue" | "reject";

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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

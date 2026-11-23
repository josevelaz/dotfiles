import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATE_ENTRY = "pi-fast-toggle-state";
const STATUS_ID = "pi-fast-toggle";
const CODEX_PROVIDER = "openai-codex";
const OPENAI_PROVIDER = "openai";
const CODEX_API = "openai-codex-responses";
const OPENAI_APIS = new Set(["openai-completions", "openai-responses"]);
const CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_ROUTING_HEADER = "x-codex-routing-hint";
const SAFE_CODEX_MODEL_ID = /^[A-Za-z0-9._:/-]{1,256}$/;

export type FastRequestKind = "codex-subscription" | "openai-api";

type ActiveModel = NonNullable<ExtensionContext["model"]>;
type ProviderHeaders = Record<string, string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function classifyFastRequest(
  model: Pick<ActiveModel, "api" | "provider"> | undefined,
): FastRequestKind | undefined {
  if (model?.provider === CODEX_PROVIDER && model.api === CODEX_API) {
    return "codex-subscription";
  }
  if (model?.provider === OPENAI_PROVIDER && OPENAI_APIS.has(model.api)) {
    return "openai-api";
  }
  return undefined;
}

export function applyFastServiceTier(
  payload: unknown,
  kind: FastRequestKind,
): unknown {
  if (!isRecord(payload)) return payload;
  return {
    ...payload,
    service_tier: kind === "codex-subscription" ? "priority" : "fast",
  };
}

export function applyCodexFastHeaders(
  headers: ProviderHeaders,
  modelId: string,
): void {
  headers.originator = CODEX_ORIGINATOR;
  headers[CODEX_ROUTING_HEADER] = SAFE_CODEX_MODEL_ID.test(modelId)
    ? `model=${modelId};tier=priority`
    : null;
}

function restoreEnabled(ctx: ExtensionContext, defaultEnabled = false): boolean {
  let enabled = defaultEnabled;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
    if (isRecord(entry.data) && typeof entry.data.enabled === "boolean") {
      enabled = entry.data.enabled;
    }
  }
  return enabled;
}

function describeState(enabled: boolean, ctx: ExtensionContext): string {
  if (!enabled) return "Fast mode is off.";

  const model = ctx.model;
  const kind = classifyFastRequest(model);
  if (!model || !kind) {
    const current = model ? `${model.provider}/${model.id}` : "no active model";
    return `Fast mode is on, but ${current} is not an OpenAI Fast Mode target.`;
  }
  if (kind === "codex-subscription") {
    return `Fast mode is on for ${model.provider}/${model.id} (Codex subscription).`;
  }
  return `Fast mode is on for ${model.provider}/${model.id} (OpenAI API).`;
}

export default function fastToggleExtension(pi: ExtensionAPI): void {
  let enabled = false;

  const updateStatus = (ctx: ExtensionContext): void => {
    const active = enabled && classifyFastRequest(ctx.model) !== undefined;
    ctx.ui.setStatus(STATUS_ID, active ? "fast" : undefined);
  };

  const setEnabled = (next: boolean, ctx: ExtensionContext): void => {
    enabled = next;
    pi.appendEntry(STATE_ENTRY, { enabled });
    updateStatus(ctx);
    ctx.ui.notify(describeState(enabled, ctx), "info");
  };

  pi.registerFlag("fast", {
    description: "Start with OpenAI Fast Mode enabled",
    type: "boolean",
  });

  const defaultEnabled = (): boolean => pi.getFlag("fast") === true;

  pi.registerCommand("fast", {
    description: "Toggle OpenAI Fast Mode for this session",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "toggle", "status"];
      const matches = options.filter((option) => option.startsWith(prefix));
      return matches.length > 0
        ? matches.map((option) => ({ value: option, label: option }))
        : null;
    },
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "status") {
        updateStatus(ctx);
        ctx.ui.notify(describeState(enabled, ctx), "info");
        return;
      }
      if (action === "" || action === "toggle") {
        setEnabled(!enabled, ctx);
        return;
      }
      if (action === "on") {
        setEnabled(true, ctx);
        return;
      }
      if (action === "off") {
        setEnabled(false, ctx);
        return;
      }
      ctx.ui.notify("Usage: /fast [on|off|toggle|status]", "error");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = restoreEnabled(ctx, defaultEnabled());
    updateStatus(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    enabled = restoreEnabled(ctx, defaultEnabled());
    updateStatus(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("before_provider_headers", (event, ctx) => {
    const model = ctx.model;
    if (!enabled || classifyFastRequest(model) !== "codex-subscription" || !model) {
      return;
    }
    applyCodexFastHeaders(event.headers, model.id);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled) return;
    const kind = classifyFastRequest(ctx.model);
    if (!kind || !isRecord(event.payload)) return;
    return applyFastServiceTier(event.payload, kind);
  });
}

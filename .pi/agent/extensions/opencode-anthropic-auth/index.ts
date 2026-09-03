import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyAnthropicOAuthHeaders, rewriteAnthropicPayload } from "./core.ts";

function isAnthropicOAuth(ctx: ExtensionContext): boolean {
  const model = ctx.model;
  return model?.provider === "anthropic" && ctx.modelRegistry.isUsingOAuth(model);
}

export default function opencodeAnthropicAuth(pi: ExtensionAPI): void {
  pi.on("before_provider_headers", (event, ctx) => {
    if (!isAnthropicOAuth(ctx)) return;
    applyAnthropicOAuthHeaders(event.headers);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!isAnthropicOAuth(ctx)) return;
    return rewriteAnthropicPayload(event.payload);
  });
}

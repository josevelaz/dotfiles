/**
 * token-count.ts
 *
 * Adds the actual token count to the footer status bar.
 * The built-in footer shows "13.8%/1.0M (auto)" — percent and context window.
 * This adds the missing piece: "137.9k tokens used" so you see both.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function fmt(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

export default function (pi: ExtensionAPI) {
  const KEY = "ctx-tokens";

  function update(ctx: { ui: any; getContextUsage: () => any }) {
    const u = ctx.getContextUsage();
    if (!u || u.tokens === null) {
      ctx.ui.setStatus(KEY, undefined);
      return;
    }
    const color = u.tokens >= 100_000 ? "warning" : "success";
    ctx.ui.setStatus(KEY, ctx.ui.theme.fg(color, `${fmt(u.tokens)} tokens used`));
  }

  pi.on("session_start", (_e, ctx) => update(ctx));
  pi.on("message_end", (_e, ctx) => update(ctx));
  pi.on("model_select", (_e, ctx) => update(ctx));
}

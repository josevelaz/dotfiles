import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "context-tokens";

function updateStatus(ctx: ExtensionContext): void {
	const usage = ctx.getContextUsage();
	const text = usage
		? ctx.ui.theme.fg("dim", `ctx ${Math.round(usage.tokens).toLocaleString()} tokens`)
		: undefined;

	ctx.ui.setStatus(STATUS_ID, text);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => updateStatus(ctx));
	pi.on("before_agent_start", (_event, ctx) => updateStatus(ctx));
	pi.on("turn_end", (_event, ctx) => updateStatus(ctx));
	pi.on("session_compact", (_event, ctx) => updateStatus(ctx));
	pi.on("session_tree", (_event, ctx) => updateStatus(ctx));
	pi.on("model_select", (_event, ctx) => updateStatus(ctx));
}

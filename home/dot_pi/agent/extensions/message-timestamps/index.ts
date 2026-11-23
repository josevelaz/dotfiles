import { AssistantMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { addTimestampLabel, TimestampLabelCache } from "./core.ts";

const PATCH_STATE = Symbol.for("pi.agent-message-timestamps.v2");

type AssistantMessageView = {
	lastMessage?: { timestamp?: number };
};

type RenderAssistantMessage = (this: AssistantMessageComponent, width: number) => string[];

interface TimestampPatchState {
	active: boolean;
	enabled: boolean;
	style: (text: string) => string;
	labels: TimestampLabelCache;
}

type PatchedPrototype = AssistantMessageComponent & {
	[PATCH_STATE]?: TimestampPatchState;
};

function installPatch(): TimestampPatchState {
	const prototype = AssistantMessageComponent.prototype as PatchedPrototype;
	const installed = prototype[PATCH_STATE];
	if (installed !== undefined) return installed;

	const state: TimestampPatchState = {
		active: false,
		enabled: true,
		style: (text) => text,
		labels: new TimestampLabelCache(),
	};
	const originalRender = prototype.render as RenderAssistantMessage;

	prototype.render = function renderWithTimestamp(width: number): string[] {
		const lines = originalRender.call(this, width);
		if (!state.active || !state.enabled) return lines;

		const message = (this as unknown as AssistantMessageView).lastMessage;
		const timestamp = message?.timestamp;
		if (message === undefined || timestamp === undefined || !Number.isFinite(timestamp)) {
			return lines;
		}

		return addTimestampLabel(lines, state.labels.get(message, timestamp), width, state.style, truncateToWidth);
	};
	prototype[PATCH_STATE] = state;
	return state;
}

function applyTheme(state: TimestampPatchState, ctx: ExtensionContext): void {
	state.style = (text) => ctx.ui.theme.fg("dim", text);
}

export default function messageTimestamps(pi: ExtensionAPI): void {
	const state = installPatch();

	pi.on("session_start", (_event, ctx) => {
		state.labels.clear();
		state.active = true;
		applyTheme(state, ctx);
	});

	pi.on("session_shutdown", () => {
		state.active = false;
		state.labels.clear();
	});

	pi.registerCommand("timestamps", {
		description: "Toggle human-readable timestamps below agent messages",
		handler: async (args, ctx) => {
			const mode = args.trim().toLowerCase();
			if (mode === "on") {
				state.enabled = true;
			} else if (mode === "off") {
				state.enabled = false;
			} else if (mode === "" || mode === "toggle") {
				state.enabled = !state.enabled;
			} else {
				ctx.ui.notify("Usage: /timestamps [on|off|toggle]", "error");
				return;
			}

			applyTheme(state, ctx);
			ctx.ui.notify(`Agent timestamps ${state.enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}

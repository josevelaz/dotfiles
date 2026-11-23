import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

const MODEL_COMMANDS = {
	sol: {
		provider: "openai-codex",
		model: "gpt-5.6-sol",
		description: "Switch to GPT-5.6 Sol",
	},
	luna: {
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		description: "Switch to GPT-5.6 Luna",
	},
	opus: {
		provider: "anthropic",
		model: "claude-opus-5",
		description: "Switch to Claude Opus 5",
	},
} as const;

type ModelCommand = keyof typeof MODEL_COMMANDS;

async function switchModel(
	command: ModelCommand,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
): Promise<void> {
	const target = MODEL_COMMANDS[command];
	const model = ctx.modelRegistry.find(target.provider, target.model);

	if (!model) {
		ctx.ui.notify(`Model ${target.provider}/${target.model} is not available`, "error");
		return;
	}

	if (!(await pi.setModel(model))) {
		ctx.ui.notify(`No API key for ${target.provider}/${target.model}`, "error");
		return;
	}

	ctx.ui.notify(`Switched to ${target.provider}/${target.model}`, "info");
}

export default function modelCommands(pi: ExtensionAPI): void {
	for (const command of Object.keys(MODEL_COMMANDS) as ModelCommand[]) {
		pi.registerCommand(command, {
			description: MODEL_COMMANDS[command].description,
			handler: async (_args, ctx) => switchModel(command, ctx, pi),
		});
	}
}

import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import modelCommands from "../extensions/model-commands.ts";

type CommandHandler = (
	args: string,
	ctx: ExtensionCommandContext,
) => Promise<void>;

const TARGETS = {
	sol: { provider: "openai-codex", model: "gpt-5.6-sol" },
	luna: { provider: "openai-codex", model: "gpt-5.6-luna" },
	opus: { provider: "anthropic", model: "claude-opus-5" },
} as const;

function createHarness(options: { modelAvailable?: boolean; authenticated?: boolean } = {}) {
	const commands = new Map<
		string,
		{ description: string; handler: CommandHandler }
	>();
	const findCalls: Array<{ provider: string; model: string }> = [];
	const setModelCalls: unknown[] = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const model = { provider: "test", id: "test-model" };

	const pi = {
		registerCommand(
			name: string,
			command: { description: string; handler: CommandHandler },
		) {
			commands.set(name, command);
		},
		async setModel(selectedModel: unknown) {
			setModelCalls.push(selectedModel);
			return options.authenticated ?? true;
		},
	};

	const ctx = {
		modelRegistry: {
			find(provider: string, modelId: string) {
				findCalls.push({ provider, model: modelId });
				return options.modelAvailable === false ? undefined : model;
			},
		},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	} as unknown as ExtensionCommandContext;

	modelCommands(pi as unknown as ExtensionAPI);

	return { commands, ctx, findCalls, setModelCalls, notifications, model };
}

describe("model command extension", () => {
	test("registers the requested commands", () => {
		const { commands } = createHarness();

		expect([...commands.keys()]).toEqual(["sol", "luna", "opus"]);
		expect(commands.get("sol")?.description).toBe("Switch to GPT-5.6 Sol");
		expect(commands.get("luna")?.description).toBe("Switch to GPT-5.6 Luna");
		expect(commands.get("opus")?.description).toBe("Switch to Claude Opus 5");
	});

	for (const [command, target] of Object.entries(TARGETS)) {
		test(`/${command} selects ${target.provider}/${target.model}`, async () => {
			const harness = createHarness();

			await harness.commands.get(command)?.handler("", harness.ctx);

			expect(harness.findCalls).toEqual([
				{ provider: target.provider, model: target.model },
			]);
			expect(harness.setModelCalls).toEqual([harness.model]);
			expect(harness.notifications).toEqual([
				{
					message: `Switched to ${target.provider}/${target.model}`,
					level: "info",
				},
			]);
		});
	}

	test("reports an unavailable model without trying to select it", async () => {
		const harness = createHarness({ modelAvailable: false });

		await harness.commands.get("sol")?.handler("", harness.ctx);

		expect(harness.setModelCalls).toEqual([]);
		expect(harness.notifications).toEqual([
			{
				message: "Model openai-codex/gpt-5.6-sol is not available",
				level: "error",
			},
		]);
	});

	test("reports missing authentication", async () => {
		const harness = createHarness({ authenticated: false });

		await harness.commands.get("opus")?.handler("", harness.ctx);

		expect(harness.setModelCalls).toEqual([harness.model]);
		expect(harness.notifications).toEqual([
			{
				message: "No API key for anthropic/claude-opus-5",
				level: "error",
			},
		]);
	});
});

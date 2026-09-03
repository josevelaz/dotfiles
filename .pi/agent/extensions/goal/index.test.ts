import { describe, expect, mock, test } from "bun:test";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	formatDuration,
	formatTokenCount,
	GoalController,
	GOAL_STATE_VERSION,
	parseGoalSnapshot,
	type GoalState,
} from "./controller.ts";

mock.module("@earendil-works/pi-ai", () => ({
	StringEnum: (values: string[]) => ({ type: "string", enum: values }),
}));
mock.module("@earendil-works/pi-tui", () => ({
	Text: class Text {
		constructor(public text: string) {}
	},
	truncateToWidth: (text: string, width: number) => text.slice(0, width),
	visibleWidth: (text: string) => text.length,
}));
mock.module("typebox", () => ({
	Type: {
		Object: (properties: unknown) => ({ type: "object", properties }),
		String: (options: unknown) => ({
			type: "string",
			...((options as object) ?? {}),
		}),
	},
}));

const { GoalExtension } = await import("./index.ts");

type Handler = (event: any, ctx: ExtensionContext) => Promise<unknown> | unknown;
type Command = {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};
type Tool = { execute: (...args: any[]) => Promise<any> };

class GoalHarness {
	readonly handlers = new Map<string, Handler[]>();
	readonly commands = new Map<string, Command>();
	readonly tools = new Map<string, Tool>();
	readonly entries: any[] = [];
	readonly messages: Array<{ message: any; options: any }> = [];
	readonly notifications: Array<{ message: string; type?: string }> = [];
	readonly statuses: Array<string | undefined> = [];
	readonly extension: InstanceType<typeof GoalExtension>;
	activeTools = ["read"];
	idle = true;
	pendingMessages = false;
	branch: any[] = [];

	readonly pi = {
		on: (event: string, handler: Handler) => {
			this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
		},
		registerCommand: (name: string, command: Command) => this.commands.set(name, command),
		registerTool: (tool: Tool & { name: string }) => {
			this.tools.set(tool.name, tool);
			this.activeTools = [...this.activeTools, tool.name];
		},
		registerMessageRenderer: () => {},
		appendEntry: (customType: string, data: unknown) => {
			const entry = { type: "custom", customType, data };
			this.entries.push(entry);
			this.branch.push(entry);
		},
		sendMessage: (message: unknown, options: unknown) => {
			this.messages.push({ message, options });
		},
		getActiveTools: () => [...this.activeTools],
		setActiveTools: (tools: string[]) => {
			this.activeTools = [...tools];
		},
	};

	readonly ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/tmp/project",
		isIdle: () => this.idle,
		hasPendingMessages: () => this.pendingMessages,
		sessionManager: { getBranch: () => this.branch },
		ui: {
			notify: (message: string, type?: string) => this.notifications.push({ message, type }),
			setStatus: (_key: string, text: string | undefined) => this.statuses.push(text),
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			},
		},
	} as unknown as ExtensionCommandContext;

	constructor(controller = new GoalController()) {
		this.extension = new GoalExtension(this.pi as any, controller);
		this.extension.register();
	}

	async emit(event: string, data: Record<string, unknown> = {}): Promise<unknown[]> {
		const results: unknown[] = [];
		for (const handler of this.handlers.get(event) ?? []) {
			results.push(await handler({ type: event, ...data }, this.ctx));
		}
		return results;
	}

	async command(args: string): Promise<void> {
		await this.commands.get("goal")?.handler(args, this.ctx);
	}

	latestState(): GoalState | null | undefined {
		return parseGoalSnapshot(this.entries.at(-1)?.data);
	}

	async shutdown(): Promise<void> {
		await this.emit("session_shutdown", { reason: "quit" });
	}
}

function assistantMessage(tokens: number, stopReason = "stop") {
	return {
		role: "assistant",
		content: [{ type: "text", text: "working" }],
		usage: { totalTokens: tokens },
		stopReason,
	};
}

describe("GoalController", () => {
	test("tracks active time without counting paused time", () => {
		let now = 1_000;
		const controller = new GoalController(() => now);
		controller.start("Ship the feature");
		now = 6_000;
		expect(controller.elapsedMs()).toBe(5_000);
		expect(controller.pause()).toBe(true);
		now = 20_000;
		expect(controller.elapsedMs()).toBe(5_000);
		expect(controller.resume()).toBe(true);
		now = 23_000;
		expect(controller.elapsedMs()).toBe(8_000);
	});

	test("restores valid snapshots and rejects malformed state", () => {
		const controller = new GoalController(() => 10_000);
		controller.start("Pass all tests");
		controller.recordTurn(1_250);
		const snapshot = controller.serialize();
		expect(parseGoalSnapshot(snapshot)?.tokens).toBe(1_250);
		expect(parseGoalSnapshot({ version: 99, state: null })).toBeUndefined();
		expect(
			parseGoalSnapshot({
				version: GOAL_STATE_VERSION,
				state: { objective: "" },
			}),
		).toBeUndefined();
	});

	test("enforces only the continuation limit", () => {
		const controller = new GoalController(Date.now, { maxContinuations: 1 });
		controller.start("Bounded work");
		controller.recordTurn(2_000_000);
		expect(controller.budgetReason()).toBeUndefined();

		controller.recordContinuation();
		expect(controller.budgetReason()).toContain("continuation budget");
	});

	test("formats status metrics compactly", () => {
		expect(formatDuration(999)).toBe("0s");
		expect(formatDuration(65_000)).toBe("1m 5s");
		expect(formatDuration(3_900_000)).toBe("1h 5m");
		expect(formatTokenCount(999)).toBe("999");
		expect(formatTokenCount(1_250)).toBe("1.3k");
		expect(formatTokenCount(25_000)).toBe("25k");
	});
});

describe("GoalExtension", () => {
	test("sets a goal, activates reporting, and starts work", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("All tests pass without warnings");

			expect(app.latestState()).toMatchObject({
				objective: "All tests pass without warnings",
				status: "pursuing",
			});
			expect(app.activeTools).toContain("goal_report");
			expect(app.messages.at(-1)).toMatchObject({
				message: { customType: "goal-start", display: true },
				options: { triggerTurn: true, deliverAs: "followUp" },
			});
		} finally {
			await app.shutdown();
		}
	});

	test("runs the status timer only while pursuing and skips unchanged writes", async () => {
		const controller = new GoalController(() => 1_000);
		const app = new GoalHarness(controller);
		const statusTimer = () => (app.extension as unknown as { statusTimer?: unknown }).statusTimer;
		try {
			await app.emit("session_start", { reason: "startup" });
			expect(statusTimer()).toBeUndefined();

			await app.command("Bound the render work");
			expect(statusTimer()).toBeDefined();
			const writesAfterStart = app.statuses.length;

			await app.emit("session_tree");
			expect(app.statuses.length).toBe(writesAfterStart);

			await app.command("pause");
			expect(statusTimer()).toBeUndefined();
			await app.command("resume");
			expect(statusTimer()).toBeDefined();

			await app.tools
				.get("goal_report")
				?.execute("call", { status: "achieved", evidence: "verified" }, undefined, undefined, app.ctx);
			expect(statusTimer()).toBeUndefined();
		} finally {
			await app.shutdown();
		}
	});

	test("supports status, pause, resume, and Claude clear aliases", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Migrate the API");
			await app.command("pause");
			expect(app.latestState()).toMatchObject({ status: "paused" });
			expect(app.activeTools).not.toContain("goal_report");

			const messageCount = app.messages.length;
			await app.command("resume");
			expect(app.latestState()).toMatchObject({ status: "pursuing" });
			expect(app.messages.length).toBe(messageCount + 1);
			expect(app.messages.at(-1)?.message).toMatchObject({
				customType: "goal-continuation",
				display: false,
			});

			await app.command("");
			expect(app.notifications.at(-1)?.message).toContain("Objective: Migrate the API");

			await app.command("cancel");
			expect(app.latestState()).toBeNull();
			expect(app.activeTools).not.toContain("goal_report");
		} finally {
			await app.shutdown();
		}
	});

	test("resumes a blocked goal with user direction", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Deploy the release");
			await app.tools
				.get("goal_report")
				?.execute(
					"call",
					{ status: "blocked", evidence: "Need the target environment." },
					undefined,
					undefined,
					app.ctx,
				);

			expect(app.messages.at(-1)).toMatchObject({
				message: {
					customType: "goal-report",
					display: true,
					details: { status: "blocked", reason: "Need the target environment." },
				},
				options: { deliverAs: "nextTurn" },
			});
			expect(app.messages.at(-1)?.message.content).toBe(
				"Goal blocked and paused.\n\nBlocker: Need the target environment.",
			);

			await app.command("resume Deploy to staging first, then run the smoke tests.");

			expect(app.latestState()).toMatchObject({
				objective: "Deploy the release",
				status: "pursuing",
			});
			expect(app.messages.at(-1)).toMatchObject({
				message: {
					customType: "goal-continuation",
					display: false,
				},
				options: { triggerTurn: true, deliverAs: "followUp" },
			});
			expect(app.messages.at(-1)?.message.content).toContain("User direction for this continuation");
			expect(app.messages.at(-1)?.message.content).toContain(
				"Deploy to staging first, then run the smoke tests.",
			);
			expect(app.notifications.at(-1)?.message).toBe("Goal resumed with new direction.");
		} finally {
			await app.shutdown();
		}
	});

	test("restores branch-local goal state", async () => {
		const restored: GoalState = {
			version: GOAL_STATE_VERSION,
			objective: "Restore me",
			status: "paused",
			startedAt: 1,
			elapsedMs: 2_000,
			turns: 3,
			tokens: 4_000,
			continuations: 2,
		};
		const app = new GoalHarness();
		app.branch = [
			{
				type: "custom",
				customType: "goal-state",
				data: { version: GOAL_STATE_VERSION, state: restored },
			},
		];
		try {
			await app.emit("session_start", { reason: "resume" });
			await app.command("check");
			expect(app.notifications.at(-1)?.message).toContain("Goal: Paused");
			expect(app.notifications.at(-1)?.message).toContain("Tokens: 4.0k");
		} finally {
			await app.shutdown();
		}
	});

	test("injects the active objective into each agent run", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Reach 90% coverage");
			const [result] = await app.emit("before_agent_start", {
				systemPrompt: "base",
			});
			const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
			expect(systemPrompt.includes("Reach 90% coverage")).toBe(true);
			expect(systemPrompt.includes("completion audit")).toBe(true);
		} finally {
			await app.shutdown();
		}
	});

	test("continues after substantive work, then pauses a no-tool continuation", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Fix the suite");
			await app.emit("agent_start");
			await app.emit("turn_start");
			await app.emit("tool_execution_start", {
				toolName: "bash",
				toolCallId: "one",
			});
			await app.emit("turn_end", { message: assistantMessage(250) });
			await app.emit("agent_settled");

			expect(app.messages.at(-1)?.message).toMatchObject({
				customType: "goal-continuation",
			});
			expect(app.latestState()).toMatchObject({
				turns: 1,
				tokens: 250,
				continuations: 1,
			});

			await app.emit("agent_start");
			await app.emit("turn_start");
			await app.emit("turn_end", { message: assistantMessage(100) });
			const messageCount = app.messages.length;
			await app.emit("agent_settled");

			expect(app.messages.length).toBe(messageCount);
			expect(app.latestState()).toMatchObject({
				status: "paused",
				turns: 2,
				tokens: 350,
			});
			expect(app.notifications.at(-1)?.message).toContain("made no tool call");
		} finally {
			await app.shutdown();
		}
	});

	test("does not continue while user input is queued", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Finish the migration");
			await app.emit("agent_start");
			await app.emit("tool_execution_start", {
				toolName: "read",
				toolCallId: "one",
			});
			app.pendingMessages = true;
			const messageCount = app.messages.length;
			await app.emit("agent_settled");
			expect(app.messages.length).toBe(messageCount);
		} finally {
			await app.shutdown();
		}
	});

	test("lets the model complete a goal with evidence", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Make tests green");
			const result = await app.tools
				.get("goal_report")
				?.execute("call", { status: "achieved", evidence: "bun test: 42 passed" }, undefined, undefined, app.ctx);

			expect(result).toMatchObject({
				terminate: true,
				details: { status: "achieved" },
			});
			expect(result.details.evidence).toBeUndefined();
			expect(app.messages.at(-1)).toMatchObject({
				message: {
					customType: "goal-report",
					display: true,
					details: { status: "achieved", objective: "Make tests green", evidence: "bun test: 42 passed" },
				},
				options: { deliverAs: "nextTurn" },
			});
			expect(app.messages.at(-1)?.message.content).toBe("Goal achieved.\n\nEvidence: bun test: 42 passed");
			expect(app.latestState()).toMatchObject({
				status: "achieved",
				evidence: "bun test: 42 passed",
			});
			expect(app.activeTools).not.toContain("goal_report");
		} finally {
			await app.shutdown();
		}
	});

	test("pauses an interrupted goal", async () => {
		const app = new GoalHarness();
		try {
			await app.emit("session_start", { reason: "startup" });
			await app.command("Long-running refactor");
			await app.emit("message_end", {
				message: assistantMessage(0, "aborted"),
			});
			expect(app.latestState()).toMatchObject({
				status: "paused",
				reason: "Interrupted by the user.",
			});
			expect(app.notifications.at(-1)?.message).toContain("paused after interruption");
		} finally {
			await app.shutdown();
		}
	});
});

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { formatDuration, formatTokenCount, GoalController, parseGoalSnapshot, type GoalState } from "./controller.ts";

const GOAL_ENTRY_TYPE = "goal-state";
const GOAL_MESSAGE_TYPE = "goal-start";
const GOAL_REPORT_MESSAGE_TYPE = "goal-report";
const GOAL_TOOL_NAME = "goal_report";
const STATUS_KEY = "goal";
const STATUS_REFRESH_MS = 60_000;

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);
const STATUS_ALIASES = new Set(["check", "status"]);

interface GoalReportDetails {
	status: "achieved" | "blocked";
	objective?: string;
	evidence?: string;
	reason?: string;
}

type GoalAPI = Pick<
	ExtensionAPI,
	| "appendEntry"
	| "getActiveTools"
	| "on"
	| "registerCommand"
	| "registerMessageRenderer"
	| "registerTool"
	| "sendMessage"
	| "setActiveTools"
>;

function statusLabel(state: Readonly<GoalState>): string {
	switch (state.status) {
		case "pursuing":
			return "Pursuing";
		case "paused":
			return "Paused";
		case "blocked":
			return "Blocked";
		case "achieved":
			return "Achieved";
		case "budget-limited":
			return "Budget limited";
	}
}

function promptForGoal(objective: string): string {
	return `\n\n## Active Goal\n\nYou are pursuing this session-level completion condition:\n\n<goal>\n${objective}\n</goal>\n\nWork autonomously toward this outcome across turns. Keep the goal in force even when the user gives tactical guidance. Before declaring success, perform a completion audit against concrete evidence such as changed files, command output, tests, benchmarks, generated artifacts, or research evidence. When the condition is fully met, call ${GOAL_TOOL_NAME} with status \"achieved\" and concise evidence. If progress requires information, credentials, or a decision that you cannot obtain, call ${GOAL_TOOL_NAME} with status \"blocked\" and explain the blocker. Do not claim completion merely because you described a plan or made partial progress.`;
}

function continuationMessage(objective: string, prompt?: string): string {
	const direction = prompt === undefined ? "" : `\n\nUser direction for this continuation:\n\n${prompt}`;
	return `[GOAL CONTINUATION]\nContinue pursuing the active goal:\n\n${objective}${direction}\n\nTake the next substantive action. Treat the user's direction as tactical guidance without replacing the goal. Audit concrete evidence before completion. Call ${GOAL_TOOL_NAME} with status \"achieved\" only when the full condition is met, or status \"blocked\" when no useful action remains without user input. Do not merely restate progress or describe future steps.`;
}

function totalTokens(message: unknown): number {
	if (typeof message !== "object" || message === null) return 0;
	const candidate = message as {
		role?: string;
		usage?: { totalTokens?: unknown };
	};
	if (candidate.role !== "assistant") return 0;
	const tokens = candidate.usage?.totalTokens;
	return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0;
}

export class GoalExtension {
	private readonly controller: GoalController;
	private statusTimer: ReturnType<typeof setInterval> | undefined;
	private sessionGeneration = 0;
	private statusInitialized = false;
	private lastStatusText: string | undefined;
	private currentRunIsContinuation = false;
	private pendingContinuation = false;
	private runHadToolCall = false;
	private turnWasPursuing = false;

	constructor(
		private readonly pi: GoalAPI,
		controller = new GoalController(),
	) {
		this.controller = controller;
	}

	register(): void {
		this.registerMessageRenderer();
		this.registerGoalTool();
		this.registerGoalCommand();
		this.registerLifecycle();
	}

	private registerMessageRenderer(): void {
		this.pi.registerMessageRenderer(GOAL_MESSAGE_TYPE, (message, _options, theme) => {
			const details = message.details as { objective?: string } | undefined;
			const objective = details?.objective ?? String(message.content);
			return new Text(theme.fg("accent", theme.bold("◎ Goal")) + `\n${theme.fg("muted", objective)}`, 0, 0);
		});

		this.pi.registerMessageRenderer(GOAL_REPORT_MESSAGE_TYPE, (message, _options, theme) => {
			const details = message.details as GoalReportDetails | undefined;
			const achieved = details?.status === "achieved";
			const heading = achieved ? theme.fg("success", "✓ Goal achieved") : theme.fg("warning", "◇ Goal blocked");
			const explanation = details?.evidence ?? details?.reason;
			return new Text(heading + (explanation ? `\n${theme.fg("muted", explanation)}` : ""), 0, 0);
		});
	}

	private emitReport(details: GoalReportDetails, explanation: string): void {
		const heading = details.status === "achieved" ? "Goal achieved." : "Goal blocked and paused.";
		const label = details.status === "achieved" ? "Evidence" : "Blocker";
		this.pi.sendMessage(
			{
				customType: GOAL_REPORT_MESSAGE_TYPE,
				content: `${heading}\n\n${label}: ${explanation}`,
				display: true,
				details,
			},
			{ deliverAs: "nextTurn" },
		);
	}

	private registerGoalTool(): void {
		this.pi.registerTool({
			name: GOAL_TOOL_NAME,
			label: "Goal Report",
			description:
				"Finish or block the active session goal after auditing concrete evidence. Only use achieved when the entire completion condition is met.",
			parameters: Type.Object({
				status: StringEnum(["achieved", "blocked"] as const),
				evidence: Type.String({
					minLength: 1,
					description:
						"For achieved: concrete verification evidence. For blocked: the exact blocker and useful next step.",
				}),
			}),
			executionMode: "sequential",
			execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
				const objective = this.controller.current?.objective;
				if (!this.controller.isPursuing || objective === undefined) {
					return {
						content: [{ type: "text", text: "No active goal can be reported." }],
						details: { status: params.status } satisfies GoalReportDetails,
						terminate: true,
					};
				}

				if (params.status === "achieved") {
					this.controller.achieve(params.evidence);
					this.persist();
					this.syncToolAvailability();
					this.updateStatus(ctx);
					this.emitReport({ status: "achieved", objective, evidence: params.evidence }, params.evidence);
					return {
						content: [{ type: "text", text: "Goal achieved. The evidence was reported to the user." }],
						details: { status: "achieved" } satisfies GoalReportDetails,
						terminate: true,
					};
				}

				this.controller.block(params.evidence);
				this.persist();
				this.syncToolAvailability();
				this.updateStatus(ctx);
				this.emitReport({ status: "blocked", objective, reason: params.evidence }, params.evidence);
				return {
					content: [{ type: "text", text: "Goal blocked and paused. The blocker was reported to the user." }],
					details: { status: "blocked" } satisfies GoalReportDetails,
					terminate: true,
				};
			},
			renderCall: (args, theme) => {
				const color = args.status === "achieved" ? "success" : "warning";
				return new Text(theme.fg("toolTitle", theme.bold("goal ")) + theme.fg(color, args.status), 0, 0);
			},
			renderResult: (result, _options, theme) => {
				const details = result.details as GoalReportDetails | undefined;
				if (details?.status === "achieved") return new Text(theme.fg("success", "✓ Goal achieved"), 0, 0);
				if (details?.status === "blocked") return new Text(theme.fg("warning", "◇ Goal blocked"), 0, 0);
				return new Text(theme.fg("dim", "No active goal"), 0, 0);
			},
		});
	}

	private registerGoalCommand(): void {
		this.pi.registerCommand("goal", {
			description: "Set or manage an autonomous session goal",
			getArgumentCompletions: (prefix) => {
				const options = ["check", "pause", "resume", "clear"]
					.filter((value) => value.startsWith(prefix.toLowerCase()))
					.map((value) => ({ value, label: value }));
				return options.length > 0 ? options : null;
			},
			handler: async (args, ctx) => this.handleCommand(args, ctx),
		});
	}

	private registerLifecycle(): void {
		this.pi.on("session_start", async (_event, ctx) => {
			this.stopStatusTimer();
			this.statusInitialized = false;
			this.lastStatusText = undefined;
			this.restore(ctx);
			this.syncToolAvailability();
			this.updateStatus(ctx);
		});

		this.pi.on("session_tree", async (_event, ctx) => {
			this.restore(ctx);
			this.syncToolAvailability();
			this.updateStatus(ctx);
		});

		this.pi.on("before_agent_start", async (event) => {
			const objective = this.controller.current?.objective;
			if (!this.controller.isPursuing || objective === undefined) return;
			return { systemPrompt: event.systemPrompt + promptForGoal(objective) };
		});

		this.pi.on("agent_start", async () => {
			this.currentRunIsContinuation = this.pendingContinuation;
			this.pendingContinuation = false;
			this.runHadToolCall = false;
		});

		this.pi.on("turn_start", async () => {
			this.turnWasPursuing = this.controller.isPursuing;
		});

		this.pi.on("tool_execution_start", async () => {
			this.runHadToolCall = true;
		});

		this.pi.on("turn_end", async (event, ctx) => {
			if (!this.turnWasPursuing) return;
			this.turnWasPursuing = false;
			this.controller.recordTurn(totalTokens(event.message));
			this.persist();
			this.updateStatus(ctx);
		});

		this.pi.on("message_end", async (event, ctx) => {
			const message = event.message as { role?: string; stopReason?: string };
			if (message.role !== "assistant" || message.stopReason !== "aborted") return;
			if (!this.controller.pause("Interrupted by the user.")) return;
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify("Goal paused after interruption. Use /goal resume to continue.", "warning");
		});

		this.pi.on("agent_settled", async (_event, ctx) => this.continueIfNeeded(ctx));

		this.pi.on("session_shutdown", async (_event, ctx) => {
			if (this.controller.current !== undefined) this.persist();
			this.stopStatusTimer();
			ctx.ui.setStatus(STATUS_KEY, undefined);
			this.statusInitialized = false;
			this.lastStatusText = undefined;
		});
	}

	private handleCommand(args: string, ctx: ExtensionCommandContext): void {
		const input = args.trim();
		const control = input.toLowerCase();

		if (input === "" || STATUS_ALIASES.has(control)) {
			this.showStatus(ctx);
			return;
		}

		if (CLEAR_ALIASES.has(control)) {
			if (!this.controller.clear()) {
				ctx.ui.notify("No goal is set.", "info");
				return;
			}
			this.pendingContinuation = false;
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify("Goal cleared.", "info");
			return;
		}

		if (control === "pause") {
			if (!this.controller.pause("Paused by the user.")) {
				ctx.ui.notify("No active goal to pause.", "warning");
				return;
			}
			this.pendingContinuation = false;
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify("Goal paused. Use /goal resume to continue.", "info");
			return;
		}

		const resumeMatch = input.match(/^resume(?:\s+([\s\S]*))?$/i);
		if (resumeMatch !== null) {
			if (!this.controller.resume()) {
				ctx.ui.notify("No paused, blocked, or budget-limited goal to resume.", "warning");
				return;
			}
			const prompt = resumeMatch[1]?.trim() || undefined;
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify(prompt === undefined ? "Goal resumed." : "Goal resumed with new direction.", "info");
			this.queueContinuation(prompt);
			return;
		}

		this.controller.start(input);
		this.pendingContinuation = false;
		this.persist();
		this.syncToolAvailability();
		this.updateStatus(ctx);
		this.pi.sendMessage(
			{
				customType: GOAL_MESSAGE_TYPE,
				content: `[GOAL STARTED]\n${input}`,
				display: true,
				details: { objective: input },
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	private continueIfNeeded(ctx: ExtensionContext): void {
		if (!this.controller.isPursuing) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		if (this.currentRunIsContinuation && !this.runHadToolCall) {
			this.controller.pause("Automatic continuation stopped because the last continuation made no tool call.");
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify(
				"Goal paused because the last continuation made no tool call. Use /goal resume after refining the goal.",
				"warning",
			);
			return;
		}

		const budgetReason = this.controller.budgetReason();
		if (budgetReason !== undefined) {
			this.controller.limitBudget(budgetReason);
			this.persist();
			this.syncToolAvailability();
			this.updateStatus(ctx);
			ctx.ui.notify(`Goal stopped: ${budgetReason}`, "warning");
			return;
		}

		this.controller.recordContinuation();
		this.persist();
		this.updateStatus(ctx);
		this.queueContinuation();
	}

	private queueContinuation(prompt?: string): void {
		const objective = this.controller.current?.objective;
		if (!this.controller.isPursuing || objective === undefined) return;
		this.pendingContinuation = true;
		this.pi.sendMessage(
			{
				customType: "goal-continuation",
				content: continuationMessage(objective, prompt),
				display: false,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}

	private persist(): void {
		this.pi.appendEntry(GOAL_ENTRY_TYPE, this.controller.serialize());
	}

	private restore(ctx: ExtensionContext): void {
		let restored: GoalState | null | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
			const parsed = parseGoalSnapshot(entry.data);
			if (parsed !== undefined) restored = parsed;
		}
		this.controller.restore(restored ?? null);
		this.pendingContinuation = false;
		this.currentRunIsContinuation = false;
		this.runHadToolCall = false;
	}

	private syncToolAvailability(): void {
		const activeTools = this.pi.getActiveTools();
		const hasGoalTool = activeTools.includes(GOAL_TOOL_NAME);
		if (this.controller.isPursuing && !hasGoalTool) {
			this.pi.setActiveTools([...activeTools, GOAL_TOOL_NAME]);
			return;
		}
		if (!this.controller.isPursuing && hasGoalTool) {
			this.pi.setActiveTools(activeTools.filter((name) => name !== GOAL_TOOL_NAME));
		}
	}

	private syncStatusTimer(ctx: ExtensionContext): void {
		if (!this.controller.isPursuing) {
			this.stopStatusTimer();
			return;
		}
		if (this.statusTimer !== undefined) return;

		const generation = ++this.sessionGeneration;
		this.statusTimer = setInterval(() => {
			if (generation !== this.sessionGeneration) return;
			this.updateStatus(ctx);
		}, STATUS_REFRESH_MS);
		this.statusTimer.unref();
	}

	private stopStatusTimer(): void {
		this.sessionGeneration += 1;
		if (this.statusTimer !== undefined) clearInterval(this.statusTimer);
		this.statusTimer = undefined;
	}

	private setStatus(ctx: ExtensionContext, text: string | undefined): void {
		if (this.statusInitialized && this.lastStatusText === text) return;
		this.statusInitialized = true;
		this.lastStatusText = text;
		ctx.ui.setStatus(STATUS_KEY, text);
	}

	private updateStatus(ctx: ExtensionContext): void {
		this.syncStatusTimer(ctx);
		const state = this.controller.current;
		if (state === undefined) {
			this.setStatus(ctx, undefined);
			return;
		}

		const metrics = `${formatDuration(this.controller.elapsedMs())} · ${state.turns}t · ${formatTokenCount(state.tokens)} tok`;
		if (state.status === "pursuing") {
			this.setStatus(ctx, ctx.ui.theme.fg("accent", `◎ goal ${metrics}`));
			return;
		}
		if (state.status === "achieved") {
			this.setStatus(ctx, ctx.ui.theme.fg("success", `✓ goal ${metrics}`));
			return;
		}
		this.setStatus(ctx, ctx.ui.theme.fg("warning", `◇ goal ${state.status} · ${metrics}`));
	}

	private showStatus(ctx: ExtensionContext): void {
		const state = this.controller.current;
		if (state === undefined) {
			ctx.ui.notify("No goal is set. Use /goal <completion condition>.", "info");
			return;
		}

		const lines = [
			`Goal: ${statusLabel(state)}`,
			`Objective: ${state.objective}`,
			`Elapsed: ${formatDuration(this.controller.elapsedMs())} · Turns: ${state.turns} · Tokens: ${formatTokenCount(state.tokens)}`,
		];
		if (state.evidence) lines.push(`Evidence: ${state.evidence}`);
		if (state.reason) lines.push(`Reason: ${state.reason}`);
		ctx.ui.notify(lines.join("\n"), state.status === "blocked" ? "warning" : "info");
	}
}

export default function goalExtension(pi: ExtensionAPI): void {
	new GoalExtension(pi).register();
}

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, parse } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	getAgentDir,
	parseFrontmatter,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const CONFIGURED_THINKING_LEVELS = [...THINKING_LEVELS, "auto"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];
type ConfiguredThinkingLevel = (typeof CONFIGURED_THINKING_LEVELS)[number];

type Subagent = {
	name: string;
	description: string | undefined;
	model: string | undefined;
	thinkingLevel: ConfiguredThinkingLevel | undefined;
	fast: boolean;
	systemPrompt: string;
	filePath: string;
};

type Discovery = {
	agents: Subagent[];
	diagnostics: string[];
};

type CommandResult = {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
};

type Dependencies = {
	agentsDir?: string;
	createTaskId?: () => string;
	resolveInvocation?: (args: string[]) => { command: string; args: string[] };
};

type BackgroundTask = {
	controller: AbortController;
	completion: Promise<void>;
};

type Frontmatter = {
	description?: unknown;
	model?: unknown;
	thinking_level?: unknown;
	fast?: unknown;
};

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

function isConfiguredThinkingLevel(value: unknown): value is ConfiguredThinkingLevel {
	return typeof value === "string" && CONFIGURED_THINKING_LEVELS.includes(value as ConfiguredThinkingLevel);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function discoverSubagents(agentsDir: string): Discovery {
	const agents: Subagent[] = [];
	const diagnostics: string[] = [];
	if (!existsSync(agentsDir)) return { agents, diagnostics };

	let entries;
	try {
		entries = readdirSync(agentsDir, { withFileTypes: true });
	} catch (error) {
		return {
			agents,
			diagnostics: [`Could not read ${agentsDir}: ${error instanceof Error ? error.message : String(error)}`],
		};
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || entry.name.startsWith(".")) continue;
		const filePath = join(agentsDir, entry.name);
		try {
			if (!entry.isFile() && !(entry.isSymbolicLink() && statSync(filePath).isFile())) continue;
			const { frontmatter, body } = parseFrontmatter<Frontmatter>(readFileSync(filePath, "utf8"));
			if (
				frontmatter.thinking_level !== undefined &&
				!isConfiguredThinkingLevel(frontmatter.thinking_level)
			) {
				throw new Error(`thinking_level must be one of: ${CONFIGURED_THINKING_LEVELS.join(", ")}`);
			}
			if (frontmatter.fast !== undefined && typeof frontmatter.fast !== "boolean") {
				throw new Error("fast must be true or false");
			}
			agents.push({
				name: parse(entry.name).name,
				description: nonEmptyString(frontmatter.description),
				model: nonEmptyString(frontmatter.model),
				thinkingLevel: frontmatter.thinking_level,
				fast: frontmatter.fast === true,
				systemPrompt: body,
				filePath,
			});
		} catch (error) {
			diagnostics.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	agents.sort((left, right) => left.name.localeCompare(right.name));
	return { agents, diagnostics };
}

function formatAvailableAgents(discovery: Discovery): string {
	if (discovery.agents.length === 0) return "none";
	return discovery.agents
		.map((agent) => {
			const settings = [
				agent.model ? `model: ${agent.model}` : undefined,
				agent.thinkingLevel ? `thinking_level: ${agent.thinkingLevel}` : undefined,
				agent.fast ? "fast: true" : undefined,
			].filter((value): value is string => value !== undefined);
			const description = agent.description ? `: ${agent.description}` : "";
			const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
			return `${agent.name}${description}${suffix}`;
		})
		.join("; ");
}

function resolveThinkingLevel(
	agent: Subagent,
	requested: ThinkingLevel | undefined,
	parent: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
	if (agent.thinkingLevel !== "auto") return agent.thinkingLevel ?? parent;
	if (requested) return requested;
	throw new Error(
		`Subagent "${agent.name}" uses thinking_level: auto. Choose thinking_level in the delegate call.`,
	);
}

function currentPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && !currentScript.startsWith("/$bunfs/root/") && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const executable = process.execPath.split(/[\\/]/).pop()?.toLowerCase();
	return executable && !/^(node|bun)(\.exe)?$/.test(executable)
		? { command: process.execPath, args }
		: { command: "pi", args };
}

function buildInvocationArgs(
	agent: Subagent,
	task: string,
	model: string | undefined,
	thinkingLevel: ThinkingLevel | undefined,
): string[] {
	const args = ["--print", "--no-session", "--exclude-tools", "delegate"];
	if (agent.fast) args.push("--fast");
	if (model) args.push("--model", model);
	if (thinkingLevel) args.push("--thinking", thinkingLevel);
	if (agent.systemPrompt) args.push("--append-system-prompt", agent.systemPrompt);
	args.push("--", task);
	return args;
}

function formatOutput(result: CommandResult): string {
	const raw = result.stdout.trim() || result.stderr.trim() || "(no output)";
	const truncated = truncateHead(raw, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	if (!truncated.truncated) return truncated.content;
	return `${truncated.content}\n\n[Output truncated to ${truncated.outputLines} lines and ${truncated.outputBytes} bytes.]`;
}

function failureMessage(agent: Subagent, result: CommandResult): string {
	const reason = result.killed ? "was stopped" : `failed with exit code ${result.code}`;
	return `Subagent "${agent.name}" ${reason}.\n\n${formatOutput(result)}`;
}

const DelegateParameters = Type.Object(
	{
		agent: Type.String({ minLength: 1, description: "Subagent name (the Markdown filename without .md)" }),
		task: Type.String({ minLength: 1, description: "The task to delegate" }),
		mode: StringEnum(["sync", "async"] as const, {
			description: "sync waits for the result; async returns now and reports the result as a follow-up message",
		}),
		thinking_level: Type.Optional(
			StringEnum(THINKING_LEVELS, {
				description: "Reasoning level to use when the selected subagent declares thinking_level: auto",
			}),
		),
	},
	{ additionalProperties: false },
);

export function createSubagentsExtension(dependencies: Dependencies = {}) {
	const agentsDir = dependencies.agentsDir ?? join(getAgentDir(), "agents");
	const createTaskId = dependencies.createTaskId ?? randomUUID;
	const resolveInvocation = dependencies.resolveInvocation ?? currentPiInvocation;

	return function subagentsExtension(pi: ExtensionAPI): void {
		const backgroundTasks = new Map<string, BackgroundTask>();
		let disposed = false;
		const initialDiscovery = discoverSubagents(agentsDir);
		const reportBackgroundResult = (
			taskId: string,
			agent: Subagent,
			succeeded: boolean,
			output: string,
			model: string | undefined,
			thinkingLevel: ThinkingLevel | undefined,
		): void => {
			if (disposed) return;
			try {
				pi.sendMessage(
					{
						customType: "subagent-result",
						content: `Background subagent ${taskId} (${agent.name}) ${succeeded ? "completed" : "failed"}.\n\n${output}`,
						display: true,
						details: { taskId, agent: agent.name, succeeded, model, thinkingLevel },
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch {
				// The session can become stale between completion and delivery.
			}
		};

		pi.registerTool({
			name: "delegate",
			label: "Delegate",
			description: [
				`Run a configured subagent from ${agentsDir}.`,
				`Available subagents: ${formatAvailableAgents(initialDiscovery)}.`,
				"Use mode=sync when you need the result before continuing.",
				"Use mode=async for independent work; its result arrives as a follow-up message.",
				"If a subagent has thinking_level: auto, choose thinking_level in this call.",
			].join(" "),
			promptSnippet: "Delegate a focused task to a configured subagent, either synchronously or in the background",
			promptGuidelines: [
				"Use delegate when a configured subagent can handle a focused task with an isolated context.",
				"Set delegate mode to sync when later work depends on the result; set it to async only for independent work.",
				"When a subagent declares thinking_level: auto, choose delegate thinking_level for the task.",
			],
			parameters: DelegateParameters,

			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				if (disposed) throw new Error("The subagents extension is shutting down");
				const discovery = discoverSubagents(agentsDir);
				const agent = discovery.agents.find((candidate) => candidate.name === params.agent);
				if (!agent) {
					const diagnostics = discovery.diagnostics.length
						? `\nInvalid definitions:\n- ${discovery.diagnostics.join("\n- ")}`
						: "";
					throw new Error(
						`Unknown subagent "${params.agent}". Available subagents: ${formatAvailableAgents(discovery)}.${diagnostics}`,
					);
				}

				const requestedThinking = isThinkingLevel(params.thinking_level) ? params.thinking_level : undefined;
				const parentThinking = isThinkingLevel(ctx.thinkingLevel) ? ctx.thinkingLevel : undefined;
				const thinkingLevel = resolveThinkingLevel(agent, requestedThinking, parentThinking);
				const model = agent.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
				const invocation = resolveInvocation(buildInvocationArgs(agent, params.task, model, thinkingLevel));

				if (params.mode === "sync") {
					const execOptions = signal ? { cwd: ctx.cwd, signal } : { cwd: ctx.cwd };
					const result = await pi.exec(invocation.command, invocation.args, execOptions);
					if (result.code !== 0 || result.killed) throw new Error(failureMessage(agent, result));
					return {
						content: [{ type: "text", text: formatOutput(result) }],
						details: { agent: agent.name, mode: "sync", model, thinkingLevel },
					};
				}

				const taskId = createTaskId();
				const controller = new AbortController();
				const completion = (async () => {
					try {
						const result = await pi.exec(invocation.command, invocation.args, {
							cwd: ctx.cwd,
							signal: controller.signal,
						});
						const succeeded = result.code === 0 && !result.killed;
						const output = succeeded ? formatOutput(result) : failureMessage(agent, result);
						reportBackgroundResult(taskId, agent, succeeded, output, model, thinkingLevel);
					} catch (error) {
						reportBackgroundResult(
							taskId,
							agent,
							false,
							error instanceof Error ? error.message : String(error),
							model,
							thinkingLevel,
						);
					} finally {
						backgroundTasks.delete(taskId);
					}
				})();
				backgroundTasks.set(taskId, { controller, completion });

				return {
					content: [
						{
							type: "text",
							text: `Started background subagent ${taskId} (${agent.name}). Its result will arrive as a follow-up message.`,
						},
					],
					details: { taskId, agent: agent.name, mode: "async", model, thinkingLevel },
				};
			},
		});

		pi.on("session_shutdown", async () => {
			disposed = true;
			const tasks = [...backgroundTasks.values()];
			for (const task of tasks) task.controller.abort();
			await Promise.allSettled(tasks.map((task) => task.completion));
			backgroundTasks.clear();
		});
	};
}

export const testing = { buildInvocationArgs, discoverSubagents, resolveThinkingLevel };

export default createSubagentsExtension();

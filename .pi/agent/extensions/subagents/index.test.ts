import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSubagentsExtension, testing } from "./index.ts";

type Tool = {
	name: string;
	description: string;
	promptGuidelines?: string[];
	execute: (...args: any[]) => Promise<any>;
};
type Handler = (...args: any[]) => Promise<unknown> | unknown;
type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean };
type ExecCall = { command: string; args: string[]; options: { cwd?: string; signal?: AbortSignal } };
type ExecBehavior = (call: ExecCall) => Promise<ExecResult>;

const tempPaths = new Set<string>();

afterEach(async () => {
	await Promise.all([...tempPaths].map((path) => rm(path, { recursive: true, force: true })));
	tempPaths.clear();
});

async function createAgentsDir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pi-subagents-test-"));
	tempPaths.add(root);
	const agentsDir = join(root, "agents");
	await mkdir(agentsDir);
	return agentsDir;
}

async function writeAgent(agentsDir: string, name: string, content: string): Promise<void> {
	await writeFile(join(agentsDir, `${name}.md`), content, "utf8");
}

function ok(stdout = "done"): ExecResult {
	return { stdout, stderr: "", code: 0, killed: false };
}

function harness(agentsDir: string, behavior: ExecBehavior = async () => ok()) {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Handler[]>();
	const calls: ExecCall[] = [];
	const messages: Array<{ message: any; options: any }> = [];
	const exec = mock(async (command: string, args: string[], options: ExecCall["options"]) => {
		const call = { command, args: [...args], options };
		calls.push(call);
		return behavior(call);
	});
	const pi = {
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		exec,
		sendMessage: (message: unknown, options: unknown) => messages.push({ message, options }),
	} as unknown as ExtensionAPI;
	createSubagentsExtension({
		agentsDir,
		createTaskId: () => "task-123",
		resolveInvocation: (args) => ({ command: "pi-test", args }),
	})(pi);

	const ctx = {
		cwd: "/work/project",
		model: { provider: "parent-provider", id: "parent-model" },
		thinkingLevel: "high",
	};

	async function run(params: unknown, signal = new AbortController().signal) {
		const tool = tools.get("delegate");
		if (!tool) throw new Error("delegate was not registered");
		return tool.execute("call-1", params, signal, undefined, ctx);
	}

	async function emit(event: string): Promise<void> {
		for (const handler of handlers.get(event) ?? []) await handler({}, ctx);
	}

	return { calls, emit, exec, messages, run, tools };
}

async function flushAsyncCompletion(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
	await Promise.resolve();
}

describe("subagent discovery", () => {
	test("loads model, thinking_level, description, and only the Markdown body", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(
			agentsDir,
			"reviewer",
			"---\ndescription: Review code\nmodel: openai/test-model\nthinking_level: auto\n---\n\nBody instructions.\n",
		);

		const discovery = testing.discoverSubagents(agentsDir);
		expect(discovery.diagnostics).toEqual([]);
		expect(discovery.agents).toEqual([
			{
				name: "reviewer",
				description: "Review code",
				model: "openai/test-model",
				thinkingLevel: "auto",
				fast: false,
				systemPrompt: "Body instructions.",
				filePath: join(agentsDir, "reviewer.md"),
			},
		]);
	});

	test("reports an invalid thinking_level without hiding valid agents", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "bad", "---\nthinking_level: enormous\n---\nBad");
		await writeAgent(agentsDir, "good", "---\nthinking_level: low\n---\nGood");

		const discovery = testing.discoverSubagents(agentsDir);
		expect(discovery.agents.map((agent) => agent.name)).toEqual(["good"]);
		expect(discovery.diagnostics[0]).toContain("thinking_level must be one of");
	});
});

describe("delegate tool", () => {
	test("uses frontmatter model, thinking level, and fast mode in sync mode", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(
			agentsDir,
			"reviewer",
			"---\ndescription: Review code\nmodel: openai/reviewer\nthinking_level: low\nfast: true\n---\nOnly review.\n",
		);
		const { calls, run, tools } = harness(agentsDir, async () => ok("review complete"));

		const result = await run({ agent: "reviewer", task: "Review src/a.ts", mode: "sync" });

		expect(result.content[0].text).toBe("review complete");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			command: "pi-test",
			options: { cwd: "/work/project" },
		});
		expect(calls[0].args).toEqual([
			"--print",
			"--no-session",
			"--exclude-tools",
			"delegate",
			"--fast",
			"--model",
			"openai/reviewer",
			"--thinking",
			"low",
			"--append-system-prompt",
			"Only review.",
			"--",
			"Review src/a.ts",
		]);
		expect(tools.get("delegate")?.description).toContain("reviewer: Review code");
		expect(tools.get("delegate")?.description).toContain("fast: true");
		expect(tools.get("delegate")?.promptGuidelines?.every((line) => line.includes("delegate"))).toBe(true);
	});

	test("inherits the parent model and thinking level when frontmatter omits them", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "general", "General instructions.");
		const { calls, run } = harness(agentsDir);

		await run({ agent: "general", task: "Inspect the project", mode: "sync" });

		expect(calls[0].args).toContain("parent-provider/parent-model");
		expect(calls[0].args).toContain("high");
	});

	test("requires the calling LLM to choose a level for thinking_level auto", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "general", "---\nthinking_level: auto\n---\nGeneral instructions.");
		const { calls, exec, run, tools } = harness(agentsDir);

		expect(tools.get("delegate")?.description).toContain("general [thinking_level: auto]");
		await expect(run({ agent: "general", task: "Inspect", mode: "sync" })).rejects.toThrow(
			"Choose thinking_level",
		);
		expect(exec).not.toHaveBeenCalled();

		await run({ agent: "general", task: "Inspect", mode: "sync", thinking_level: "xhigh" });
		expect(calls[0].args).toContain("xhigh");
	});

	test("returns immediately in async mode and delivers the result as a follow-up", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "general", "---\nthinking_level: auto\n---\nGeneral instructions.");
		let finish: ((result: ExecResult) => void) | undefined;
		const { messages, run } = harness(
			agentsDir,
			() => new Promise<ExecResult>((resolve) => (finish = resolve)),
		);

		const result = await run({
			agent: "general",
			task: "Research independently",
			mode: "async",
			thinking_level: "medium",
		});
		expect(result.content[0].text).toContain("Started background subagent task-123");
		expect(messages).toEqual([]);

		finish?.(ok("background result"));
		await flushAsyncCompletion();

		expect(messages).toHaveLength(1);
		expect(messages[0].message.content).toContain("task-123 (general) completed");
		expect(messages[0].message.content).toContain("background result");
		expect(messages[0].options).toEqual({ deliverAs: "followUp", triggerTurn: true });
	});

	test("aborts background commands and suppresses completion messages on shutdown", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "general", "General instructions.");
		let childSignal: AbortSignal | undefined;
		const { emit, messages, run } = harness(
			agentsDir,
			({ options }) =>
				new Promise<ExecResult>((resolve) => {
					childSignal = options.signal;
					options.signal?.addEventListener("abort", () =>
						resolve({ stdout: "", stderr: "", code: 1, killed: true }),
					);
				}),
		);

		await run({ agent: "general", task: "Long task", mode: "async" });
		await emit("session_shutdown");

		expect(childSignal?.aborted).toBe(true);
		expect(messages).toEqual([]);
	});

	test("rejects unknown agents before starting a command", async () => {
		const agentsDir = await createAgentsDir();
		await writeAgent(agentsDir, "general", "General instructions.");
		const { exec, run } = harness(agentsDir);

		await expect(run({ agent: "missing", task: "Do work", mode: "sync" })).rejects.toThrow(
			"Available subagents: general",
		);
		expect(exec).not.toHaveBeenCalled();
	});
});

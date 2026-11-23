import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { access, readFile, rm, stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTavilyExtension, testing } from "./index.ts";

type RegisteredTool = { name: string; promptSnippet?: string; promptGuidelines?: string[]; execute: (...args: any[]) => Promise<any> };
type SpawnCall = { command: string; args: readonly string[]; options: Record<string, unknown>; child: FakeChild };
type Behavior = (call: SpawnCall) => void;

class FakeChild extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	killed = false;
	killSignal: string | undefined;
	kill(signal?: string): boolean { this.killed = true; this.killSignal = signal; return true; }
}

const tempPaths = new Set<string>();
afterEach(async () => {
	await Promise.all([...tempPaths].map((path) => rm(path, { recursive: true, force: true })));
	tempPaths.clear();
});

function complete(child: FakeChild, stdout = '{"ok":true}', stderr = "", code = 0): void {
	queueMicrotask(() => { child.stdout.end(stdout); child.stderr.end(stderr); child.emit("close", code, null); });
}

function harness(behavior: Behavior = ({ child }) => complete(child)) {
	const tools = new Map<string, RegisteredTool>();
	const calls: SpawnCall[] = [];
	const spawnProcess = mock((command: string, args: readonly string[], options: Record<string, unknown>) => {
		const child = new FakeChild();
		const call = { command, args: [...args], options, child };
		calls.push(call); behavior(call); return child;
	});
	const pi = { registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool) } as unknown as ExtensionAPI;
	createTavilyExtension({ spawnProcess: spawnProcess as any })(pi);
	async function run(name: string, params: unknown, signal = new AbortController().signal) {
		const tool = tools.get(name); if (!tool) throw new Error(`Missing tool ${name}`);
		return tool.execute("call-1", params, signal, undefined, { cwd: "/work/project" });
	}
	return { calls, run, spawnProcess, tools };
}

function expectSpawnDefaults(call: SpawnCall, timeout: number): void {
	expect(call.command).toBe("tvly"); expect(call.options.cwd).toBe("/work/project");
	expect(call.options.env).toBe(process.env); expect(call.options.shell).toBe(false);
	expect(call.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
	void timeout;
}

describe("Tavily extension", () => {
	test("registers all tools with named prompt guidance", () => {
		const { tools } = harness();
		expect([...tools.keys()]).toEqual(["tavily_search", "tavily_extract", "tavily_map", "tavily_crawl", "tavily_research", "tavily_research_status", "tavily_research_poll"]);
		for (const [name, tool] of tools) {
			expect(tool.promptSnippet).toContain(name);
			expect(tool.promptGuidelines?.every((guideline) => guideline.includes(name))).toBe(true);
		}
	});

	test("constructs safe exact argv with options before positional separators", async () => {
		const { calls, run } = harness();
		await run("tavily_search", { query: "--output=/tmp/pwn", depth: "advanced", max_results: 20, topic: "finance", time_range: "week", start_date: "2026-01-01", end_date: "2026-01-07", include_domains: ["one.example", "two.example"], exclude_domains: ["blocked.example"], country: "united states", include_answer: "advanced", include_raw_content: "markdown", include_images: true, include_image_descriptions: true, chunks_per_source: 4 });
		await run("tavily_extract", { urls: ["https://a.example", "https://b.example"], query: "release details", chunks_per_source: 5, extract_depth: "advanced", format: "text", include_images: true, timeout: 60 });
		await run("tavily_map", { url: "https://docs.example", max_depth: 5, max_breadth: 12, limit: 90, instructions: "Find API pages", select_paths: ["/docs/.*", "/api/.*"], exclude_paths: ["/old/.*"], select_domains: ["docs.example", "api.example"], exclude_domains: ["old.example"], allow_external: false, timeout: 150 });
		await run("tavily_crawl", { url: "https://docs.example", max_depth: 3, instructions: "Collect current guides", allow_external: true, chunks_per_source: 3, extract_depth: "advanced", format: "markdown", include_images: true });
		expect(calls[0]?.args).toEqual(["search", "--depth", "advanced", "--max-results", "20", "--topic", "finance", "--time-range", "week", "--start-date", "2026-01-01", "--end-date", "2026-01-07", "--include-domains", "one.example,two.example", "--exclude-domains", "blocked.example", "--country", "united states", "--include-answer", "advanced", "--include-raw-content", "markdown", "--include-images", "--include-image-descriptions", "--chunks-per-source", "4", "--json", "--", "--output=/tmp/pwn"]);
		expect(calls[1]?.args).toEqual(["extract", "--query", "release details", "--chunks-per-source", "5", "--extract-depth", "advanced", "--format", "text", "--include-images", "--timeout", "60", "--json", "--", "https://a.example", "https://b.example"]);
		expect(calls[2]?.args).toEqual(["map", "--max-depth", "5", "--max-breadth", "12", "--limit", "90", "--instructions", "Find API pages", "--select-paths", "/docs/.*,/api/.*", "--exclude-paths", "/old/.*", "--select-domains", "docs.example,api.example", "--exclude-domains", "old.example", "--no-external", "--timeout", "150", "--json", "--", "https://docs.example"]);
		expect(calls[3]?.args).toEqual(["crawl", "--max-depth", "3", "--instructions", "Collect current guides", "--allow-external", "--chunks-per-source", "3", "--extract-depth", "advanced", "--format", "markdown", "--include-images", "--json", "--", "https://docs.example"]);
		for (const call of calls) expectSpawnDefaults(call, 0);
	});

	test("rejects invalid, credentialed, and option-like URLs before spawn", async () => {
		const { run, spawnProcess } = harness();
		for (const params of [
			["tavily_extract", { urls: ["--output=/tmp/pwn"] }],
			["tavily_extract", { urls: ["https://user:pass@example.com"] }],
			["tavily_map", { url: "file:///tmp/input" }],
			["tavily_crawl", { url: "/relative" }],
		] as const) await expect(run(params[0], params[1])).rejects.toThrow(/URL/);
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	test("validates request IDs against option injection before spawn", async () => {
		const { run, spawnProcess } = harness();
		await expect(run("tavily_research_status", { request_id: "--output=/tmp/pwn" })).rejects.toThrow();
		await expect(run("tavily_research_poll", { request_id: "id with spaces" })).rejects.toThrow();
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	test("writes bounded schema privately, passes its owned path, and cleans it", async () => {
		let observedPath = ""; let observedJson = ""; let directoryMode = 0; let fileMode = 0;
		const { calls, run } = harness(({ child, args }) => {
			const index = args.indexOf("--output-schema"); observedPath = String(args[index + 1]);
			void (async () => { observedJson = await readFile(observedPath, "utf8"); directoryMode = (await stat(observedPath.slice(0, observedPath.lastIndexOf("/")))).mode & 0o777; fileMode = (await stat(observedPath)).mode & 0o777; complete(child); })();
		});
		const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
		await run("tavily_research", { query: "--help", model: "pro", no_wait: true, output_schema: schema, citation_format: "apa", poll_interval: 2, timeout: 600 });
		expect(JSON.parse(observedJson)).toEqual(schema); expect(directoryMode).toBe(0o700); expect(fileMode).toBe(0o600);
		expect(calls[0]?.args).toEqual(["research", "run", "--model", "pro", "--no-wait", "--output-schema", observedPath, "--citation-format", "apa", "--poll-interval", "2", "--timeout", "600", "--json", "--", "--help"]);
		await expect(access(observedPath)).rejects.toThrow();
	});

	test("cleans schema after subprocess failure", async () => {
		let schemaPath = "";
		const { run } = harness(({ child, args }) => { schemaPath = String(args[args.indexOf("--output-schema") + 1]); complete(child, "", "bad", 2); });
		await expect(run("tavily_research", { query: "q", output_schema: { type: "object" } })).rejects.toThrow("exit code 2");
		await expect(access(schemaPath)).rejects.toThrow();
	});

	test("rejects malicious, deep, and oversized schemas before spawn", async () => {
		const { run, spawnProcess } = harness();
		const accessor: Record<string, unknown> = {}; Object.defineProperty(accessor, "type", { enumerable: true, get: () => "object" });
		let deep: any = { type: "object" }; for (let i = 0; i < testing.MAX_SCHEMA_DEPTH + 2; i++) deep = { nested: deep };
		await expect(run("tavily_research", { query: "q", output_schema: accessor })).rejects.toThrow(/accessor/);
		await expect(run("tavily_research", { query: "q", output_schema: deep })).rejects.toThrow(/depth/);
		await expect(run("tavily_research", { query: "q", output_schema: { description: "x".repeat(testing.MAX_SCHEMA_BYTES) } })).rejects.toThrow(/string|bytes/);
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	test("constructs status and poll argv allowed by tvly 0.1.4", async () => {
		const { calls, run } = harness();
		await run("tavily_research_status", { request_id: "req_123" });
		await run("tavily_research_poll", { request_id: "req_123", poll_interval: 3, timeout: 600 });
		expect(calls.map((call) => call.args)).toEqual([["research", "status", "req_123", "--json"], ["research", "poll", "req_123", "--poll-interval", "3", "--timeout", "600", "--json"]]);
	});

	test("rejects schema and cross-field failures before spawn", async () => {
		const { run, spawnProcess } = harness();
		await expect(run("tavily_search", { query: "q", max_results: 21 })).rejects.toThrow();
		await expect(run("tavily_extract", { urls: ["https://example.com"], chunks_per_source: 2 })).rejects.toThrow("requires query");
		await expect(run("tavily_crawl", { url: "https://example.com", chunks_per_source: 2 })).rejects.toThrow("requires instructions");
		await expect(run("tavily_research", { query: "q", output_schema: "/tmp/schema.json" })).rejects.toThrow();
		expect(spawnProcess).not.toHaveBeenCalled();
	});

	for (const stream of ["stdout", "stderr"] as const) {
		test(`kills and rejects when ${stream} exceeds its streaming limit`, async () => {
			const { calls, run } = harness(({ child }) => queueMicrotask(() => child[stream].write(Buffer.alloc(testing.MAX_STREAM_BYTES + 1))));
			await expect(run("tavily_search", { query: "q" })).rejects.toThrow(`${stream} exceeded`);
			expect(calls[0]?.child.killed).toBe(true); expect(calls[0]?.child.killSignal).toBe("SIGKILL");
		});
	}

	test("throws a useful sanitized diagnostic on nonzero exit", async () => {
		const { run } = harness(({ child }) => complete(child, "", "Authentication failed: TAVILY_API_KEY=super-secret-value\nnext", 7));
		const failure = run("tavily_search", { query: "q" });
		await expect(failure).rejects.toThrow("Tavily CLI search failed with exit code 7");
		await expect(failure).rejects.not.toThrow("super-secret-value");
	});

	test("enforces timeout and kills the process", async () => {
		const child = new FakeChild();
		await expect(testing.runProcess(() => child as any, [], undefined, "/work", 5)).rejects.toThrow("timed out");
		expect(child.killed).toBe(true);
	});

	test("honors AbortSignal and kills the process", async () => {
		const controller = new AbortController(); const { calls, run } = harness(() => {});
		const failure = run("tavily_search", { query: "q" }, controller.signal); controller.abort();
		await expect(failure).rejects.toMatchObject({ name: "AbortError" }); expect(calls[0]?.child.killed).toBe(true);
	});

	test("reports a missing executable", async () => {
		const { run } = harness(({ child }) => queueMicrotask(() => {
			child.emit("error", Object.assign(new Error("spawn tvly ENOENT"), { code: "ENOENT" }));
		}));
		await expect(run("tavily_search", { query: "q" })).rejects.toThrow("was not found in PATH");
	});

	test("rejects invalid successful JSON", async () => {
		const { run } = harness(({ child }) => complete(child, "not json"));
		await expect(run("tavily_search", { query: "q" })).rejects.toThrow("returned invalid JSON");
	});

	test("keeps final multiline response within Pi limits", async () => {
		const fullJson = JSON.stringify({ results: Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, index) => index) }, null, 2);
		const { run } = harness(({ child }) => complete(child, fullJson)); const result = await run("tavily_search", { query: "many lines" });
		const outputPath = result.details.full_output_path as string; tempPaths.add(outputPath.slice(0, outputPath.lastIndexOf("/")));
		expect(result.content[0].text.split("\n")).toHaveLength(DEFAULT_MAX_LINES); expect(Buffer.byteLength(result.content[0].text, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
	});

	test("keeps byte-bound response within limits and saves complete output privately", async () => {
		const fullJson = JSON.stringify({ results: Array.from({ length: DEFAULT_MAX_LINES - 500 }, () => "é".repeat(16)) }, null, 2);
		const { run } = harness(({ child }) => complete(child, fullJson)); const result = await run("tavily_search", { query: "many bytes" });
		const outputPath = result.details.full_output_path as string; const directory = outputPath.slice(0, outputPath.lastIndexOf("/")); tempPaths.add(directory);
		expect(Buffer.byteLength(result.content[0].text, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
		expect(await readFile(outputPath, "utf8")).toBe(fullJson); expect((await stat(directory)).mode & 0o777).toBe(0o700); expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
	});
});

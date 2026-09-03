import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { chmod, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const SEARCH_TIMEOUT_MS = 120_000;
const EXTRACT_TIMEOUT_MS = 120_000;
const MAP_TIMEOUT_MS = 180_000;
const CRAWL_TIMEOUT_MS = 300_000;
const RESEARCH_TIMEOUT_MS = 630_000;
const STATUS_TIMEOUT_MS = 60_000;
const MAX_STREAM_BYTES = 10 * 1024 * 1024;
const MAX_SCHEMA_BYTES = 256 * 1024;
const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_PROPERTIES = 500;
const MAX_SCHEMA_ARRAY_ITEMS = 500;
const MAX_SCHEMA_STRING_LENGTH = 16_384;

const strictObject = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });

const SearchParams = strictObject({
	query: Type.String({ minLength: 1, description: "Search query" }),
	depth: Type.Optional(StringEnum(["ultra-fast", "fast", "basic", "advanced"] as const)),
	max_results: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
	topic: Type.Optional(StringEnum(["general", "news", "finance"] as const)),
	time_range: Type.Optional(StringEnum(["day", "week", "month", "year"] as const)),
	start_date: Type.Optional(Type.String({ minLength: 1 })),
	end_date: Type.Optional(Type.String({ minLength: 1 })),
	include_domains: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	exclude_domains: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	country: Type.Optional(Type.String({ minLength: 1 })),
	include_answer: Type.Optional(StringEnum(["basic", "advanced"] as const)),
	include_raw_content: Type.Optional(StringEnum(["markdown", "text"] as const)),
	include_images: Type.Optional(Type.Boolean()),
	include_image_descriptions: Type.Optional(Type.Boolean()),
	chunks_per_source: Type.Optional(Type.Integer({ minimum: 1 })),
});

const ExtractParams = strictObject({
	urls: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }),
	query: Type.Optional(Type.String({ minLength: 1 })),
	chunks_per_source: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
	extract_depth: Type.Optional(StringEnum(["basic", "advanced"] as const)),
	format: Type.Optional(StringEnum(["markdown", "text"] as const)),
	include_images: Type.Optional(Type.Boolean()),
	timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
});

const mapProperties = {
	url: Type.String({ minLength: 1 }),
	max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
	max_breadth: Type.Optional(Type.Integer({ minimum: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1 })),
	instructions: Type.Optional(Type.String({ minLength: 1 })),
	select_paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	exclude_paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	select_domains: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	exclude_domains: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	allow_external: Type.Optional(Type.Boolean()),
	timeout: Type.Optional(Type.Number({ minimum: 10, maximum: 150 })),
};

const MapParams = strictObject(mapProperties);
const CrawlParams = strictObject({
	...mapProperties,
	chunks_per_source: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
	extract_depth: Type.Optional(StringEnum(["basic", "advanced"] as const)),
	format: Type.Optional(StringEnum(["markdown", "text"] as const)),
	include_images: Type.Optional(Type.Boolean()),
});

const JsonSchemaObject = Type.Record(Type.String({ minLength: 1, maxLength: 1_024 }), Type.Unknown(), {
	minProperties: 1,
	maxProperties: MAX_SCHEMA_PROPERTIES,
	description: "A bounded JSON-compatible schema object. Paths are not accepted.",
});

const ResearchParams = strictObject({
	query: Type.String({ minLength: 1 }),
	model: Type.Optional(StringEnum(["mini", "pro", "auto"] as const)),
	no_wait: Type.Optional(Type.Boolean()),
	output_schema: Type.Optional(JsonSchemaObject),
	citation_format: Type.Optional(StringEnum(["numbered", "mla", "apa", "chicago"] as const)),
	poll_interval: Type.Optional(Type.Integer({ minimum: 1 })),
	timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
});

const requestId = Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" });
const ResearchStatusParams = strictObject({ request_id: requestId });
const ResearchPollParams = strictObject({
	request_id: requestId,
	poll_interval: Type.Optional(Type.Integer({ minimum: 1 })),
	timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
});

type SearchInput = Static<typeof SearchParams>;
type ExtractInput = Static<typeof ExtractParams>;
type MapInput = Static<typeof MapParams>;
type CrawlInput = Static<typeof CrawlParams>;
type ResearchInput = Static<typeof ResearchParams>;
type ResearchStatusInput = Static<typeof ResearchStatusParams>;
type ResearchPollInput = Static<typeof ResearchPollParams>;

type ToolDetails = { command: string; full_output_path?: string; truncated?: boolean };
type SpawnedProcess = {
	stdout: Readable;
	stderr: Readable;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
	off(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
	off(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};
type SpawnProcess = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess;
type Dependencies = { spawnProcess?: SpawnProcess };

type ProcessResult = { stdout: string; stderr: string; code: number };

function validate<T extends TSchema>(schema: T, params: unknown): asserts params is Static<T> {
	Value.Assert(schema, params);
}

function option(args: string[], flag: string, value: unknown): void {
	if (value !== undefined) args.push(flag, String(value));
}

function listOption(args: string[], flag: string, values: readonly string[] | undefined): void {
	if (values !== undefined) args.push(flag, values.join(","));
}

function trueFlag(args: string[], flag: string, value: boolean | undefined): void {
	if (value === true) args.push(flag);
}

function appendMapOptions(args: string[], params: MapInput): void {
	option(args, "--max-depth", params.max_depth);
	option(args, "--max-breadth", params.max_breadth);
	option(args, "--limit", params.limit);
	option(args, "--instructions", params.instructions);
	listOption(args, "--select-paths", params.select_paths);
	listOption(args, "--exclude-paths", params.exclude_paths);
	listOption(args, "--select-domains", params.select_domains);
	listOption(args, "--exclude-domains", params.exclude_domains);
	if (params.allow_external === true) args.push("--allow-external");
	if (params.allow_external === false) args.push("--no-external");
	option(args, "--timeout", params.timeout);
}

function validateHttpUrl(value: string): void {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Tavily URL must be an absolute HTTP or HTTPS URL");
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
		throw new Error("Tavily URL must be an absolute HTTP or HTTPS URL");
	}
	if (url.username || url.password) throw new Error("Tavily URL must not contain credentials");
}

function serializeSchema(value: unknown): string {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("output_schema must be a JSON-compatible object");
	}
	let nodes = 0;
	let properties = 0;
	let arrayItems = 0;
	const visit = (candidate: unknown, depth: number): void => {
		if (depth > MAX_SCHEMA_DEPTH) throw new Error(`output_schema exceeds maximum depth ${MAX_SCHEMA_DEPTH}`);
		nodes += 1;
		if (nodes > MAX_SCHEMA_NODES) throw new Error(`output_schema exceeds maximum node count ${MAX_SCHEMA_NODES}`);
		if (candidate === null || typeof candidate === "boolean") return;
		if (typeof candidate === "number") {
			if (!Number.isFinite(candidate)) throw new Error("output_schema contains a non-finite number");
			return;
		}
		if (typeof candidate === "string") {
			if (candidate.length > MAX_SCHEMA_STRING_LENGTH) {
				throw new Error(`output_schema string exceeds ${MAX_SCHEMA_STRING_LENGTH} characters`);
			}
			return;
		}
		if (Array.isArray(candidate)) {
			arrayItems += candidate.length;
			if (arrayItems > MAX_SCHEMA_ARRAY_ITEMS) {
				throw new Error(`output_schema exceeds maximum array item count ${MAX_SCHEMA_ARRAY_ITEMS}`);
			}
			for (const item of candidate) visit(item, depth + 1);
			return;
		}
		if (typeof candidate !== "object" || Object.getPrototypeOf(candidate) !== Object.prototype) {
			throw new Error("output_schema contains a non-JSON value");
		}
		if (Object.getOwnPropertySymbols(candidate).length !== 0) {
			throw new Error("output_schema contains symbol properties");
		}
		const descriptors = Object.getOwnPropertyDescriptors(candidate);
		const keys = Object.keys(descriptors);
		properties += keys.length;
		if (properties > MAX_SCHEMA_PROPERTIES) {
			throw new Error(`output_schema exceeds maximum property count ${MAX_SCHEMA_PROPERTIES}`);
		}
		for (const key of keys) {
			if (key.length > 1_024) throw new Error("output_schema property name is too long");
			const descriptor = descriptors[key];
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw new Error("output_schema contains an accessor or non-enumerable property");
			}
			visit(descriptor.value, depth + 1);
		}
	};
	visit(value, 0);
	const serialized = JSON.stringify(value);
	if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES) {
		throw new Error(`output_schema exceeds ${MAX_SCHEMA_BYTES} serialized bytes`);
	}
	return serialized;
}

function sanitizeDiagnostic(value: string): string {
	return value
		.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
		.replace(/((?:"?(?:TAVILY_API_KEY|api[_ -]?key|access[_ -]?token|oauth[_ -]?token)"?)\s*[=:]\s*["']?)[^\s,;"']+/gi, "$1[REDACTED]")
		.replace(/([?&](?:api_key|token)=)[^&\s]+/gi, "$1[REDACTED]")
		.replace(/[\r\n]+/g, " ")
		.trim()
		.slice(0, 2_000);
}

function abortError(): DOMException {
	return new DOMException("The operation was aborted", "AbortError");
}

function runProcess(
	spawnProcess: SpawnProcess,
	args: string[],
	signal: AbortSignal | undefined,
	cwd: string,
	timeout: number,
): Promise<ProcessResult> {
	if (signal?.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		let child: SpawnedProcess;
		try {
			child = spawnProcess("tvly", args, {
				cwd,
				env: process.env,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			reject(error);
			return;
		}

		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const cleanup = (): void => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			child.stdout.off("data", onStdout);
			child.stderr.off("data", onStderr);
			child.off("error", onError);
			child.off("close", onClose);
		};
		const fail = (error: Error, kill = true): void => {
			if (settled) return;
			settled = true;
			if (kill) child.kill("SIGKILL");
			cleanup();
			reject(error);
		};
		const collect = (target: Buffer[], stream: "stdout" | "stderr", chunk: unknown): void => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
			if (stream === "stdout") stdoutBytes += buffer.length;
			else stderrBytes += buffer.length;
			if ((stream === "stdout" ? stdoutBytes : stderrBytes) > MAX_STREAM_BYTES) {
				fail(new Error(`Tavily CLI ${stream} exceeded the ${MAX_STREAM_BYTES}-byte collection limit`));
				return;
			}
			target.push(buffer);
		};
		const onStdout = (chunk: unknown): void => collect(stdout, "stdout", chunk);
		const onStderr = (chunk: unknown): void => collect(stderr, "stderr", chunk);
		const onAbort = (): void => fail(abortError());
		const onError = (error: Error & { code?: string }): void => fail(error, false);
		const onClose = (code: number | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
				code: code ?? 1,
			});
		};

		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);
		child.on("error", onError);
		child.on("close", onClose);
		timer = setTimeout(() => fail(new Error(`Tavily CLI timed out after ${timeout} ms`)), timeout);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

async function runTvly(
	spawnProcess: SpawnProcess,
	args: string[],
	signal: AbortSignal | undefined,
	cwd: string,
	timeout: number,
	command: string,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: ToolDetails }> {
	let result: ProcessResult;
	try {
		result = await runProcess(spawnProcess, args, signal, cwd, timeout);
	} catch (error) {
		if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
		const candidate = error as { code?: unknown; message?: unknown };
		if (candidate?.code === "ENOENT") throw new Error("Tavily CLI executable 'tvly' was not found in PATH");
		const diagnostic = sanitizeDiagnostic(error instanceof Error ? error.message : String(error));
		throw new Error(`Tavily CLI could not start${diagnostic ? `: ${diagnostic}` : ""}`);
	}
	if (result.code !== 0) {
		const diagnostic = sanitizeDiagnostic(result.stderr);
		throw new Error(`Tavily CLI ${command} failed with exit code ${result.code}${diagnostic ? `: ${diagnostic}` : ""}`);
	}
	const fullOutput = result.stdout.trim();
	try {
		JSON.parse(fullOutput);
	} catch {
		throw new Error(`Tavily CLI ${command} returned invalid JSON`);
	}

	const truncation = truncateHead(fullOutput, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	const details: ToolDetails = { command };
	let text = truncation.content;
	if (truncation.truncated) {
		const directory = await mkdtemp(join(tmpdir(), "pi-tavily-"));
		await chmod(directory, 0o700);
		const outputPath = join(directory, "output.json");
		await withFileMutationQueue(outputPath, async () => {
			await writeFile(outputPath, fullOutput, { encoding: "utf8", mode: 0o600, flag: "wx" });
		});
		details.full_output_path = outputPath;
		details.truncated = true;
		const notice = `[Output truncated: full JSON saved to: ${outputPath}]`;
		const visibleOutput = truncateHead(fullOutput, {
			maxLines: DEFAULT_MAX_LINES - 2,
			maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(`\n\n${notice}`, "utf8"),
		});
		text = `${visibleOutput.content}\n\n${notice}`;
	}
	return { content: [{ type: "text", text }], details };
}

export function createTavilyExtension(dependencies: Dependencies = {}): (pi: ExtensionAPI) => void {
	const spawnProcess = dependencies.spawnProcess ?? (nodeSpawn as unknown as SpawnProcess);
	return (pi: ExtensionAPI): void => {
		const register = (
			tool: Parameters<ExtensionAPI["registerTool"]>[0],
		): void => pi.registerTool(tool);

		register({
			name: "tavily_search", label: "Tavily Search",
			description: "Search the web with Tavily for discovery and current information. Returns JSON.",
			promptSnippet: "Use tavily_search to discover sources or find current information.",
			promptGuidelines: ["Use tavily_search for web discovery and current information."], parameters: SearchParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(SearchParams, params); const input: SearchInput = params;
				const args = ["search"];
				option(args, "--depth", input.depth); option(args, "--max-results", input.max_results);
				option(args, "--topic", input.topic); option(args, "--time-range", input.time_range);
				option(args, "--start-date", input.start_date); option(args, "--end-date", input.end_date);
				listOption(args, "--include-domains", input.include_domains); listOption(args, "--exclude-domains", input.exclude_domains);
				option(args, "--country", input.country); option(args, "--include-answer", input.include_answer);
				option(args, "--include-raw-content", input.include_raw_content); trueFlag(args, "--include-images", input.include_images);
				trueFlag(args, "--include-image-descriptions", input.include_image_descriptions); option(args, "--chunks-per-source", input.chunks_per_source);
				args.push("--json", "--", input.query);
				return runTvly(spawnProcess, args, signal, ctx.cwd, SEARCH_TIMEOUT_MS, "search");
			},
		});

		register({
			name: "tavily_extract", label: "Tavily Extract",
			description: "Extract focused content from one to twenty known URLs with Tavily. Returns JSON.",
			promptSnippet: "Use tavily_extract when the source URLs are already known.", promptGuidelines: ["Use tavily_extract for content from known URLs."], parameters: ExtractParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(ExtractParams, params); const input: ExtractInput = params;
				if (input.chunks_per_source !== undefined && input.query === undefined) throw new Error("tavily_extract requires query when chunks_per_source is set");
				for (const url of input.urls) validateHttpUrl(url);
				const args = ["extract"];
				option(args, "--query", input.query); option(args, "--chunks-per-source", input.chunks_per_source);
				option(args, "--extract-depth", input.extract_depth); option(args, "--format", input.format);
				trueFlag(args, "--include-images", input.include_images); option(args, "--timeout", input.timeout);
				args.push("--json", "--", ...input.urls);
				return runTvly(spawnProcess, args, signal, ctx.cwd, EXTRACT_TIMEOUT_MS, "extract");
			},
		});

		register({
			name: "tavily_map", label: "Tavily Map", description: "Discover URLs and site structure with Tavily without extracting page content. Returns JSON.",
			promptSnippet: "Use tavily_map to discover URLs on a site.", promptGuidelines: ["Use tavily_map for URL discovery and site structure."], parameters: MapParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(MapParams, params); const input: MapInput = params; validateHttpUrl(input.url);
				const args = ["map"]; appendMapOptions(args, input); args.push("--json", "--", input.url);
				return runTvly(spawnProcess, args, signal, ctx.cwd, MAP_TIMEOUT_MS, "map");
			},
		});

		register({
			name: "tavily_crawl", label: "Tavily Crawl", description: "Crawl and extract multi-page site content with Tavily. Returns JSON.",
			promptSnippet: "Use tavily_crawl to collect content from multiple related pages.", promptGuidelines: ["Use tavily_crawl for multi-page site content."], parameters: CrawlParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(CrawlParams, params); const input: CrawlInput = params; validateHttpUrl(input.url);
				if (input.chunks_per_source !== undefined && input.instructions === undefined) throw new Error("tavily_crawl requires instructions when chunks_per_source is set");
				const args = ["crawl"]; appendMapOptions(args, input); option(args, "--chunks-per-source", input.chunks_per_source);
				option(args, "--extract-depth", input.extract_depth); option(args, "--format", input.format); trueFlag(args, "--include-images", input.include_images);
				args.push("--json", "--", input.url);
				return runTvly(spawnProcess, args, signal, ctx.cwd, CRAWL_TIMEOUT_MS, "crawl");
			},
		});

		register({
			name: "tavily_research", label: "Tavily Research", description: "Start a comprehensive Tavily research synthesis. Returns a result or request JSON.",
			promptSnippet: "Use tavily_research for comprehensive, multi-source synthesis.", promptGuidelines: ["Use tavily_research for comprehensive synthesis; use tavily_research_status or tavily_research_poll for a pending request."], parameters: ResearchParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(ResearchParams, params); const input: ResearchInput = params;
				const serializedSchema = input.output_schema === undefined ? undefined : serializeSchema(input.output_schema);
				let schemaDirectory: string | undefined;
				try {
					const args = ["research", "run"];
					option(args, "--model", input.model); trueFlag(args, "--no-wait", input.no_wait);
					if (serializedSchema !== undefined) {
						schemaDirectory = await mkdtemp(join(tmpdir(), "pi-tavily-schema-")); await chmod(schemaDirectory, 0o700);
						const schemaPath = join(schemaDirectory, "schema.json");
						const handle = await open(schemaPath, "wx", 0o600);
						try { await handle.writeFile(serializedSchema, "utf8"); } finally { await handle.close(); }
						option(args, "--output-schema", schemaPath);
					}
					option(args, "--citation-format", input.citation_format); option(args, "--poll-interval", input.poll_interval); option(args, "--timeout", input.timeout);
					args.push("--json", "--", input.query);
					return await runTvly(spawnProcess, args, signal, ctx.cwd, RESEARCH_TIMEOUT_MS, "research run");
				} finally {
					if (schemaDirectory !== undefined) await rm(schemaDirectory, { recursive: true, force: true });
				}
			},
		});

		register({
			name: "tavily_research_status", label: "Tavily Research Status", description: "Check a Tavily research request without waiting for completion. Returns JSON.",
			promptSnippet: "Use tavily_research_status to check a pending Tavily research request once.", promptGuidelines: ["Use tavily_research_status for a one-time check of a tavily_research request ID."], parameters: ResearchStatusParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(ResearchStatusParams, params); const input: ResearchStatusInput = params;
				// tvly 0.1.4's ResearchGroup requires the request ID directly after status.
				return runTvly(spawnProcess, ["research", "status", input.request_id, "--json"], signal, ctx.cwd, STATUS_TIMEOUT_MS, "research status");
			},
		});

		register({
			name: "tavily_research_poll", label: "Tavily Research Poll", description: "Poll a Tavily research request until it completes or times out. Returns JSON.",
			promptSnippet: "Use tavily_research_poll to wait for a tavily_research request.", promptGuidelines: ["Use tavily_research_poll to wait for a tavily_research request ID."], parameters: ResearchPollParams,
			async execute(_id, params, signal, _onUpdate, ctx) {
				validate(ResearchPollParams, params); const input: ResearchPollInput = params;
				// The validated ID must precede options for tvly 0.1.4's custom group parser.
				const args = ["research", "poll", input.request_id]; option(args, "--poll-interval", input.poll_interval); option(args, "--timeout", input.timeout); args.push("--json");
				return runTvly(spawnProcess, args, signal, ctx.cwd, RESEARCH_TIMEOUT_MS, "research poll");
			},
		});
	};
}

export default createTavilyExtension();

export const testing = {
	MAX_STREAM_BYTES,
	MAX_SCHEMA_BYTES,
	MAX_SCHEMA_DEPTH,
	runProcess,
};

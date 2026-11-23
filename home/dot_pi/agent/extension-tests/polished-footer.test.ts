import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Terminal width semantics
//
// The real pi-tui helpers are ANSI-aware: escape sequences cost zero columns.
// The mock mirrors that so width assertions mean what they say.
// ---------------------------------------------------------------------------

const ANSI_SEQUENCE = /\u001b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_SEQUENCE, "");
}

function measure(text: string): number {
	return [...stripAnsi(text)].length;
}

function clip(text: string, width: number, ellipsis = ""): string {
	if (width <= 0) return "";
	if (measure(text) <= width) return text;
	const budget = Math.max(0, width - measure(ellipsis));
	const chars = [...text];
	let out = "";
	let used = 0;
	let styled = false;
	let index = 0;

	while (index < chars.length) {
		const char = chars[index]!;
		if (char === "\u001b") {
			let sequence = char;
			index += 1;
			if (chars[index] === "[") {
				sequence += "[";
				index += 1;
				while (index < chars.length && !/[@-~]/.test(chars[index]!)) {
					sequence += chars[index]!;
					index += 1;
				}
				if (index < chars.length) {
					sequence += chars[index]!;
					index += 1;
				}
			} else if (index < chars.length) {
				sequence += chars[index]!;
				index += 1;
			}
			out += sequence;
			styled = true;
			continue;
		}
		if (used >= budget) break;
		out += char;
		used += 1;
		index += 1;
	}

	return `${out}${ellipsis}${styled ? "\u001b[0m" : ""}`;
}

mock.module("@earendil-works/pi-tui", () => ({
	truncateToWidth: clip,
	visibleWidth: measure,
}));

const {
	default: polishedFooter,
	COMPACT_MIN_WIDTH,
	DEFAULT_AUTO_COMPACT,
	MAX_STATUS_OUTPUT,
	MAX_STATUS_STRIP_VISIBLE,
	MAX_STATUS_VISIBLE,
	PLAIN_PAINT,
	RICH_MIN_WIDTH,
	buildProviderQuotaLines,
	buildFooterLine,
	compactCwd,
	contextMeter,
	createOutputTpsTracker,
	createUsageSummaryCache,
	tokensForTpsWindow,
	formatContextTokens,
	formatCost,
	formatModelIdentity,
	formatPercent,
	formatTokens,
	formatTps,
	formatTtft,
	isBlankStatus,
	meterCells,
	normalizeCodexQuotas,
	percentTone,
	pickDensity,
	projectName,
	quotaTone,
	renderFooter,
	sanitizeIdentityText,
	sanitizeStatusText,
	selectStatuses,
	summarizeUsage,
} = await import("../extensions/polished-footer.ts");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

const HOME = "/Users/tester";

/** Widths used as the canonical wide / medium / narrow reference points. */
const WIDE = 240;
const NORMAL = 120;
const MEDIUM = 80;
const NARROW = 40;

/** Block-element glyphs the old bar used. The hairline must never emit them. */
const BLOCK_GLYPHS = /[\u2580-\u259F]/u;
/** Thin horizontal rules: the only visual signature this footer keeps. */
const HAIRLINE_GLYPHS = /[━─]/u;

function snapshot(overrides: Record<string, unknown> = {}) {
	return {
		provider: "openai-codex",
		modelId: "gpt-5.6-luna",
		reasoning: "high",
		subscription: false,
		cwd: `${HOME}/projects/herdr-statusbar`,
		branch: "main",
		sessionName: "footer-redesign",
		tokens: 84_800,
		contextWindow: 200_000,
		percent: 42.4,
		autoCompact: true,
		cost: 1.234,
		totals: { input: 140_000, output: 32_000, cacheRead: 83_000, cacheWrite: 2_000, cost: 1.234 },
		latestCacheHit: 46.2,
		statuses: [] as readonly string[],
		home: HOME,
		...overrides,
	} as Parameters<typeof renderFooter>[0];
}

// ---------------------------------------------------------------------------

describe("usage accounting", () => {
	test("summarizes assistant, tool, and compaction usage", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", usage: usage(100, 20, 80, 0, 0.1) } },
			{ type: "message", message: { role: "toolResult", usage: usage(10, 5, 0, 2, 0.02) } },
			{ type: "compaction", usage: usage(30, 7, 3, 0, 0.03) },
		] as SessionEntry[];

		const summary = summarizeUsage(entries);

		expect(summary.totals).toEqual({
			input: 140,
			output: 32,
			cacheRead: 83,
			cacheWrite: 2,
			cost: 0.15000000000000002,
		});
		expect(summary.latestCacheHit).toBe((80 / 180) * 100);
	});

	test("reuses totals until invalidated", () => {
		let reads = 0;
		const entries = [{ type: "message", message: { role: "assistant", usage: usage(10, 2) } }] as SessionEntry[];
		const cache = createUsageSummaryCache(() => {
			reads += 1;
			return entries;
		});

		expect(cache.get().totals.input).toBe(10);
		expect(cache.get().totals.input).toBe(10);
		expect(reads).toBe(1);

		cache.invalidate();
		expect(cache.get().totals.input).toBe(10);
		expect(reads).toBe(2);
	});
});

describe("generation telemetry", () => {
	function trackerWithClock(start = 0) {
		let now = start;
		const tracker = createOutputTpsTracker(() => now);
		return {
			tracker,
			advance(ms: number) {
				now += ms;
			},
		};
	}

	function noteText(tracker: ReturnType<typeof createOutputTpsTracker>, chars = 100) {
		tracker.noteDelta({ type: "text_delta", delta: "x".repeat(chars) });
	}

	test("measures TTFT from turn_start and TPS from active streaming only", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		advance(1_200);
		tracker.beginMessage();
		for (let index = 0; index < 6; index += 1) {
			if (index > 0) advance(100);
			noteText(tracker);
		}

		expect(
			tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 150 } }),
		).toBe(300);
		expect(tracker.latestTtftMs()).toBe(1_200);
	});

	test("starts only on non-empty content deltas", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		advance(800);
		tracker.beginMessage();
		tracker.noteDelta({ type: "start" });
		tracker.noteDelta({ type: "text_start" });
		tracker.noteDelta({ type: "text_delta", delta: "" });
		advance(400);
		for (let index = 0; index < 6; index += 1) {
			if (index > 0) advance(100);
			noteText(tracker);
		}
		tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 150 } });

		expect(tracker.latestTtftMs()).toBe(1_200);
	});

	test("accepts thinking and tool-call content as first output", () => {
		for (const type of ["thinking_delta", "toolcall_delta"] as const) {
			const { tracker, advance } = trackerWithClock();
			tracker.beginTurn();
			advance(250);
			tracker.beginMessage();
			tracker.noteDelta({ type, delta: "x".repeat(100) });
			for (let index = 1; index < 6; index += 1) {
				advance(100);
				noteText(tracker);
			}
			tracker.complete({ role: "assistant", stopReason: "toolUse", usage: { output: 150 } });
			expect(tracker.latestTtftMs()).toBe(250);
			expect(tracker.latest()).toBe(300);
		}
	});

	test("subtracts non-dominant inference stalls", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		tracker.beginMessage();
		noteText(tracker);
		for (let index = 1; index < 12; index += 1) {
			advance(index === 2 ? 600 : 100);
			noteText(tracker);
		}

		// 1600 ms stream - 600 ms stall = 1000 ms active generation.
		expect(tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 300 } })).toBe(300);
	});

	test("rejects buffered flushes, short spans, and stall-dominated streams", () => {
		const scenarios = [
			[0.5, 6],
			[20, 6],
			[600, 2],
		] as const;
		for (const [gap, count] of scenarios) {
			const { tracker, advance } = trackerWithClock();
			tracker.beginTurn();
			tracker.beginMessage();
			for (let index = 0; index < count; index += 1) {
				if (index > 0) advance(gap);
				noteText(tracker);
			}
			expect(tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 150 } })).toBeUndefined();
		}
	});

	test("rejects provider usage that does not belong to the streamed window", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		advance(500);
		tracker.beginMessage();
		for (let index = 0; index < 6; index += 1) {
			if (index > 0) advance(100);
			noteText(tracker);
		}

		expect(tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 9_488 } })).toBeUndefined();
		// TTFT remains independently valid even when TPS is unidentifiable.
		expect(tracker.latestTtftMs()).toBe(500);
	});

	test("clears stale TPS when a newer completed stream is unidentifiable", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		tracker.beginMessage();
		for (let index = 0; index < 6; index += 1) {
			if (index > 0) advance(100);
			noteText(tracker);
		}
		tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 150 } });
		expect(tracker.latest()).toBe(300);

		tracker.beginTurn();
		advance(400);
		tracker.beginMessage();
		noteText(tracker);
		advance(50);
		noteText(tracker);
		expect(tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 50 } })).toBeUndefined();
		expect(tracker.latest()).toBeUndefined();
		expect(tracker.latestTtftMs()).toBe(400);
	});

	test("does not replace valid metrics with errors, aborts, or unrelated messages", () => {
		const { tracker, advance } = trackerWithClock();
		tracker.beginTurn();
		advance(300);
		tracker.beginMessage();
		for (let index = 0; index < 6; index += 1) {
			if (index > 0) advance(100);
			noteText(tracker);
		}
		tracker.complete({ role: "assistant", stopReason: "stop", usage: { output: 150 } });

		for (const message of [
			{ role: "user", usage: { output: 20 } },
			{ role: "toolResult", usage: { output: 20 } },
			{ role: "assistant", stopReason: "error", usage: { output: 20 } },
			{ role: "assistant", stopReason: "aborted", usage: { output: 20 } },
		]) {
			tracker.beginTurn();
			tracker.beginMessage();
			noteText(tracker);
			advance(500);
			expect(tracker.complete(message)).toBe(300);
		}
		expect(tracker.latestTtftMs()).toBe(300);

		tracker.reset();
		expect(tracker.latest()).toBeUndefined();
		expect(tracker.latestTtftMs()).toBeUndefined();
	});
});

describe("tokens for a TPS window", () => {
	test("uses exact provider tokens only when they fit the stream", () => {
		expect(tokensForTpsWindow(40, 160)).toBe(40);
		expect(tokensForTpsWindow(80, 160)).toBe(80);
	});

	test("returns unknown instead of guessing from characters", () => {
		expect(tokensForTpsWindow(9_488, 160)).toBeUndefined();
		expect(tokensForTpsWindow(2, 160)).toBeUndefined();
		expect(tokensForTpsWindow(undefined, 160)).toBeUndefined();
		expect(tokensForTpsWindow(80, 0)).toBeUndefined();
	});
});

describe("model identity", () => {
	test("renders provider/model without ever duplicating the provider", () => {
		expect(formatModelIdentity("openai-codex", "gpt-5.6-luna")).toBe("openai-codex/gpt-5.6-luna");
		expect(formatModelIdentity("anthropic", "anthropic/claude-opus-5")).toBe("anthropic/claude-opus-5");
		expect(formatModelIdentity("anthropic", "claude-sonnet-4-5-20250929")).toBe(
			"anthropic/claude-sonnet-4-5-20250929",
		);
		expect(formatModelIdentity("cursor", "cursor")).toBe("cursor");
	});

	test("keeps the full provider and model; nothing is shortened away", () => {
		const identity = formatModelIdentity("some-very-long-provider", "an-extremely-long-model-name-that-never-ends");
		expect(identity).toBe("some-very-long-provider/an-extremely-long-model-name-that-never-ends");
		expect(identity).not.toContain("…");
	});

	test("degrades safely when provider or model is missing", () => {
		expect(formatModelIdentity(undefined, undefined)).toBe("no model");
		expect(formatModelIdentity("anthropic", undefined)).toBe("no model");
		expect(formatModelIdentity("anthropic", "  ")).toBe("no model");
		expect(formatModelIdentity(undefined, "gpt-5.6-luna")).toBe("gpt-5.6-luna");
		expect(formatModelIdentity("   ", "gpt-5.6-luna")).toBe("gpt-5.6-luna");
	});

	test("sanitizes both identity fields before they reach layout", () => {
		const identity = formatModelIdentity("\u001b]52;c;cGF5bG9hZA==\u0007openai-codex", "\u001b[31mgpt-5.6-luna\u001b[0m");

		expect(identity).toBe("openai-codex/gpt-5.6-luna");
		expect(identity).not.toContain("\u001b");
		expect(identity).not.toContain("cGF5bG9hZA");
	});
});

describe("value formatting", () => {
	test("compacts paths", () => {
		expect(compactCwd(`${HOME}/projects/app`, HOME)).toBe("~/projects/app");
		expect(compactCwd(HOME, HOME)).toBe("~");
		expect(compactCwd("/etc/nginx", HOME)).toBe("/etc/nginx");
		expect(projectName(`${HOME}/projects/herdr-statusbar`, HOME)).toBe("herdr-statusbar");
	});

	test("formats token counts across magnitudes", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(940)).toBe("940");
		expect(formatTokens(9_400)).toBe("9.4k");
		expect(formatTokens(84_800)).toBe("85k");
		expect(formatTokens(200_000)).toBe("200k");
		expect(formatTokens(1_240_000)).toBe("1.2M");
		expect(formatTokens(94_000_000)).toBe("94M");
		expect(formatTokens(null)).toBe("?");
	});

	test("formats percent, tone, cost, and context tokens", () => {
		expect(formatPercent(42.4)).toBe("42%");
		expect(formatPercent(null)).toBe("--%");
		expect(percentTone(10)).toBe("success");
		expect(percentTone(80)).toBe("warning");
		expect(percentTone(95)).toBe("error");
		expect(percentTone(null)).toBe("muted");
		expect(formatCost(0, false)).toBe("$0");
		expect(formatCost(1.234, false)).toBe("$1.23");
		expect(formatCost(12.34, false)).toBe("$12.3");
		expect(formatCost(9.99, true)).toBe("sub");
		expect(formatContextTokens(84_800, 200_000)).toBe("85k/200k");
		expect(formatContextTokens(null, 200_000)).toBe("?/200k");
		expect(formatTps(42.14)).toBe("42.1");
		expect(formatTps(42.16)).toBe("42.2");
		expect(formatTps(1)).toBe("1.0");
		expect(formatTps(0)).toBeUndefined();
		expect(formatTps(-3)).toBeUndefined();
		expect(formatTps(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(formatTps(Number.NaN)).toBeUndefined();
		expect(formatTps(undefined)).toBeUndefined();
		expect(formatTps(null)).toBeUndefined();
		expect(formatTtft(245.4)).toBe("245ms");
		expect(formatTtft(1_234)).toBe("1.23s");
		expect(formatTtft(-1)).toBeUndefined();
		expect(formatTtft(Number.NaN)).toBeUndefined();
	});

	test("reports auto-compaction from the default, never from disk", () => {
		expect(DEFAULT_AUTO_COMPACT).toBe(true);

		const source = readFileSync(new URL("../extensions/polished-footer.ts", import.meta.url), "utf8");
		expect(source).not.toContain("node:fs");
		expect(source).not.toContain("readFileSync");
		expect(source).not.toContain("settings.json");
	});
});

describe("context hairline", () => {
	test("is thin: only horizontal rules, never block elements", () => {
		for (const percent of [null, 0, 1, 42.4, 70, 99.9, 100]) {
			for (const cells of [4, 6, 10]) {
				const meter = contextMeter(percent, cells);
				const track = `${meter.filled}${meter.empty}`;
				expect(BLOCK_GLYPHS.test(track)).toBe(false);
				expect(/^[━─]*$/u.test(track)).toBe(true);
			}
		}
	});

	test("always occupies the requested cells and stays short", () => {
		for (const percent of [null, 0, 1, 42.4, 70, 99.9, 100, 140]) {
			for (const cells of [4, 6, 10]) {
				expect(measure(`${contextMeter(percent, cells).filled}${contextMeter(percent, cells).empty}`)).toBe(cells);
			}
		}
		expect(meterCells("rich")).toBe(10);
		expect(meterCells("compact")).toBe(6);
		expect(meterCells("minimal")).toBe(4);
		expect(meterCells("rich")).toBeLessThanOrEqual(12);
	});

	test("renders an untouched track when usage is unknown", () => {
		expect(contextMeter(null, 4)).toEqual({ filled: "", empty: "────" });
		expect(contextMeter(undefined, 6).filled).toBe("");
	});

	test("fills proportionally without rounding into a lie", () => {
		expect(contextMeter(100, 4)).toEqual({ filled: "━━━━", empty: "" });
		expect(contextMeter(50, 4)).toEqual({ filled: "━━", empty: "──" });
		expect(contextMeter(42.4, 10)).toEqual({ filled: "━━━━", empty: "──────" });
		// Non-zero usage always claims a cell; anything below full keeps one empty.
		expect(contextMeter(1, 10).filled).toBe("━");
		expect(contextMeter(99.9, 10).empty).toBe("─");
		expect(contextMeter(0, 4)).toEqual({ filled: "", empty: "────" });
	});

	test("clamps out-of-range percentages and degenerate cell counts", () => {
		expect(contextMeter(500, 4)).toEqual({ filled: "━━━━", empty: "" });
		expect(contextMeter(-20, 4)).toEqual({ filled: "", empty: "────" });
		expect(contextMeter(42, 0)).toEqual({ filled: "", empty: "" });
		expect(contextMeter(42, -3)).toEqual({ filled: "", empty: "" });
	});
});

describe("provider quota bars", () => {
	const quotas = [
		{
			provider: "codex",
			accounts: [
				{
					windows: [
						{ label: "5h", remainingPercent: 100 },
						{ label: "wk", remainingPercent: 99 },
					],
				},
			],
		},
	] as const;

	test("renders hairline quota bars directly below the provider/model row", () => {
		const lines = renderFooter(snapshot({ providerQuotas: quotas }), WIDE, PLAIN_PAINT);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("openai-codex/gpt-5.6-luna high");
		expect(lines[1]).toBe("OpenAI Codex · 5h ━━━━━━━━━━ 100% · wk ━━━━━━━━━─ 99%");
		expect(HAIRLINE_GLYPHS.test(lines[1]!)).toBe(true);
		expect(BLOCK_GLYPHS.test(lines[1]!)).toBe(false);
	});

	test("renders OpenAI Codex and Anthropic Claude with portable wordmarks", () => {
		const lines = buildProviderQuotaLines(
			[
				...quotas,
				{
					provider: "claude",
					accounts: [
						{
							windows: [
								{ label: "5h", remainingPercent: 90 },
								{ label: "wk", remainingPercent: 70 },
							],
						},
					],
				},
			],
			WIDE,
			PLAIN_PAINT,
		);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toStartWith("OpenAI Codex · 5h ");
		expect(lines[1]).toStartWith("Anthropic Claude · 5h ");
	});

	test("never receives or renders account email addresses", () => {
		const hostile = [
			{
				account: "private@example.com",
				windows: [
					{ label: "\u001b]52;c;cHJpdmF0ZUBleGFtcGxlLmNvbQ==\u00075h", remainingPercent: 80 },
				],
			},
		];
		const normalized = normalizeCodexQuotas(hostile);
		const line = buildProviderQuotaLines(
			[{ provider: "codex", accounts: hostile }],
			WIDE,
			PLAIN_PAINT,
		)[0]!;

		expect(normalized).toEqual([{ windows: [{ label: "5h", remainingPercent: 80 }] }]);
		expect(
			normalizeCodexQuotas([
				{ windows: [{ label: "private@example.com", remainingPercent: 80 }] },
			]),
		).toEqual([]);
		expect(JSON.stringify(normalized)).not.toContain("private@example.com");
		expect(line).not.toContain("private@example.com");
		expect(line).not.toContain("cHJpdmF0");
	});

	test("uses anonymous account numbers only when more than one provider account is active", () => {
		const lines = buildProviderQuotaLines(
			[
				{
					provider: "codex",
					accounts: [
						{ windows: [{ label: "5h", remainingPercent: 75 }] },
						{ windows: [{ label: "wk", remainingPercent: 50 }] },
					],
				},
			],
			WIDE,
			PLAIN_PAINT,
		);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toStartWith("OpenAI Codex 1 · 5h ");
		expect(lines[1]).toStartWith("OpenAI Codex 2 · wk ");
	});

	test("colors low remaining quota as pressure and stays within every terminal width", () => {
		expect(quotaTone(100)).toBe("success");
		expect(quotaTone(30)).toBe("warning");
		expect(quotaTone(10)).toBe("error");

		for (let width = 1; width <= 240; width += 1) {
			const lines = renderFooter(snapshot({ providerQuotas: quotas }), width, PLAIN_PAINT);
			expect(lines).toHaveLength(2);
			for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(width);
		}
	});

	test("wires shared quota events into the live footer and requests a render", () => {
		type Handler = (event: unknown, ctx: unknown) => unknown;
		const handlers = new Map<string, Handler>();
		const eventHandlers = new Map<string, (value: unknown) => void>();
		let footer: { render(width: number): string[] } | undefined;
		let renderRequests = 0;
		const pi = {
			on(event: string, handler: Handler) {
				handlers.set(event, handler);
			},
			events: {
				on(channel: string, handler: (value: unknown) => void) {
					eventHandlers.set(channel, handler);
					return () => eventHandlers.delete(channel);
				},
			},
			getThinkingLevel: () => "high",
		};
		polishedFooter(pi as unknown as ExtensionAPI);
		const ctx = {
			mode: "tui",
			model: {
				provider: "openai-codex",
				id: "gpt-5.6-luna",
				reasoning: true,
				contextWindow: 200_000,
			},
			modelRegistry: { isUsingOAuth: () => true },
			getContextUsage: () => ({ tokens: 10_000, contextWindow: 200_000, percent: 5 }),
			sessionManager: {
				getEntries: () => [],
				getCwd: () => "/tmp/project",
				getSessionName: () => undefined,
			},
			ui: {
				setFooter(factory: (tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) {
					footer = factory(
						{ requestRender: () => (renderRequests += 1) },
						{ fg: (_tone: string, text: string) => text, bold: (text: string) => text },
						{
							getGitBranch: () => null,
							getExtensionStatuses: () => new Map(),
							onBranchChange: () => () => {},
						},
					);
				},
			},
		};

		handlers.get("session_start")?.({}, ctx);
		expect(footer?.render(WIDE)).toHaveLength(1);
		eventHandlers.get("codexbar:quota")?.(quotas[0]);
		expect(renderRequests).toBe(1);
		const lines = footer?.render(WIDE) ?? [];
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("OpenAI Codex · 5h ━━━━━━━━━━ 100%");
	});
});

describe("extension status sanitation", () => {
	const TRUE_ANSI = "\u001b[38;2;49;116;143mConnected\u001b[0m";

	test("preserves true ANSI colour sequences intact", () => {
		const sanitized = sanitizeStatusText(TRUE_ANSI);

		expect(sanitized).toContain("\u001b[38;2;49;116;143m");
		expect(stripAnsi(sanitized)).toBe("Connected");
		expect(stripAnsi(sanitized)).not.toContain("[38;2");
		expect(sanitized).not.toContain("[38;2;49;116;143m\u001b");
	});

	test("never leaves a bare CSI payload behind (regression)", () => {
		const statuses = new Map([
			["herdr", "\u001b[38;2;49;116;143mConnected\u001b[39m"],
			["goal", "\u001b[38;2;196;167;231m\u001b[1mship\u001b[22m the footer\u001b[0m"],
		]);

		const selected = selectStatuses(statuses);
		const line = buildFooterLine(snapshot({ statuses: selected }), WIDE, PLAIN_PAINT);

		expect(selected).toHaveLength(2);
		expect(stripAnsi(line)).toContain("ship the footer · Connected");
		for (const text of [...selected, line]) {
			expect(stripAnsi(text)).not.toContain("[38;2");
			expect(stripAnsi(text)).not.toContain("[1m");
			expect(stripAnsi(text)).not.toContain("[0m");
		}
	});

	test("terminates styled statuses so colour does not bleed", () => {
		expect(sanitizeStatusText("\u001b[31mred")).toBe("\u001b[31mred\u001b[0m");
		expect(sanitizeStatusText("\u001b[31mred\u001b[0m")).toBe("\u001b[31mred\u001b[0m");
		expect(sanitizeStatusText("plain")).toBe("plain");
	});

	test("collapses line-breaking whitespace without touching styling", () => {
		const sanitized = sanitizeStatusText("  \u001b[32mline one\nline\ttwo\r  \u001b[0m ");

		expect(stripAnsi(sanitized)).toBe("line one line two");
		expect(sanitized.startsWith("\u001b[32m")).toBe(true);
	});

	test("removes non-colour escape sequences whole", () => {
		const sanitized = sanitizeStatusText("\u001b[2Jclear\u001b]0;title\u0007\u001b[38;5;9mred\u001b[0m");

		expect(stripAnsi(sanitized)).toBe("clearred");
		expect(sanitized).toContain("\u001b[38;5;9m");
		expect(sanitized).not.toContain("\u001b[2J");
		expect(sanitized).not.toContain("title");
	});

	test("drops non-colour escapes that reset or move the terminal", () => {
		expect(sanitizeStatusText("\u001bcreset")).toBe("reset");
		expect(sanitizeStatusText("\u001b7saved\u001b8")).toBe("saved");
		expect(sanitizeStatusText("\u001b=keypad\u001b>")).toBe("keypad");
		expect(sanitizeStatusText("\u001b[2J\u001b[H\u001b[3;5Hhome")).toBe("home");
		expect(sanitizeStatusText("\u001b(B\u001b)0charset")).toBe("charset");
		expect(sanitizeStatusText("\u001b#8fill")).toBe("fill");
	});

	test("drops lone, malformed, and unterminated escape sequences", () => {
		expect(sanitizeStatusText("\u001b")).toBe("");
		expect(sanitizeStatusText("plain\u001b")).toBe("plain");
		expect(sanitizeStatusText("\u001b\u001b\u001b")).toBe("");
		expect(sanitizeStatusText("plain\u001b\u001b")).toBe("plain");
		expect(sanitizeStatusText("ok\u001b[38;2;49")).toBe("ok");
		expect(sanitizeStatusText("ok\u001b]0;title")).toBe("ok");
		expect(sanitizeStatusText("ok\u001bPq;payload")).toBe("ok");
		expect(sanitizeStatusText("ok\u001b_apc-payload")).toBe("ok");
		// A parameter run longer than the allowlist bound is not a colour sequence.
		expect(sanitizeStatusText(`\u001b[${"1;".repeat(80)}mx`)).toBe("x");
	});

	test("drops OSC titles, clipboard writes, and hyperlinks without leaking payload", () => {
		const title = sanitizeStatusText("\u001b]0;pwned\u0007safe");
		const clipboard = sanitizeStatusText("\u001b]52;c;cGF5bG9hZA==\u0007safe");
		const hyperlink = sanitizeStatusText("\u001b]8;;https://evil.example\u0007label\u001b]8;;\u0007");
		const stTerminated = sanitizeStatusText("\u001b]0;pwned\u001b\\safe");

		expect(title).toBe("safe");
		expect(clipboard).toBe("safe");
		expect(hyperlink).toBe("label");
		expect(stTerminated).toBe("safe");
		for (const text of [title, clipboard, hyperlink, stTerminated]) {
			expect(text).not.toContain("pwned");
			expect(text).not.toContain("cGF5bG9hZA");
			expect(text).not.toContain("evil.example");
			expect(text).not.toContain("\u001b]");
		}
	});

	test("OSC terminates at BEL or ST; non-ST ESC stays inside the string (Warp)", () => {
		// ESC ]0;secret ESC [31m LEAK — CSI after OSC must not resume parsing.
		const oscLeak = sanitizeStatusText("\u001b]0;secret\u001b[31m LEAK");
		expect(oscLeak).toBe("");
		expect(oscLeak).not.toContain("LEAK");
		expect(oscLeak).not.toContain("secret");
		expect(stripAnsi(oscLeak)).not.toContain("LEAK");
	});

	test("DCS/SOS/PM/APC terminate only at ST; BEL does not end them (Warp)", () => {
		// ESC P secret BEL LEAK ESC \ safe — BEL is payload; ST resumes; LEAK stays dropped.
		const dcs = sanitizeStatusText("\u001bP secret\u0007 LEAK\u001b\\ safe");
		expect(dcs).toBe("safe");
		expect(dcs).not.toContain("LEAK");
		expect(dcs).not.toContain("secret");

		expect(sanitizeStatusText("\u001bX sos\u0007 LEAK\u001b\\ok")).toBe("ok");
		expect(sanitizeStatusText("\u001b^ pm\u0007 LEAK\u001b\\ok")).toBe("ok");
		expect(sanitizeStatusText("\u001b_ apc\u0007 LEAK\u001b\\ok")).toBe("ok");
		expect(sanitizeStatusText("a\u0090dcs\u0007 LEAK\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u0098sos\u0007 LEAK\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u009epm\u0007 LEAK\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u009fapc\u0007 LEAK\u009cb")).toBe("ab");
	});

	test("drops 8-bit C1 controls and their string payloads", () => {
		expect(sanitizeStatusText("a\u009b31mb")).toBe("ab");
		expect(sanitizeStatusText("a\u009d0;pwned\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u00901;2q payload\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u009fapc-payload\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u009epm-payload\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u0098sos-payload\u009cb")).toBe("ab");
		expect(sanitizeStatusText("a\u0084b")).toBe("ab");
		expect(sanitizeStatusText("a\u009d0;unterminated")).toBe("a");
		// NEL is a line break, so it collapses like other breaking whitespace.
		expect(sanitizeStatusText("a\u0085b")).toBe("a b");
		expect(sanitizeStatusText("a\u2028b\u2029c")).toBe("a b c");
	});

	test("bounds hostile input and output without quadratic work", () => {
		const started = Date.now();
		const repeatedStyle = sanitizeStatusText("\u001b[31m ".repeat(20_000));
		const oversized = sanitizeStatusText("a".repeat(200_000));
		const oversizedStyled = sanitizeStatusText(`\u001b[31m${"b".repeat(200_000)}`);
		const manySequences = sanitizeStatusText("\u001b[31mx".repeat(20_000));
		const elapsed = Date.now() - started;

		// Styling with no visible characters yields nothing at all.
		expect(repeatedStyle).toBe("");
		expect(measure(oversized)).toBe(MAX_STATUS_VISIBLE);
		expect(measure(oversizedStyled)).toBe(MAX_STATUS_VISIBLE);
		for (const text of [oversized, oversizedStyled, manySequences]) {
			expect(text.length).toBeLessThanOrEqual(MAX_STATUS_OUTPUT);
			expect(measure(text)).toBeLessThanOrEqual(MAX_STATUS_VISIBLE);
		}
		expect(elapsed).toBeLessThan(500);
	});

	test("leaves no escape other than complete SGR, and never bleeds colour", () => {
		const hostile = [
			"\u001bc\u001b7\u001b8\u001b=\u001b>",
			"\u001b[2J\u001b[1;1H\u001b]0;t\u0007\u001b]52;c;AA==\u0007",
			"\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007",
			"\u009b31m\u009d0;t\u009c\u0090q\u009c\u009fx\u009c",
			"\u001b[38;2;49;116;143mstyled",
			"mixed\u001b[31mtext\u001b[2Kmore",
			"\u001b[",
			"\u001b]",
			`\u001b[31m${"c".repeat(5_000)}`,
		];

		for (const input of hostile) {
			const sanitized = sanitizeStatusText(input);
			// Every surviving ESC introduces a complete SGR sequence.
			for (const [index, char] of [...sanitized].entries()) {
				if (char !== "\u001b") continue;
				expect(/^\u001b\[[0-9;:]*m/.test(sanitized.slice(index))).toBe(true);
			}
			expect(stripAnsi(sanitized)).not.toContain("\u001b");
			expect(stripAnsi(sanitized)).not.toMatch(/\[[0-9;:]*m/);
			expect(sanitized.includes("\u001b") ? sanitized.endsWith("\u001b[0m") : true).toBe(true);
		}
	});

	test("filters footer-owned context-tokens, retains Weave keys, sorts, and drops blanks", () => {
		const statuses = new Map([
			["zeta", "z-status"],
			["context-tokens", "should not appear"],
			["weave", "ready"],
			["weave-agent", "\u001b[38;2;196;167;231m\u001b[1m\u25c6 WEAVE\u001b[22m \u00b7 LOOM\u001b[0m"],
			["weave-task", "task 3/7"],
			["alpha", "a-status"],
			["blank", "  \n\t "],
			["styled-blank", "\u001b[31m \u001b[0m"],
		]);

		const selected = selectStatuses(statuses);
		expect(selected).toEqual([
			"a-status",
			"ready",
			"\u001b[38;2;196;167;231m\u001b[1m\u25c6 WEAVE\u001b[22m \u00b7 LOOM\u001b[0m",
			"task 3/7",
			"z-status",
		]);
		expect(selected.every((text) => !text.includes("should not appear"))).toBe(true);
		expect(selectStatuses(new Map())).toEqual([]);
		expect(isBlankStatus("\u001b[31m\u001b[0m")).toBe(true);
		expect(isBlankStatus("\u001b[31mx\u001b[0m")).toBe(false);
	});

	test("bounds status scanning, retained count, and aggregate input", () => {
		let yielded = 0;
		const blankStatuses = {
			*[Symbol.iterator](): IterableIterator<[string, string]> {
				for (let index = 0; index < 32; index += 1) {
					yielded += 1;
					yield [`blank-${index}`, " "];
				}
				throw new Error("selectStatuses scanned beyond its bound");
			},
		} as unknown as ReadonlyMap<string, string>;
		expect(selectStatuses(blankStatuses)).toEqual([]);
		expect(yielded).toBe(32);

		const manyStatuses = new Map<string, string>();
		for (let index = 0; index < 10_000; index += 1) {
			manyStatuses.set(`status-${String(index).padStart(5, "0")}`, `value-${index}`);
		}
		const selected = selectStatuses(manyStatuses);
		expect(selected).toHaveLength(8);
		expect(selected).toEqual([
			"value-0",
			"value-1",
			"value-2",
			"value-3",
			"value-4",
			"value-5",
			"value-6",
			"value-7",
		]);

		const aggregateBound = new Map([
			["blank", " ".repeat(10_000)],
			["after-limit", "must-not-be-read"],
		]);
		expect(selectStatuses(aggregateBound)).toEqual([]);
	});

	test("retains and sanitizes weave, weave-agent, and weave-task", () => {
		const weave = selectStatuses(
			new Map([
				["weave", "\u001b]0;pwned\u0007ready"],
				["weave-agent", "\u001b[38;2;196;167;231m\u001b[1m\u25c6 WEAVE\u001b[22m \u00b7 LOOM\u001b[0m\u001b[2J"],
				["weave-task", "task 3/7\u001b]52;c;cGF5bG9hZA==\u0007"],
			]),
		);

		expect(weave).toEqual([
			"ready",
			"\u001b[38;2;196;167;231m\u001b[1m\u25c6 WEAVE\u001b[22m \u00b7 LOOM\u001b[0m",
			"task 3/7",
		]);
		expect(weave.join("")).not.toContain("pwned");
		expect(weave.join("")).not.toContain("cGF5bG9hZA");
		expect(weave.join("")).not.toContain("\u001b[2J");
		expect(stripAnsi(weave[1]!)).toBe("\u25c6 WEAVE \u00b7 LOOM");
	});

	test("Weave-only statuses render readiness and the agent badge without ANSI leakage", () => {
		const selected = selectStatuses(
			new Map([
				["weave", "ready"],
				["weave-agent", "\u001b[38;2;196;167;231m\u001b[1m\u25c6 WEAVE\u001b[22m \u00b7 LOOM\u001b[0m"],
				["weave-task", "task 3/7"],
			]),
		);
		const line = buildFooterLine(snapshot({ statuses: selected }), WIDE, PLAIN_PAINT);
		const visible = stripAnsi(line);

		expect(selected).toHaveLength(3);
		expect(visible).toContain("ready");
		expect(visible).toContain("\u25c6 WEAVE \u00b7 LOOM");
		expect(visible).toContain("task 3/7");
		expect(visible).not.toContain("[38;2");
		expect(visible).not.toContain("[1m");
		expect(visible).not.toContain("[0m");
		expect(visible).not.toContain("\u001b");
		expect(measure(line)).toBeLessThanOrEqual(WIDE);
	});
});

describe("density selection", () => {
	test("maps widths to layouts", () => {
		expect(pickDensity(RICH_MIN_WIDTH)).toBe("rich");
		expect(pickDensity(160)).toBe("rich");
		expect(pickDensity(RICH_MIN_WIDTH - 1)).toBe("compact");
		expect(pickDensity(COMPACT_MIN_WIDTH)).toBe("compact");
		expect(pickDensity(COMPACT_MIN_WIDTH - 1)).toBe("minimal");
		expect(pickDensity(20)).toBe("minimal");
	});
});

describe("identity text sanitation", () => {
	test("strips all escapes including SGR; collapses whitespace; preserves Unicode", () => {
		expect(sanitizeIdentityText("\u001b[31mred\u001b[0m")).toBe("red");
		expect(sanitizeIdentityText("café ◆ 日本語")).toBe("café ◆ 日本語");
		expect(sanitizeIdentityText("  line\none\ttwo\r  ")).toBe("line one two");
		expect(sanitizeIdentityText("\u001b")).toBe("");
		expect(sanitizeIdentityText("plain\u001b")).toBe("plain");
		expect(sanitizeIdentityText("ok\u001b[38;2;49")).toBe("ok");
	});

	test("drops OSC clipboard/title, DCS, C1, and malformed controls without leaking payload", () => {
		expect(sanitizeIdentityText("\u001b]0;pwned\u0007safe")).toBe("safe");
		expect(sanitizeIdentityText("\u001b]52;c;cGF5bG9hZA==\u0007safe")).toBe("safe");
		expect(sanitizeIdentityText("\u001b]0;pwned\u001b\\safe")).toBe("safe");
		expect(sanitizeIdentityText("\u001bP secret\u0007 LEAK\u001b\\ safe")).toBe("safe");
		expect(sanitizeIdentityText("a\u009d0;pwned\u009cb")).toBe("ab");
		expect(sanitizeIdentityText("a\u00901;2q payload\u009cb")).toBe("ab");
		expect(sanitizeIdentityText("a\u0084b")).toBe("ab");
		expect(sanitizeIdentityText("ok\u001b]0;title")).toBe("ok");
		expect(sanitizeIdentityText("ok\u001bPq;payload")).toBe("ok");

		for (const text of [
			sanitizeIdentityText("\u001b]52;c;cGF5bG9hZA==\u0007safe"),
			sanitizeIdentityText("\u001bP secret\u0007 LEAK\u001b\\ safe"),
			sanitizeIdentityText("a\u009d0;pwned\u009cb"),
		]) {
			expect(text).not.toContain("pwned");
			expect(text).not.toContain("cGF5bG9hZA");
			expect(text).not.toContain("LEAK");
			expect(text).not.toContain("secret");
			expect(text).not.toContain("\u001b");
		}
	});

	test("sanitizes hostile provider, modelId, cwd, branch, and sessionName before width measurement", () => {
		const osc52 = "\u001b]52;c;cGF5bG9hZA==\u0007";
		const dcs = "\u001bPsecret\u0007LEAK\u001b\\";
		const c1 = "\u009d0;title\u009c";

		const line = buildFooterLine(
			snapshot({
				provider: `${osc52}openai-codex`,
				modelId: `${dcs}gpt-5.6-luna`,
				reasoning: `${dcs}high`,
				cwd: `${osc52}${HOME}/projects/herdr-statusbar`,
				branch: `${c1}main\ninject`,
				sessionName: `${osc52}evil\nname`,
			}),
			WIDE,
			PLAIN_PAINT,
		);

		expect(measure(line)).toBe(WIDE);
		expect(line).toContain("openai-codex/gpt-5.6-luna high");
		expect(line).toContain("~/projects/herdr-statusbar");
		expect(line).toContain("git main inject");
		expect(line).not.toContain("evil name");
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("cGF5bG9hZA");
		expect(line).not.toContain("LEAK");
		expect(line).not.toContain("secret");
		expect(line).not.toContain("title");
		expect(line).not.toContain("\n");
	});

	test("Warp direct cwd/session OSC 52 never reaches the terminal", () => {
		const warpCwd = `\u001b]52;c;${Buffer.from("/etc/passwd").toString("base64")}\u0007${HOME}/projects/herdr-statusbar`;
		const warpSession = `\u001b]52;c;${Buffer.from("token=secret").toString("base64")}\u0007footer-redesign`;

		const line = buildFooterLine(
			snapshot({ cwd: warpCwd, sessionName: warpSession, branch: "\u001b]0;pwned\u0007main" }),
			WIDE,
			PLAIN_PAINT,
		);

		expect(measure(line)).toBeLessThanOrEqual(WIDE);
		expect(line).toContain("~/projects/herdr-statusbar");
		expect(line).not.toContain("session footer-redesign");
		expect(line).toContain("git main");
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("]52;");
		expect(line).not.toContain("passwd");
		expect(line).not.toContain("token=secret");
		expect(line).not.toContain(Buffer.from("token=secret").toString("base64"));
		expect(line).not.toContain(Buffer.from("/etc/passwd").toString("base64"));
		expect(line).not.toContain("pwned");
	});

	test("newline injection and lone controls cannot break the ribbon", () => {
		const line = buildFooterLine(
			snapshot({
				provider: "vendor\r",
				modelId: "good\rmodel\u001b",
				cwd: `${HOME}/projects/herdr\nstatusbar`,
				branch: "feat/\u001b[2Jevil",
				sessionName: "sess\u001b]0;x\u0007ion",
			}),
			NORMAL,
			PLAIN_PAINT,
		);

		expect(measure(line)).toBeLessThanOrEqual(NORMAL);
		expect(line).not.toContain("\n");
		expect(line).not.toContain("\r");
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("[2J");
		expect(line).toContain("vendor/good model");
	});

	test("hostile identity and status fields stay within visible width across a sweep", () => {
		const hostile = snapshot({
			provider: `\u001b]0;t\u0007${"v".repeat(200)}`,
			modelId: `\u001b]52;c;AA==\u0007${"m".repeat(400)}`,
			reasoning: `\u001b[31m${"r".repeat(400)}`,
			cwd: `\u001b]0;t\u0007${HOME}/${"p".repeat(400)}`,
			branch: `\u0090dcs\u009c${"b".repeat(400)}`,
			sessionName: `\u001bPpayload\u001b\\${"s".repeat(400)}`,
			statuses: [sanitizeStatusText(`\u001b[31m${"x".repeat(400)}`), sanitizeStatusText("y".repeat(400))],
		});

		for (let width = 1; width <= 240; width += 1) {
			const lines = renderFooter(hostile, width, PLAIN_PAINT);
			expect(lines).toHaveLength(1);
			const line = lines[0]!;
			expect(measure(line)).toBeLessThanOrEqual(width);
			expect(stripAnsi(line)).not.toContain("\u001b");
			expect(line.includes("\u001b") ? line.endsWith("\u001b[0m") : true).toBe(true);
		}
	});
});

describe("the footer line", () => {
	test("wide terminals render usage left and Honcho, Git, directory right", () => {
		const line = buildFooterLine(snapshot({ statuses: ["🧠 Connected"] }), WIDE, PLAIN_PAINT);

		expect(measure(line)).toBe(WIDE);
		const modelAt = line.indexOf("openai-codex/gpt-5.6-luna high");
		const contextAt = line.indexOf("━━━━──────");
		const inputAt = line.indexOf("in 140k");
		const cacheAt = line.indexOf("cache rd 83k");
		const honchoAt = line.indexOf("🧠 Connected");
		const gitAt = line.indexOf("git main");
		const directoryAt = line.indexOf("~/projects/herdr-statusbar");
		expect(modelAt).toBeGreaterThanOrEqual(0);
		expect(modelAt).toBeLessThan(contextAt);
		expect(contextAt).toBeLessThan(inputAt);
		expect(inputAt).toBeLessThan(cacheAt);
		expect(cacheAt).toBeLessThan(honchoAt);
		expect(honchoAt).toBeLessThan(gitAt);
		expect(gitAt).toBeLessThan(directoryAt);
		expect(line.trimEnd()).toEndWith("~/projects/herdr-statusbar");
		expect(line).toContain("42%");
		expect(line).toContain("85k/200k");
		expect(line).toContain("out 32k");
		expect(line).toContain("hit 46%");
		expect(line).not.toContain("session ");
		expect(line).not.toContain("compact ");
		expect(line).not.toContain("cache wr");
		expect(line).not.toContain("$1.23");
		expect(HAIRLINE_GLYPHS.test(line)).toBe(true);
		expect(BLOCK_GLYPHS.test(line)).toBe(false);
	});

	test("normal widths prioritize identity and requested usage traffic", () => {
		const line = buildFooterLine(snapshot({ statuses: ["🧠 Connected"] }), NORMAL, PLAIN_PAINT);

		expect(measure(line)).toBeLessThanOrEqual(NORMAL);
		expect(line).toContain("openai-codex/gpt-5.6-luna high ·");
		expect(line).toContain("🧠 Connected");
		expect(line).toContain("42%");
		expect(line).toContain("85k/200k");
		expect(line).toContain("in 140k");
		expect(line).toContain("out 32k");
		expect(line).toContain("cache rd 83k");
		expect(line).toContain("hit 46%");
		expect(HAIRLINE_GLYPHS.test(line)).toBe(true);
	});

	test("medium widths keep the left usage ribbon before workspace context", () => {
		const line = buildFooterLine(snapshot(), MEDIUM, PLAIN_PAINT);

		expect(measure(line)).toBeLessThanOrEqual(MEDIUM);
		expect(line).toContain("openai-codex/gpt-5.6-luna high ·");
		expect(line).not.toContain("herdr-statusbar");
		expect(line).toContain("42%");
		expect(line).toContain("85k/200k");
		expect(line).toContain("in 140k");
		expect(line).toContain("out 32k");
		expect(HAIRLINE_GLYPHS.test(line)).toBe(true);
	});

	test("narrow widths shed by priority and keep model plus context percent", () => {
		const line = buildFooterLine(snapshot(), NARROW, PLAIN_PAINT);

		expect(measure(line)).toBeLessThanOrEqual(NARROW);
		expect(line).toContain("openai-codex/gpt-5.6-luna");
		expect(line).toContain(" · 42%");
		expect(line).toContain("42%");
		expect(line).not.toContain("session");
		expect(line).not.toContain("git main");
		expect(line).not.toContain("cache");
	});

	test("sheds right workspace context before requested usage metrics", () => {
		const rich = snapshot({ statuses: ["🧠 Connected"] });
		const at = (width: number) => buildFooterLine(rich, width, PLAIN_PAINT);

		expect(at(220)).toContain("🧠 Connected · git main · ~/projects/herdr-statusbar");
		expect(at(150)).not.toContain("herdr-statusbar");
		expect(at(130)).toContain("🧠 Connected · git main");
		expect(at(120)).toContain("🧠 Connected");
		expect(at(120)).not.toContain("git main");
		expect(at(110)).not.toContain("🧠 Connected");
		expect(at(100)).not.toContain("hit 46%");
		expect(at(85)).toContain("rd 83k");
		expect(at(80)).not.toContain("rd 83k");
		expect(at(70)).toContain("in 140k");
		expect(at(63)).toContain("in 140k");
		expect(at(62)).toContain("in 140k");
		expect(at(61)).not.toContain("in 140k");
		expect(HAIRLINE_GLYPHS.test(at(45))).toBe(false);
		for (const width of [220, 180, 150, 130, 120, 110, 100, 85, 80, 70, 64, 45]) {
			expect(at(width)).toContain("openai-codex/gpt-5.6-luna");
			expect(at(width)).toContain("42%");
		}
	});

	test("keeps model + thinking when the full identity fits the row", () => {
		const line = buildFooterLine(
			snapshot({
				reasoning: "high",
				tokens: 0,
				percent: 42,
				totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				latestCacheHit: undefined,
				branch: null,
				sessionName: undefined,
			}),
			38,
			PLAIN_PAINT,
		);

		expect(measure(line)).toBeLessThanOrEqual(38);
		expect(line).toContain("openai-codex/gpt-5.6-luna high");
		expect(line).toContain("42%");
	});

	test("drops thinking first when the full identity cannot fit", () => {
		const line = buildFooterLine(
			snapshot({
				reasoning: "high",
				tokens: 0,
				percent: 42,
				totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				latestCacheHit: undefined,
				branch: null,
				sessionName: undefined,
			}),
			34,
			PLAIN_PAINT,
		);

		expect(line).toContain("openai-codex/gpt-5.6-luna");
		expect(line).not.toContain("openai-codex/gpt-5.6-luna high");
		expect(line).toContain("42%");
	});
	test("places tps and ttft after context tokens and omits unknown metrics", () => {
		const withMetrics = buildFooterLine(snapshot({ outputTps: 42.14, ttftMs: 1_234 }), WIDE, PLAIN_PAINT);
		const withoutMetrics = buildFooterLine(snapshot(), WIDE, PLAIN_PAINT);
		const tokensAt = withMetrics.indexOf("85k/200k");
		const tpsAt = withMetrics.indexOf("tps 42.1");
		const ttftAt = withMetrics.indexOf("ttft 1.23s");

		expect(tokensAt).toBeGreaterThanOrEqual(0);
		expect(tpsAt).toBe(tokensAt + "85k/200k".length + 2);
		expect(ttftAt).toBe(tpsAt + "tps 42.1".length + 2);
		expect(withMetrics).toContain("85k/200k  tps 42.1  ttft 1.23s");
		expect(withoutMetrics).toContain("85k/200k");
		expect(withoutMetrics).not.toContain("tps ");
		expect(withoutMetrics).not.toContain("ttft ");
		expect(buildFooterLine(snapshot({ outputTps: 0, ttftMs: -1 }), WIDE, PLAIN_PAINT)).not.toContain("tps ");
		expect(buildFooterLine(snapshot({ outputTps: Number.NaN, ttftMs: Number.NaN }), WIDE, PLAIN_PAINT)).not.toContain("ttft ");
	});

	test("sheds tps before context percent and tokens", () => {
		const rich = snapshot({ outputTps: 42.1 });
		const at = (width: number) => buildFooterLine(rich, width, PLAIN_PAINT);
		let sawBoth = false;
		let sawTokensWithoutTps = false;

		for (let width = 1; width <= 240; width += 1) {
			const line = at(width);
			const hasPercent = line.includes("42%");
			const hasTokens = line.includes("85k/200k");
			const hasTps = line.includes("tps 42.1");
			if (hasTps) {
				expect(hasPercent).toBe(true);
				expect(hasTokens).toBe(true);
				expect(line.indexOf("85k/200k")).toBeLessThan(line.indexOf("tps 42.1"));
				sawBoth = true;
			} else if (hasTokens) {
				expect(hasPercent).toBe(true);
				sawTokensWithoutTps = true;
			}
		}

		expect(sawBoth).toBe(true);
		expect(sawTokensWithoutTps).toBe(true);
		expect(at(WIDE)).toContain("85k/200k  tps 42.1");
	});

	test("omits fields outside the requested ribbon", () => {
		const line = buildFooterLine(snapshot({ subscription: true, autoCompact: false }), WIDE, PLAIN_PAINT);
		expect(line).not.toContain("sub");
		expect(line).not.toContain("$");
		expect(line).not.toContain("compact ");
		expect(line).not.toContain("session ");
		expect(line).not.toContain("cache wr");
	});

	test("handles missing model, provider, branch, session, context, and totals", () => {
		const line = buildFooterLine(
			snapshot({
				provider: undefined,
				modelId: undefined,
				reasoning: undefined,
				branch: null,
				sessionName: undefined,
				percent: null,
				tokens: null,
				totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				latestCacheHit: undefined,
				cost: 0,
			}),
			WIDE,
			PLAIN_PAINT,
		);

		expect(line).toContain("no model");
		expect(line).toContain("--%");
		expect(line).toContain("?/200k");
		expect(line).not.toContain("$");
		expect(line).toContain("─");
		expect(line).not.toContain("━");
		expect(line).not.toContain("git ");
		expect(line).not.toContain("session ");
		expect(line).not.toContain("in ");
		expect(line).not.toContain("hit ");
	});

	test("hides the cache hit rate when no cache traffic exists", () => {
		const line = buildFooterLine(
			snapshot({ totals: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0 }, latestCacheHit: 12 }),
			WIDE,
			PLAIN_PAINT,
		);

		expect(line).toContain("in 100");
		expect(line).not.toContain("hit ");
		expect(line).not.toContain("cache ");
	});

	test("uses one separator, muted structure, and brighter values", () => {
		const tones: string[] = [];
		const line = buildFooterLine(snapshot({ statuses: ["herdr connected"] }), WIDE, {
			fg: (tone, text) => {
				tones.push(tone);
				return text;
			},
			bold: (text) => text,
		});

		expect(tones).toContain("accent");
		expect(tones).toContain("muted");
		expect(tones).toContain("borderMuted");
		expect(tones).toContain("text");
		expect(tones).toContain("success");
		// One separator glyph, no decorative icons.
		expect(stripAnsi(line)).not.toContain("◆");
		expect(stripAnsi(line)).not.toContain("|");
		expect(stripAnsi(line)).not.toContain("│");
	});

	test("colours the context readout by pressure", () => {
		const tonesFor = (percent: number | null) => {
			const tones: string[] = [];
			buildFooterLine(snapshot({ percent }), NORMAL, {
				fg: (tone, text) => {
					tones.push(tone);
					return text;
				},
				bold: (text) => text,
			});
			return tones;
		};

		expect(tonesFor(42.4)).toContain("success");
		expect(tonesFor(80)).toContain("warning");
		expect(tonesFor(95)).toContain("error");
	});

	test("bounds the status strip so extensions cannot own the ribbon", () => {
		const line = buildFooterLine(
			snapshot({ statuses: [sanitizeStatusText("s".repeat(300)), sanitizeStatusText("t".repeat(300))] }),
			400,
			PLAIN_PAINT,
		);

		const statusRun = /s+…?/.exec(stripAnsi(line))?.[0] ?? "";
		expect(statusRun.length).toBeLessThanOrEqual(MAX_STATUS_STRIP_VISIBLE);
		expect(measure(line)).toBe(400);
	});

	test("keeps styled statuses well-formed when the strip is clipped", () => {
		const styled = sanitizeStatusText("\u001b[38;2;49;116;143mConnected to a very long remote session name indeed\u001b[0m");
		const line = buildFooterLine(snapshot({ statuses: [styled] }), 400, PLAIN_PAINT);

		expect(stripAnsi(line)).not.toContain("[38;2");
		expect(stripAnsi(line)).toContain("Connected to a very long remote");
		expect(measure(line)).toBe(400);
	});
});

describe("full footer", () => {
	test("renders exactly one line at every usable width", () => {
		const loaded = snapshot({
			branch: "feature/an-extremely-long-branch-name-for-pressure",
			sessionName: "a-very-long-session-name-indeed",
			statuses: [sanitizeStatusText(`\u001b[31m${"a".repeat(300)}\u001b[0m`), sanitizeStatusText("b".repeat(300))],
		});

		for (let width = 1; width <= 240; width += 1) {
			const lines = renderFooter(loaded, width, PLAIN_PAINT);
			expect(lines).toHaveLength(1);
			expect(measure(lines[0]!)).toBeLessThanOrEqual(width);
			expect(lines[0]!).not.toContain("\n");
		}
	});

	test("returns no rows for a zero or negative width", () => {
		expect(renderFooter(snapshot(), 0, PLAIN_PAINT)).toEqual([]);
		expect(renderFooter(snapshot(), -5, PLAIN_PAINT)).toEqual([]);
	});

	test("uses only portable glyphs and never block bars", () => {
		for (const width of [WIDE, NORMAL, MEDIUM, NARROW, 20]) {
			for (const line of renderFooter(snapshot({ statuses: ["ready"] }), width, PLAIN_PAINT)) {
				expect(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u.test(line)).toBe(false);
				expect(BLOCK_GLYPHS.test(line)).toBe(false);
			}
		}
	});
});

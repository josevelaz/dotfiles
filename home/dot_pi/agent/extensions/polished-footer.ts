import { homedir } from "node:os";
import { basename } from "node:path";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	CODEXBAR_QUOTA_EVENT,
	type CodexAccountQuota,
	type CodexBarQuotaProvider,
	type CodexBarQuotaUpdate,
} from "./codexbar-quota.ts";

// ---------------------------------------------------------------------------
// Usage accounting
// ---------------------------------------------------------------------------

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface UsageSummary {
	totals: UsageTotals;
	/** Cache hit rate of the most recent assistant message, in percent. */
	latestCacheHit: number | undefined;
}

interface UsageSummaryCache {
	get(): UsageSummary;
	invalidate(): void;
}

function addUsage(totals: UsageTotals, usage: Usage): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost.total;
}

export function summarizeUsage(entries: readonly SessionEntry[]): UsageSummary {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let latestCacheHit: number | undefined;

	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const message = entry.message as AssistantMessage;
			addUsage(totals, message.usage);
			const promptTokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
			latestCacheHit = promptTokens > 0 ? (message.usage.cacheRead / promptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}

	return { totals, latestCacheHit };
}

export function createUsageSummaryCache(readEntries: () => readonly SessionEntry[]): UsageSummaryCache {
	let cached: UsageSummary | undefined;
	return {
		get(): UsageSummary {
			cached ??= summarizeUsage(readEntries());
			return cached;
		},
		invalidate(): void {
			cached = undefined;
		},
	};
}

// ---------------------------------------------------------------------------
// Generation telemetry: output TPS and TTFT
// ---------------------------------------------------------------------------

const OUTPUT_DELTA_TYPES: ReadonlySet<string> = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);
/** A long inter-delta gap is an inference stall, not active generation time. */
const STALL_THRESHOLD_MS = 500;
/** Require enough updates to distinguish streaming from a buffered flush. */
const MIN_STREAM_DELTAS = 6;
/** Buffered flushes commonly dispatch chunks less than 1 ms apart. */
const MIN_AVERAGE_DELTA_GAP_MS = 1;
/** Very short spans cannot identify a stable generation rate. */
const MIN_ACTIVE_GENERATION_MS = 200;
/** Reject structurally implausible rates even when the timing gates pass. */
const MAX_PLAUSIBLE_TPS = 10_000;
/** Provider usage must be within this factor of streamed content. */
const PROVIDER_TOKEN_RATIO = 3;
const CHARS_PER_TOKEN_SANITY_ESTIMATE = 4;

export interface TpsDeltaEvent {
	readonly type?: unknown;
	readonly delta?: unknown;
}

export interface TpsCompletionMessage {
	readonly role?: string;
	readonly stopReason?: string;
	readonly usage?: { readonly output?: unknown };
}

export interface OutputTpsTracker {
	/** Start the request clock for one provider turn. */
	beginTurn(): void;
	/** Start a fresh assistant stream without resetting the request clock. */
	beginMessage(): void;
	/** Record a content-bearing stream delta. Structural events are ignored. */
	noteDelta(typeOrEvent: string | TpsDeltaEvent | null | undefined): void;
	/** Finalize the assistant stream. Returns the latest reliable TPS. */
	complete(message: TpsCompletionMessage): number | undefined;
	reset(): void;
	latest(): number | undefined;
	latestTtftMs(): number | undefined;
}

function deltaType(typeOrEvent: string | TpsDeltaEvent): string {
	if (typeof typeOrEvent === "string") return typeOrEvent;
	return typeof typeOrEvent.type === "string" ? typeOrEvent.type : "";
}

function deltaChars(delta: unknown): number {
	if (typeof delta === "string") return delta.length;
	return 0;
}

function providerOutputTokens(output: unknown): number | undefined {
	if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return undefined;
	return output;
}

/**
 * Accept provider token usage only when it plausibly belongs to this stream.
 *
 * The character estimate is a sanity check, never the TPS numerator. Cursor and
 * some gateways can report hidden-reasoning or cumulative output usage. Showing
 * no TPS is more accurate than converting characters into guessed tokens.
 */
export function tokensForTpsWindow(providerTokens: number | undefined, streamedChars: number): number | undefined {
	if (providerTokens === undefined || streamedChars <= 0) return undefined;
	const estimated = Math.max(1, Math.round(streamedChars / CHARS_PER_TOKEN_SANITY_ESTIMATE));
	if (providerTokens < estimated / PROVIDER_TOKEN_RATIO || providerTokens > estimated * PROVIDER_TOKEN_RATIO) {
		return undefined;
	}
	return providerTokens;
}

/**
 * Measure one provider generation with pi-tps's strict timing model.
 *
 * TTFT runs from `turn_start` to the first content delta. TPS runs from the
 * first to the last content delta, excludes detected stalls, and is published
 * only when the stream has enough timing evidence to rule out a buffer flush.
 */
export function createOutputTpsTracker(now: () => number = () => performance.now()): OutputTpsTracker {
	let turnStartedAt: number | undefined;
	let firstDeltaAt: number | undefined;
	let lastDeltaAt: number | undefined;
	let previousDeltaAt: number | undefined;
	let deltaCount = 0;
	let streamedChars = 0;
	let stallMs = 0;
	let latestTps: number | undefined;
	let latestTtft: number | undefined;

	const clearMessage = (): void => {
		firstDeltaAt = undefined;
		lastDeltaAt = undefined;
		previousDeltaAt = undefined;
		deltaCount = 0;
		streamedChars = 0;
		stallMs = 0;
	};

	return {
		beginTurn(): void {
			turnStartedAt = now();
			clearMessage();
		},
		beginMessage(): void {
			clearMessage();
		},
		noteDelta(typeOrEvent: string | TpsDeltaEvent | null | undefined): void {
			if (typeOrEvent == null || !OUTPUT_DELTA_TYPES.has(deltaType(typeOrEvent))) return;
			const chars = typeof typeOrEvent === "string" ? 0 : deltaChars(typeOrEvent.delta);
			if (chars <= 0) return;

			const at = now();
			firstDeltaAt ??= at;
			if (previousDeltaAt !== undefined) {
				const gap = at - previousDeltaAt;
				if (Number.isFinite(gap) && gap >= STALL_THRESHOLD_MS) stallMs += gap;
			}
			previousDeltaAt = at;
			lastDeltaAt = at;
			deltaCount += 1;
			streamedChars += chars;
		},
		complete(message: TpsCompletionMessage): number | undefined {
			if (message.role !== "assistant") return latestTps;

			const started = firstDeltaAt;
			const ended = lastDeltaAt;
			const requestStarted = turnStartedAt;
			const count = deltaCount;
			const chars = streamedChars;
			const stalls = stallMs;
			clearMessage();
			turnStartedAt = undefined;

			if (message.stopReason === "error" || message.stopReason === "aborted" || started === undefined) {
				return latestTps;
			}

			// A completed turn replaces the displayed sample. Never pair a new TTFT
			// with stale TPS from an older, measurable stream.
			latestTps = undefined;
			latestTtft = undefined;
			if (requestStarted !== undefined) {
				const ttft = started - requestStarted;
				if (Number.isFinite(ttft) && ttft >= 0) latestTtft = ttft;
			}

			const tokens = tokensForTpsWindow(providerOutputTokens(message.usage?.output), chars);
			if (tokens === undefined || ended === undefined || count < MIN_STREAM_DELTAS) return latestTps;

			const streamMs = ended - started;
			const averageGapMs = streamMs / (count - 1);
			const activeMs = streamMs - stalls;
			if (
				!Number.isFinite(streamMs) ||
				averageGapMs < MIN_AVERAGE_DELTA_GAP_MS ||
				activeMs < MIN_ACTIVE_GENERATION_MS ||
				stalls >= activeMs
			) {
				return latestTps;
			}

			const measured = tokens / (activeMs / 1000);
			if (!Number.isFinite(measured) || measured <= 0 || measured > MAX_PLAUSIBLE_TPS) return latestTps;
			latestTps = measured;
			return latestTps;
		},
		reset(): void {
			turnStartedAt = undefined;
			clearMessage();
			latestTps = undefined;
			latestTtft = undefined;
		},
		latest(): number | undefined {
			return latestTps;
		},
		latestTtftMs(): number | undefined {
			return latestTtft;
		},
	};
}

// ---------------------------------------------------------------------------
// Painting surface
// ---------------------------------------------------------------------------

/** Semantic theme tokens this footer is allowed to use. */
export type FooterTone = "accent" | "text" | "muted" | "dim" | "borderMuted" | "success" | "warning" | "error";

/** Minimal painting surface so layout can be tested without a live theme. */
export interface FooterPaint {
	fg(tone: FooterTone, text: string): string;
	bold(text: string): string;
}

/** Identity paint: emits plain text. Used by tests and as a safe fallback. */
export const PLAIN_PAINT: FooterPaint = {
	fg: (_tone, text) => text,
	bold: (text) => text,
};

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

/**
 * Semantic model identity: `<provider>/<model>`.
 *
 * The provider is never shortened away — it is part of the model's meaning
 * here, because the same model name is served by several providers. When the
 * model id already carries its provider prefix, it is used as-is so the
 * provider is never printed twice. Both inputs are sanitized by the caller
 * before they reach layout or paint.
 */
export function formatModelIdentity(provider: string | undefined, modelId: string | undefined): string {
	const id = sanitizeIdentityText(modelId ?? "").trim();
	if (id === "") return "no model";

	const vendor = sanitizeIdentityText(provider ?? "").trim();
	if (vendor === "") return id;
	if (id === vendor) return id;
	if (id.startsWith(`${vendor}/`)) return id;
	return `${vendor}/${id}`;
}

/** Home-relative, `~`-prefixed path. Absolute paths outside home are unchanged. */
export function compactCwd(cwd: string, home: string = homedir()): string {
	const normalize = (value: string) => (value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value);
	const path = normalize(cwd);
	const base = normalize(home);
	if (base === "" || base === "/") return path;
	if (path === base) return "~";
	if (path.startsWith(`${base}/`)) return `~${path.slice(base.length)}`;
	return path;
}

/** Final path segment, or the compact path itself when there is no segment. */
export function projectName(cwd: string, home: string = homedir()): string {
	const compact = compactCwd(cwd, home);
	if (compact === "~" || compact === "/") return compact;
	const name = basename(compact);
	return name === "" ? compact : name;
}

/** Compact token counts: `940`, `9.4k`, `94k`, `9.4M`, `94M`. */
export function formatTokens(count: number | null | undefined): string {
	if (count == null || !Number.isFinite(count)) return "?";
	const value = Math.max(0, Math.round(count));
	if (value < 1_000) return String(value);
	if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
	if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

export function formatPercent(percent: number | null | undefined): string {
	if (percent == null || !Number.isFinite(percent)) return "--%";
	const clamped = Math.max(0, Math.min(999, percent));
	return `${Math.round(clamped)}%`;
}

export function percentTone(percent: number | null | undefined): FooterTone {
	if (percent == null || !Number.isFinite(percent)) return "muted";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "success";
}

export function formatCost(cost: number, subscription: boolean): string {
	if (subscription) return "sub";
	const safe = Number.isFinite(cost) ? Math.max(0, cost) : 0;
	if (safe === 0) return "$0";
	if (safe < 10) return `$${safe.toFixed(2)}`;
	return `$${safe.toFixed(1)}`;
}

/** `85k/200k`, or `?/200k` when the token count is unknown (e.g. after compaction). */
export function formatContextTokens(tokens: number | null | undefined, contextWindow: number): string {
	return `${formatTokens(tokens)}/${formatTokens(contextWindow)}`;
}

/** One-decimal output rate, or undefined when there is nothing to show. */
export function formatTps(tps: number | null | undefined): string | undefined {
	if (tps == null || !Number.isFinite(tps) || tps <= 0) return undefined;
	return tps.toFixed(1);
}

/** Compact time-to-first-token with enough precision to compare providers. */
export function formatTtft(ttftMs: number | null | undefined): string | undefined {
	if (ttftMs == null || !Number.isFinite(ttftMs) || ttftMs < 0) return undefined;
	if (ttftMs < 1_000) return `${Math.round(ttftMs)}ms`;
	return `${(ttftMs / 1_000).toFixed(2)}s`;
}

/** Thin hairline glyphs. Deliberately not block elements: the meter is a rule, not a bar. */
const HAIRLINE_FULL = "━";
const HAIRLINE_EMPTY = "─";

export interface ContextMeter {
	/** Used portion of the track, painted with the context tone. */
	readonly filled: string;
	/** Remaining track, painted as a muted border. */
	readonly empty: string;
}

/**
 * Fixed-width context hairline. Always renders exactly `cells` columns so the
 * rule stays the footer's single visual signature; unknown usage renders as an
 * untouched track rather than disappearing. Any non-zero usage claims at least
 * one cell, and anything short of the full window keeps at least one empty
 * cell, so the reading is never rounded into a lie.
 */
export function contextMeter(percent: number | null | undefined, cells: number): ContextMeter {
	if (cells <= 0) return { filled: "", empty: "" };
	if (percent == null || !Number.isFinite(percent)) return { filled: "", empty: HAIRLINE_EMPTY.repeat(cells) };

	const ratio = Math.max(0, Math.min(1, percent / 100));
	let used = Math.round(ratio * cells);
	if (ratio > 0 && used === 0) used = 1;
	if (ratio < 1 && used === cells) used = cells - 1;

	return { filled: HAIRLINE_FULL.repeat(used), empty: HAIRLINE_EMPTY.repeat(cells - used) };
}

// ---------------------------------------------------------------------------
// Extension status sanitation
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const BEL = 0x07;
const ST = 0x9c;
const NEL = 0x85;
const LEFT_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const FINAL_M = 0x6d;
const RESET_SGR = "\u001b[0m";

/** Longest prefix of a single status we are willing to scan. */
export const MAX_STATUS_INPUT = 4_096;
/** Most visible characters kept from a single status. */
export const MAX_STATUS_VISIBLE = 256;
/** Most characters emitted for a single status, including kept SGR sequences. */
export const MAX_STATUS_OUTPUT = 2_048;
/** Longest SGR parameter run accepted before the sequence is treated as hostile. */
const MAX_SGR_PARAMS = 64;

/** Single-character whitespace test; constant work, no backtracking. */
const UNICODE_SPACE = /\s/u;

function isSgrParam(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || code === 0x3a || code === 0x3b;
}

function isC1(code: number): boolean {
	return code >= 0x80 && code <= 0x9f;
}

/** C0 controls, DEL, NEL, and Unicode whitespace all collapse to one space. */
function isSpaceLike(code: number, char: string): boolean {
	if (code <= 0x20) return true;
	if (code === 0x7f || code === NEL) return true;
	if (code < 0x80) return false;
	return UNICODE_SPACE.test(char);
}

/**
 * End index (exclusive) of a complete `ESC [ <params> m` sequence at `start`,
 * or -1 when the text there is not a well-formed, bounded SGR sequence.
 */
function matchSgr(text: string, start: number): number {
	if (text.charCodeAt(start + 1) !== LEFT_BRACKET) return -1;
	const first = start + 2;
	let index = first;
	while (index < text.length && isSgrParam(text.charCodeAt(index))) {
		if (index - first >= MAX_SGR_PARAMS) return -1;
		index += 1;
	}
	return index < text.length && text.charCodeAt(index) === FINAL_M ? index + 1 : -1;
}

/** Consume a CSI body (parameters, intermediates, final byte) starting after the introducer. */
function skipCsi(text: string, start: number): number {
	let index = start;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code >= 0x20 && code <= 0x3f) {
			index += 1;
			continue;
		}
		if (code >= 0x40 && code <= 0x7e) return index + 1;
		return index;
	}
	return index;
}

/**
 * Consume a control-string body through its terminator, or through input end
 * when malformed/unterminated.
 *
 * OSC may end at BEL or ST. DCS, SOS, PM, and APC end only at ST
 * (`ESC \` or C1 ST). A non-ST ESC inside the string stays part of the payload
 * and must not resume outer parsing.
 */
function skipControlString(text: string, start: number, allowBel: boolean): number {
	let index = start;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (allowBel && code === BEL) return index + 1;
		if (code === ST) return index + 1;
		if (code === ESC) {
			if (text.charCodeAt(index + 1) === BACKSLASH) return index + 2;
			index += 1;
			continue;
		}
		index += 1;
	}
	return index;
}

/** Consume a non-SGR escape sequence whole; never leaves its payload behind. */
function skipEscape(text: string, start: number): number {
	const next = text.charCodeAt(start + 1);
	if (Number.isNaN(next) || next === ESC) return start + 1;
	if (next === LEFT_BRACKET) return skipCsi(text, start + 2);
	// OSC `]` — BEL or ST.
	if (next === 0x5d) return skipControlString(text, start + 2, true);
	// DCS `P`, SOS `X`, PM `^`, APC `_` — ST only.
	if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
		return skipControlString(text, start + 2, false);
	}
	if (next >= 0x20 && next <= 0x2f) {
		let index = start + 2;
		while (index < text.length) {
			const code = text.charCodeAt(index);
			if (code >= 0x20 && code <= 0x2f) {
				index += 1;
				continue;
			}
			return code >= 0x30 && code <= 0x7e ? index + 1 : index;
		}
		return index;
	}
	// Single-final escapes: ESC c, ESC 7, ESC 8, ESC =, ESC >, ESC \ and friends.
	if (next >= 0x30 && next <= 0x7e) return start + 2;
	return start + 1;
}

/** Consume an 8-bit C1 control, including string bodies for C1 OSC/DCS/SOS/PM/APC. */
function skipC1(text: string, start: number): number {
	const code = text.charCodeAt(start);
	if (code === 0x9b) return skipCsi(text, start + 1);
	// C1 OSC — BEL or ST.
	if (code === 0x9d) return skipControlString(text, start + 1, true);
	// C1 DCS / SOS / PM / APC — ST only.
	if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
		return skipControlString(text, start + 1, false);
	}
	return start + 1;
}

/** Clip hostile input up front, without splitting a surrogate pair. */
function boundInput(text: string): string {
	if (text.length <= MAX_STATUS_INPUT) return text;
	const clipped = text.slice(0, MAX_STATUS_INPUT);
	const last = clipped.charCodeAt(clipped.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}

/**
 * Make an extension status safe for a single footer line without damaging its
 * colours.
 *
 * This is an allowlist parser: a single linear pass keeps ordinary text and
 * complete CSI SGR sequences, and drops everything else — every other escape
 * sequence, every C1 control, and any OSC/DCS/APC/PM/SOS payload. Cursor
 * movement, screen/terminal resets, titles, clipboard writes, and hyperlinks
 * can therefore never reach the terminal, and no sequence is ever half-stripped
 * into literal `[38;2;...m` text. Input and output are both bounded, so hostile
 * statuses cost predictable work.
 */
export function sanitizeStatusText(text: string): string {
	const input = boundInput(text);
	let out = "";
	let styled = false;
	let visible = 0;
	let pendingSpace = false;
	let index = 0;

	while (index < input.length) {
		const code = input.charCodeAt(index);

		if (code === ESC) {
			const sgrEnd = matchSgr(input, index);
			if (sgrEnd < 0) {
				index = skipEscape(input, index);
				continue;
			}
			if (out.length + (sgrEnd - index) + RESET_SGR.length <= MAX_STATUS_OUTPUT) {
				out += input.slice(index, sgrEnd);
				styled = true;
			}
			index = sgrEnd;
			continue;
		}

		if (code !== NEL && isC1(code)) {
			index = skipC1(input, index);
			continue;
		}

		const high = code >= 0xd800 && code <= 0xdbff;
		const low = high ? input.charCodeAt(index + 1) : Number.NaN;
		const size = high && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
		const char = size === 1 ? input.charAt(index) : input.slice(index, index + 2);

		if (size === 1 && isSpaceLike(code, char)) {
			pendingSpace = true;
			index += 1;
			continue;
		}

		const space = pendingSpace && visible > 0;
		const cells = space ? 2 : 1;
		if (visible + cells > MAX_STATUS_VISIBLE) break;
		if (out.length + (space ? 1 : 0) + size + RESET_SGR.length > MAX_STATUS_OUTPUT) break;

		if (space) {
			out += " ";
			visible += 1;
		}
		pendingSpace = false;
		out += char;
		visible += 1;
		index += size;
	}

	if (visible === 0) return "";
	if (!styled) return out;
	return out.endsWith(RESET_SGR) ? out : `${out}${RESET_SGR}`;
}

/** True when the text carries no visible characters (styling only). */
export function isBlankStatus(text: string): boolean {
	let index = 0;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code === ESC) {
			const sgrEnd = matchSgr(text, index);
			index = sgrEnd < 0 ? skipEscape(text, index) : sgrEnd;
			continue;
		}
		if (code !== NEL && isC1(code)) {
			index = skipC1(text, index);
			continue;
		}
		if (!isSpaceLike(code, text.charAt(index))) return false;
		index += 1;
	}
	return true;
}

/**
 * Make a plain-text identity field safe for a single footer line.
 *
 * Identity text keeps no ANSI: every ESC/C1 control string and payload is
 * dropped with the same bounded parser used for statuses, line-breaking
 * whitespace collapses to one space, ordinary Unicode is preserved, and
 * input/output are capped. Controls are never visibly escaped.
 */
export function sanitizeIdentityText(text: string): string {
	const input = boundInput(text);
	let out = "";
	let visible = 0;
	let pendingSpace = false;
	let index = 0;

	while (index < input.length) {
		const code = input.charCodeAt(index);

		if (code === ESC) {
			index = skipEscape(input, index);
			continue;
		}

		if (code !== NEL && isC1(code)) {
			index = skipC1(input, index);
			continue;
		}

		const high = code >= 0xd800 && code <= 0xdbff;
		const low = high ? input.charCodeAt(index + 1) : Number.NaN;
		const size = high && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
		const char = size === 1 ? input.charAt(index) : input.slice(index, index + 2);

		if (size === 1 && isSpaceLike(code, char)) {
			pendingSpace = true;
			index += 1;
			continue;
		}

		const space = pendingSpace && visible > 0;
		const cells = space ? 2 : 1;
		if (visible + cells > MAX_STATUS_VISIBLE) break;
		if (out.length + (space ? 1 : 0) + size > MAX_STATUS_OUTPUT) break;

		if (space) {
			out += " ";
			visible += 1;
		}
		pendingSpace = false;
		out += char;
		visible += 1;
		index += size;
	}

	return visible === 0 ? "" : out;
}

const MAX_QUOTA_ACCOUNTS = 4;
const MAX_QUOTA_WINDOWS = 3;
const MAX_QUOTA_LABEL = 12;
const QUOTA_LABEL = /^(?:session|wk|mo|extra|\d{1,4}[dhm])$/;
const QUOTA_PROVIDER_ORDER: readonly CodexBarQuotaProvider[] = ["codex", "claude"];

/** Copy bounded account quota data into the footer without accepting identity fields. */
export function normalizeCodexQuotas(value: unknown): CodexAccountQuota[] {
	if (!Array.isArray(value)) return [];
	const accounts: CodexAccountQuota[] = [];
	for (const candidate of value.slice(0, MAX_QUOTA_ACCOUNTS)) {
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
		const rawWindows = Reflect.get(candidate, "windows");
		if (!Array.isArray(rawWindows)) continue;
		const windows = rawWindows.slice(0, MAX_QUOTA_WINDOWS).flatMap((rawWindow) => {
			if (typeof rawWindow !== "object" || rawWindow === null || Array.isArray(rawWindow)) return [];
			const labelValue = Reflect.get(rawWindow, "label");
			const percentValue = Reflect.get(rawWindow, "remainingPercent");
			if (typeof labelValue !== "string" || typeof percentValue !== "number" || !Number.isFinite(percentValue)) {
				return [];
			}
			const label = sanitizeIdentityText(labelValue).trim().slice(0, MAX_QUOTA_LABEL);
			if (!QUOTA_LABEL.test(label)) return [];
			return [{ label, remainingPercent: Math.max(0, Math.min(100, percentValue)) }];
		});
		if (windows.length > 0) accounts.push({ windows });
	}
	return accounts;
}

/** Validate one provider update from the shared CodexBar extension event. */
export function normalizeCodexBarQuotaUpdate(value: unknown): CodexBarQuotaUpdate | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const provider = Reflect.get(value, "provider");
	if (provider !== "codex" && provider !== "claude") return undefined;
	return { provider, accounts: normalizeCodexQuotas(Reflect.get(value, "accounts")) };
}

/** Footer status keys this ribbon already owns and never re-renders. */
const OWNED_STATUS_KEYS: ReadonlySet<string> = new Set([
	// This footer prints its own context readout.
	"context-tokens",
]);

const MAX_STATUS_SCAN = 32;
const MAX_STATUS_COUNT = 8;
const MAX_STATUS_KEY_INPUT = 128;
const MAX_STATUS_AGGREGATE_INPUT = 4096;

/**
 * Selects a bounded set of extension statuses. We cap scanning and aggregate
 * input before sorting or joining, so a hostile status map cannot make footer
 * rendering grow with the map size.
 */
export function selectStatuses(statuses: ReadonlyMap<string, string>): string[] {
	const selected: Array<{ readonly key: string; readonly text: string }> = [];
	let scanned = 0;
	let aggregateInput = 0;

	const iterator = statuses[Symbol.iterator]();
	while (scanned < MAX_STATUS_SCAN && selected.length < MAX_STATUS_COUNT) {
		const next = iterator.next();
		if (next.done) break;
		const [key, value] = next.value;
		scanned += 1;
		if (OWNED_STATUS_KEYS.has(key)) continue;

		const remaining = MAX_STATUS_AGGREGATE_INPUT - aggregateInput;
		if (remaining <= 0) break;
		const boundedValue = value.slice(0, remaining);
		aggregateInput += boundedValue.length;
		const text = sanitizeStatusText(boundedValue);
		if (text === "" || isBlankStatus(text)) continue;
		selected.push({ key: key.slice(0, MAX_STATUS_KEY_INPUT), text });
	}

	selected.sort((left, right) => left.key.localeCompare(right.key));
	return selected.map(({ text }) => text);
}

// ---------------------------------------------------------------------------
// Auto-compaction state
// ---------------------------------------------------------------------------

/**
 * Auto-compaction is enabled by default and the host exposes no read-only
 * accessor for the effective setting, so the footer reports the default. The
 * footer must not read settings files: rendering has no business touching the
 * filesystem, and project files are untrusted input.
 */
export const DEFAULT_AUTO_COMPACT = true;

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/** Priority of a segment that must never be dropped. */
const REQUIRED = Number.POSITIVE_INFINITY;

interface Segment {
	/** Unstyled text; the only source of width. */
	readonly plain: string;
	/** Styled text; must have the same visible width as `plain`. */
	readonly styled: string;
	/** Higher priorities survive width pressure longer. */
	readonly priority: number;
}

/** A run of related segments, joined by a single space pair. */
interface Group {
	readonly segments: readonly Segment[];
}

const ITEM_GAP = "  ";
const SIDE_GAP = 2;
/** The one separator this footer uses, everywhere, at every width. */
const DIVIDER = " · ";

function segment(plain: string, styled: string, priority: number): Segment {
	return { plain, styled, priority };
}

/** `label value` with a muted label and a brighter value. */
function field(
	label: string | undefined,
	value: string,
	priority: number,
	paint: FooterPaint,
	tone: FooterTone = "text",
): Segment {
	const plain = label === undefined ? value : `${label} ${value}`;
	const styled = label === undefined ? paint.fg(tone, value) : `${paint.fg("muted", label)} ${paint.fg(tone, value)}`;
	return segment(plain, styled, priority);
}

function group(...segments: (Segment | undefined)[]): Group {
	return { segments: segments.filter((item): item is Segment => item !== undefined) };
}

function renderSide(groups: readonly Group[], divider: string, paint: FooterPaint): { plain: string; styled: string } {
	const parts = groups
		.filter((item) => item.segments.length > 0)
		.map((item) => ({
			plain: item.segments.map((s) => s.plain).join(ITEM_GAP),
			styled: item.segments.map((s) => s.styled).join(ITEM_GAP),
		}));
	const styledDivider = paint.fg("borderMuted", divider);
	return {
		plain: parts.map((part) => part.plain).join(divider),
		styled: parts.map((part) => part.styled).join(styledDivider),
	};
}

function dropLowest(sides: Group[][]): boolean {
	let worst: { side: number; group: number; index: number; priority: number } | undefined;
	sides.forEach((groups, side) => {
		groups.forEach((item, groupIndex) => {
			item.segments.forEach((seg, index) => {
				if (seg.priority === REQUIRED) return;
				if (worst === undefined || seg.priority < worst.priority) {
					worst = { side, group: groupIndex, index, priority: seg.priority };
				}
			});
		});
	});
	if (worst === undefined) return false;

	const target = sides[worst.side]?.[worst.group];
	if (target === undefined) return false;
	sides[worst.side]![worst.group] = {
		segments: target.segments.filter((_, index) => index !== worst!.index),
	};
	return true;
}

/**
 * Compose a left/right justified row, dropping the lowest-priority segments
 * until the row fits. The result never exceeds `width` visible columns.
 */
export function composeRow(
	left: readonly Group[],
	right: readonly Group[],
	width: number,
	divider: string,
	paint: FooterPaint,
): string {
	if (width <= 0) return "";

	const sides: Group[][] = [
		left.map((item) => ({ segments: [...item.segments] })),
		right.map((item) => ({ segments: [...item.segments] })),
	];

	for (;;) {
		const leftSide = renderSide(sides[0]!, divider, paint);
		const rightSide = renderSide(sides[1]!, divider, paint);
		const leftWidth = visibleWidth(leftSide.plain);
		const rightWidth = visibleWidth(rightSide.plain);
		const gap = rightWidth === 0 ? 0 : SIDE_GAP;

		if (leftWidth + gap + rightWidth <= width) {
			const padding = width - leftWidth - rightWidth;
			if (rightWidth === 0) return leftSide.styled;
			return `${leftSide.styled}${" ".repeat(Math.max(0, padding))}${rightSide.styled}`;
		}

		if (!dropLowest(sides)) {
			const joined = rightSide.styled === "" ? leftSide.styled : `${leftSide.styled}${ITEM_GAP}${rightSide.styled}`;
			return truncateToWidth(joined, width, "…");
		}
	}
}

// ---------------------------------------------------------------------------
// The footer line
// ---------------------------------------------------------------------------

export interface FooterSnapshot {
	/** Provider of the active model, e.g. `openai-codex`. */
	readonly provider: string | undefined;
	/** Raw model id, or undefined when no model is selected. */
	readonly modelId: string | undefined;
	/** Reasoning/thinking level, only when the active model reasons. */
	readonly reasoning: string | undefined;
	readonly subscription: boolean;
	readonly cwd: string;
	readonly branch: string | null;
	readonly sessionName: string | undefined;
	/** Context tokens in use, or null right after compaction. */
	readonly tokens: number | null;
	readonly contextWindow: number;
	readonly percent: number | null;
	readonly autoCompact: boolean;
	readonly cost: number;
	readonly totals: UsageTotals;
	readonly latestCacheHit: number | undefined;
	/** Latest reliable completed output tokens per second, when known. */
	readonly outputTps?: number;
	/** Latest completed provider turn's time to first content token. */
	readonly ttftMs?: number;
	/** Remaining provider quota windows, with account identity deliberately omitted. */
	readonly providerQuotas?: readonly CodexBarQuotaUpdate[];
	readonly statuses: readonly string[];
	/** Injected for deterministic tests. */
	readonly home?: string;
}

/** Visual density of the single footer line. */
export type FooterDensity = "rich" | "compact" | "minimal";

export const RICH_MIN_WIDTH = 100;
export const COMPACT_MIN_WIDTH = 64;

export function pickDensity(width: number): FooterDensity {
	if (width >= RICH_MIN_WIDTH) return "rich";
	if (width >= COMPACT_MIN_WIDTH) return "compact";
	return "minimal";
}

/** Hairline length per density: long enough to read, short enough to stay quiet. */
export function meterCells(density: FooterDensity): number {
	if (density === "rich") return 10;
	if (density === "compact") return 6;
	return 4;
}

/** Most visible columns extension statuses may claim on the ribbon. */
export const MAX_STATUS_STRIP_VISIBLE = 48;

/** Segment priorities. Lower sheds first; the order here is the shedding order. */
const PRIORITY = {
	contextPercent: 90,
	contextTokens: 76,
	outputTps: 75,
	ttft: 74,
	meter: 73,
	input: 72,
	output: 71,
	cacheRead: 68,
	cacheHit: 67,
	statuses: 60,
	branch: 55,
	cwd: 50,
} as const;

/**
 * The single information ribbon: identity on the left, pressure and traffic on
 * the right, one separator throughout, and exactly one line at every width.
 */
export function buildFooterLine(snapshot: FooterSnapshot, width: number, paint: FooterPaint = PLAIN_PAINT): string {
	const density = pickDensity(width);
	const rich = density === "rich";
	const percentValue = formatPercent(snapshot.percent);

	// --- identity -----------------------------------------------------------
	const identity = formatModelIdentity(snapshot.provider, snapshot.modelId);
	const thinking = sanitizeIdentityText(snapshot.reasoning ?? "").trim();
	const showThinking =
		thinking !== "" &&
		visibleWidth(`${identity} ${thinking}`) + visibleWidth(DIVIDER) + visibleWidth(percentValue) <= width;
	const modelPlain = showThinking ? `${identity} ${thinking}` : identity;
	const modelStyled = showThinking
		? `${paint.bold(paint.fg("accent", identity))} ${paint.fg("muted", thinking)}`
		: paint.bold(paint.fg("accent", identity));
	const model = segment(modelPlain, modelStyled, REQUIRED);

	const safeCwd = sanitizeIdentityText(snapshot.cwd);
	const safeHome = snapshot.home === undefined ? undefined : sanitizeIdentityText(snapshot.home);
	const locationPath = sanitizeIdentityText(rich ? compactCwd(safeCwd, safeHome) : projectName(safeCwd, safeHome));
	const location = locationPath === "" ? undefined : field(undefined, locationPath, PRIORITY.cwd, paint, "text");

	const branchText = snapshot.branch === null ? "" : sanitizeIdentityText(snapshot.branch);
	const branch = branchText === "" ? undefined : field("git", branchText, PRIORITY.branch, paint, "text");

	// --- extension statuses -------------------------------------------------
	const statusStrip = snapshot.statuses.join(paint.fg("borderMuted", DIVIDER));
	const statuses =
		snapshot.statuses.length === 0
			? undefined
			: (() => {
					const clipped = truncateToWidth(statusStrip, MAX_STATUS_STRIP_VISIBLE, "…");
					return segment(clipped, clipped, PRIORITY.statuses);
				})();

	// --- pressure and traffic ----------------------------------------------
	const tone = percentTone(snapshot.percent);
	const meter = contextMeter(snapshot.percent, meterCells(density));
	const meterSegment =
		meter.filled === "" && meter.empty === ""
			? undefined
			: segment(
					`${meter.filled}${meter.empty}`,
					`${paint.fg(tone, meter.filled)}${paint.fg("borderMuted", meter.empty)}`,
					PRIORITY.meter,
				);
	const percent = segment(
		percentValue,
		paint.bold(paint.fg(tone, percentValue)),
		PRIORITY.contextPercent,
	);
	const contextTokens = field(
		undefined,
		formatContextTokens(snapshot.tokens, snapshot.contextWindow),
		PRIORITY.contextTokens,
		paint,
		"text",
	);
	const tpsValue = formatTps(snapshot.outputTps);
	const tps =
		tpsValue === undefined ? undefined : field("tps", tpsValue, PRIORITY.outputTps, paint, "text");
	const ttftValue = formatTtft(snapshot.ttftMs);
	const ttft =
		ttftValue === undefined ? undefined : field("ttft", ttftValue, PRIORITY.ttft, paint, "text");
	const totals = snapshot.totals;
	const input = totals.input > 0 ? field("in", formatTokens(totals.input), PRIORITY.input, paint, "text") : undefined;
	const output = totals.output > 0 ? field("out", formatTokens(totals.output), PRIORITY.output, paint, "text") : undefined;
	const cacheRead =
		totals.cacheRead > 0
			? field(rich ? "cache rd" : "rd", formatTokens(totals.cacheRead), PRIORITY.cacheRead, paint, "text")
			: undefined;
	const cacheActive = totals.cacheRead > 0 || totals.cacheWrite > 0;
	const hit =
		cacheActive && snapshot.latestCacheHit !== undefined
			? field("hit", formatPercent(snapshot.latestCacheHit), PRIORITY.cacheHit, paint, "muted")
			: undefined;

	return composeRow(
		[group(model), group(meterSegment, percent, contextTokens, tps, ttft), group(input, output), group(cacheRead, hit)],
		[group(statuses), group(branch), group(location)],
		width,
		DIVIDER,
		paint,
	);
}

export function quotaTone(remainingPercent: number): FooterTone {
	if (remainingPercent <= 10) return "error";
	if (remainingPercent <= 30) return "warning";
	return "success";
}

function quotaProviderLabel(provider: CodexBarQuotaProvider): string {
	return provider === "codex" ? "OpenAI Codex" : "Anthropic Claude";
}

/** Provider quota bars rendered directly below the provider/model row. */
export function buildProviderQuotaLines(
	providers: readonly CodexBarQuotaUpdate[],
	width: number,
	paint: FooterPaint = PLAIN_PAINT,
): string[] {
	if (width <= 0) return [];
	const density = pickDensity(width);
	const normalized = providers
		.map((provider) => normalizeCodexBarQuotaUpdate(provider))
		.filter((provider): provider is CodexBarQuotaUpdate => provider !== undefined)
		.sort((left, right) => QUOTA_PROVIDER_ORDER.indexOf(left.provider) - QUOTA_PROVIDER_ORDER.indexOf(right.provider));
	return normalized.flatMap((provider) =>
		provider.accounts.map((account, accountIndex) => {
			const accountSuffix = provider.accounts.length > 1 ? ` ${accountIndex + 1}` : "";
			const providerTone: FooterTone = provider.provider === "codex" ? "accent" : "warning";
			const providerSegment = field(
				undefined,
				`${quotaProviderLabel(provider.provider)}${accountSuffix}`,
				85,
				paint,
				providerTone,
			);
			const windows = account.windows.map((window, windowIndex) => {
				const tone = quotaTone(window.remainingPercent);
				const meter = contextMeter(window.remainingPercent, meterCells(density));
				const percent = formatPercent(window.remainingPercent);
				const plain = `${window.label} ${meter.filled}${meter.empty} ${percent}`;
				const styled = `${paint.fg("muted", window.label)} ${paint.fg(tone, meter.filled)}${paint.fg(
					"borderMuted",
					meter.empty,
				)} ${paint.bold(paint.fg(tone, percent))}`;
				return segment(plain, styled, windowIndex === 0 ? REQUIRED : 80 - windowIndex);
			});
			const groups = [group(providerSegment), ...windows.map((window) => group(window))];
			return composeRow(groups, [], width, DIVIDER, paint);
		}),
	);
}

/** Complete footer: the main ribbon followed by optional provider quota bars. */
export function renderFooter(snapshot: FooterSnapshot, width: number, paint: FooterPaint = PLAIN_PAINT): string[] {
	if (width <= 0) return [];
	return [
		buildFooterLine(snapshot, width, paint),
		...buildProviderQuotaLines(snapshot.providerQuotas ?? [], width, paint),
	];
}

// ---------------------------------------------------------------------------
// Extension wiring
// ---------------------------------------------------------------------------

export default function polishedFooter(pi: ExtensionAPI) {
	let usageCache: UsageSummaryCache | undefined;
	let requestFooterRender: (() => void) | undefined;
	const providerQuotas = new Map<CodexBarQuotaProvider, readonly CodexAccountQuota[]>();
	const unsubscribeCodexQuota = pi.events.on(CODEXBAR_QUOTA_EVENT, (value) => {
		const update = normalizeCodexBarQuotaUpdate(value);
		if (update === undefined) return;
		if (update.accounts.length === 0) providerQuotas.delete(update.provider);
		else providerQuotas.set(update.provider, update.accounts);
		requestFooterRender?.();
	});
	const tpsTracker = createOutputTpsTracker();
	const invalidateUsage = () => usageCache?.invalidate();

	pi.on("turn_start", () => {
		tpsTracker.beginTurn();
	});
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") tpsTracker.beginMessage();
	});
	pi.on("message_update", (event) => {
		tpsTracker.noteDelta(event.assistantMessageEvent);
	});
	pi.on("message_end", (event) => {
		invalidateUsage();
		const previousTps = tpsTracker.latest();
		const previousTtft = tpsTracker.latestTtftMs();
		tpsTracker.complete(event.message);
		if (tpsTracker.latest() !== previousTps || tpsTracker.latestTtftMs() !== previousTtft) {
			requestFooterRender?.();
		}
	});
	pi.on("turn_end", invalidateUsage);
	pi.on("agent_end", invalidateUsage);
	pi.on("session_compact", invalidateUsage);
	pi.on("session_tree", invalidateUsage);
	pi.on("session_shutdown", () => {
		usageCache = undefined;
		providerQuotas.clear();
		tpsTracker.reset();
		requestFooterRender = undefined;
		unsubscribeCodexQuota();
	});

	pi.on("session_start", (_event, ctx) => {
		providerQuotas.clear();
		tpsTracker.reset();
		if (ctx.mode !== "tui") return;

		const sessionUsageCache = createUsageSummaryCache(() => ctx.sessionManager.getEntries());
		usageCache = sessionUsageCache;

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => {
				sessionUsageCache.invalidate();
				tui.requestRender();
			});
			const paint: FooterPaint = {
				fg: (tone, text) => theme.fg(tone, text),
				bold: (text) => theme.bold(text),
			};

			return {
				dispose: unsubscribe,
				// The footer derives every value at render time; nothing is cached here.
				invalidate() {},
				render(width: number): string[] {
					const { totals, latestCacheHit } = sessionUsageCache.get();
					const model = ctx.model;
					const usage = ctx.getContextUsage();
					const thinkingLevel = model?.reasoning ? pi.getThinkingLevel() : undefined;
					const cwd = ctx.sessionManager.getCwd();

					const snapshot: FooterSnapshot = {
						provider: model?.provider,
						modelId: model?.id,
						reasoning: thinkingLevel && thinkingLevel !== "off" ? thinkingLevel : undefined,
						subscription: model
							? model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(model)
							: false,
						cwd,
						branch: footerData.getGitBranch(),
						sessionName: ctx.sessionManager.getSessionName(),
						tokens: usage?.tokens ?? null,
						contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
						percent: usage?.percent ?? null,
						autoCompact: DEFAULT_AUTO_COMPACT,
						cost: totals.cost,
						totals,
						latestCacheHit,
						outputTps: tpsTracker.latest(),
						ttftMs: tpsTracker.latestTtftMs(),
						providerQuotas: QUOTA_PROVIDER_ORDER.flatMap((provider) => {
							const accounts = providerQuotas.get(provider);
							return accounts === undefined ? [] : [{ provider, accounts }];
						}),
						statuses: selectStatuses(footerData.getExtensionStatuses()),
					};

					return renderFooter(snapshot, width, paint);
				},
			};
		});
	});
}

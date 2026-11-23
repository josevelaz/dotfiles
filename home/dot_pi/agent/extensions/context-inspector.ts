/**
 * Context Inspector Extension — /context command
 *
 * Provides a granular breakdown of everything in the model's context window:
 * - System prompt (with sub-sections: base, context files, skills, guidelines, tools)
 * - Conversation messages (user, assistant, tool results, custom, compaction, branch summaries)
 * - Per-message token estimates and sizes
 * - Context usage summary (tokens used, remaining, cache stats)
 *
 * Usage: type /context in interactive mode
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function estimateTokens(text: string): number {
	// ~4 chars per token is a rough but widely-used estimate
	return Math.ceil(text.length / 4);
}

function bar(fraction: number, width: number, theme: any): string {
	const filled = Math.round(fraction * width);
	const empty = width - filled;
	const color = fraction > 0.9 ? "error" : fraction > 0.7 ? "warning" : "success";
	return theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c: any) => c?.type === "text" && typeof c.text === "string")
		.map((c: any) => c.text)
		.join("\n");
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

// ─── Context section types ────────────────────────────────────────────

interface ContextSection {
	label: string;
	role: string;
	chars: number;
	tokens: number;
	preview: string;
	details?: string;
	entryId?: string;
}

// ─── Build sections ──────────────────────────────────────────────────

function buildSections(ctx: ExtensionCommandContext, systemPrompt: string): {
	systemSections: ContextSection[];
	messageSections: ContextSection[];
	totalTokens: number;
	totalChars: number;
} {
	const systemSections: ContextSection[] = [];
	const messageSections: ContextSection[] = [];
	let totalChars = 0;
	let totalTokens = 0;

	// 1. System prompt breakdown
	if (systemPrompt) {
		const promptChars = systemPrompt.length;
		const promptTokens = estimateTokens(systemPrompt);
		totalChars += promptChars;
		totalTokens += promptTokens;

		// Try to break system prompt into logical sub-sections
		const lines = systemPrompt.split("\n");
		let currentSection = "";
		let currentLabel = "Base prompt";
		const subSections: { label: string; text: string }[] = [];

		for (const line of lines) {
			const isMarkdownHeading = line.startsWith("# ");
			const isPersistentMemoryHeading = line.trim() === "[Persistent memory]";

			if (isMarkdownHeading || isPersistentMemoryHeading) {
				if (currentSection.trim()) {
					subSections.push({ label: currentLabel, text: currentSection });
				}
				currentLabel = isPersistentMemoryHeading
					? "Persistent memory"
					: line.replace(/^#+\s*/, "");
				currentSection = line + "\n";
			} else {
				currentSection += line + "\n";
			}
		}
		if (currentSection.trim()) {
			subSections.push({ label: currentLabel, text: currentSection });
		}

		if (subSections.length <= 1) {
			// Single block
			systemSections.push({
				label: "System Prompt",
				role: "system",
				chars: promptChars,
				tokens: promptTokens,
				preview: truncate(systemPrompt.replace(/\n/g, " ").trim(), 120),
				details: systemPrompt,
			});
		} else {
			// Multiple sub-sections
			for (const sub of subSections) {
				const subTokens = estimateTokens(sub.text);
				systemSections.push({
					label: sub.label,
					role: "system",
					chars: sub.text.length,
					tokens: subTokens,
					preview: truncate(sub.text.replace(/\n/g, " ").trim(), 120),
					details: sub.text,
				});
			}
		}
	}

	// 2. Conversation messages on the current branch
	const branch = ctx.sessionManager.getBranch();

	for (const entry of branch) {
		if (entry.type === "compaction") {
			const summary = (entry as any).summary ?? "";
			const chars = summary.length;
			const tokens = estimateTokens(summary);
			totalChars += chars;
			totalTokens += tokens;
			messageSections.push({
				label: "Compaction Summary",
				role: "compaction",
				chars,
				tokens,
				preview: truncate(summary.replace(/\n/g, " ").trim(), 120),
				details: summary,
				entryId: entry.id,
			});
			continue;
		}

		if (entry.type === "branch_summary") {
			const summary = (entry as any).summary ?? "";
			const chars = summary.length;
			const tokens = estimateTokens(summary);
			totalChars += chars;
			totalTokens += tokens;
			messageSections.push({
				label: "Branch Summary",
				role: "branchSummary",
				chars,
				tokens,
				preview: truncate(summary.replace(/\n/g, " ").trim(), 120),
				details: summary,
				entryId: entry.id,
			});
			continue;
		}

		if (entry.type === "custom_message") {
			const content = textContent((entry as any).content);
			const chars = content.length;
			const tokens = estimateTokens(content);
			totalChars += chars;
			totalTokens += tokens;
			const customType = (entry as any).customType ?? "unknown";
			messageSections.push({
				label: `Custom (${customType})`,
				role: "custom",
				chars,
				tokens,
				preview: truncate(content.replace(/\n/g, " ").trim(), 120),
				details: content,
				entryId: entry.id,
			});
			continue;
		}

		if (entry.type !== "message") continue;

		const msg = (entry as any).message;
		if (!msg?.role) continue;

		const content = textContent(msg.content);
		let label: string;
		let role: string;
		let extra = "";

		switch (msg.role) {
			case "user":
				label = "User";
				role = "user";
				break;
			case "assistant": {
				label = "Assistant";
				role = "assistant";
				// Count tool calls
				const toolCalls = Array.isArray(msg.content)
					? msg.content.filter((c: any) => c?.type === "toolCall")
					: [];
				if (toolCalls.length > 0) {
					const toolNames = toolCalls.map((c: any) => c.name).join(", ");
					extra = ` [tools: ${toolNames}]`;
				}
				// Include thinking blocks in size
				const thinkingBlocks = Array.isArray(msg.content)
					? msg.content.filter((c: any) => c?.type === "thinking")
					: [];
				const thinkingChars = thinkingBlocks.reduce(
					(sum: number, c: any) => sum + (c.thinking?.length ?? 0),
					0,
				);
				if (thinkingChars > 0) {
					extra += ` [thinking: ${formatBytes(thinkingChars)}]`;
				}
				break;
			}
			case "toolResult": {
				const toolName = msg.toolName ?? "unknown";
				label = `Tool Result (${toolName})`;
				role = "toolResult";
				break;
			}
			default:
				label = msg.role;
				role = msg.role;
		}

		// Full serialized size of the message (more accurate for images, tool args, etc.)
		const serialized = JSON.stringify(msg);
		const chars = serialized.length;
		const tokens = estimateTokens(serialized);
		totalChars += chars;
		totalTokens += tokens;

		// Check for images
		const images = Array.isArray(msg.content)
			? msg.content.filter((c: any) => c?.type === "image")
			: [];
		if (images.length > 0) {
			extra += ` [${images.length} image(s)]`;
		}

		messageSections.push({
			label: label + extra,
			role,
			chars,
			tokens,
			preview: truncate(content.replace(/\n/g, " ").trim(), 120),
			details: content || serialized.slice(0, 2000),
			entryId: entry.id,
		});
	}

	return { systemSections, messageSections, totalTokens, totalChars };
}

// ─── Interactive UI component ─────────────────────────────────────────

class ContextInspector {
	private systemSections: ContextSection[];
	private messageSections: ContextSection[];
	private allSections: ContextSection[];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private viewportHeight = 20;
	private expanded = false; // detail view for selected item
	private detailScroll = 0;
	private theme: any;
	private contextUsage: { tokens: number; limit: number; cacheRead: number; cacheWrite: number } | null;
	private totalTokens: number;
	private totalChars: number;

	public onClose?: () => void;

	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		systemSections: ContextSection[],
		messageSections: ContextSection[],
		totalTokens: number,
		totalChars: number,
		theme: any,
		contextUsage: { tokens: number; limit: number; cacheRead: number; cacheWrite: number } | null,
	) {
		this.systemSections = systemSections;
		this.messageSections = messageSections;
		this.allSections = [...systemSections, ...messageSections];
		this.totalTokens = totalTokens;
		this.totalChars = totalChars;
		this.theme = theme;
		this.contextUsage = contextUsage;
	}

	handleInput(data: string): void {
		if (this.expanded) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
				this.expanded = false;
				this.detailScroll = 0;
				this.invalidate();
				return;
			}
			if (matchesKey(data, Key.up) || data === "k") {
				this.detailScroll = Math.max(0, this.detailScroll - 1);
				this.invalidate();
				return;
			}
			if (matchesKey(data, Key.down) || data === "j") {
				this.detailScroll++;
				this.invalidate();
				return;
			}
			if (matchesKey(data, "pageup")) {
				this.detailScroll = Math.max(0, this.detailScroll - this.viewportHeight);
				this.invalidate();
				return;
			}
			if (matchesKey(data, "pagedown")) {
				this.detailScroll += this.viewportHeight;
				this.invalidate();
				return;
			}
			return;
		}

		if (matchesKey(data, Key.escape) || data === "q") {
			this.onClose?.();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.ensureVisible();
				this.invalidate();
			}
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			if (this.selectedIndex < this.allSections.length - 1) {
				this.selectedIndex++;
				this.ensureVisible();
				this.invalidate();
			}
			return;
		}
		if (matchesKey(data, Key.enter) || data === " ") {
			this.expanded = true;
			this.detailScroll = 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, "pageup")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - this.viewportHeight);
			this.ensureVisible();
			this.invalidate();
			return;
		}
		if (matchesKey(data, "pagedown")) {
			this.selectedIndex = Math.min(
				this.allSections.length - 1,
				this.selectedIndex + this.viewportHeight,
			);
			this.ensureVisible();
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.home)) {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.end)) {
			this.selectedIndex = this.allSections.length - 1;
			this.ensureVisible();
			this.invalidate();
			return;
		}
	}

	private ensureVisible(): void {
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + this.viewportHeight) {
			this.scrollOffset = this.selectedIndex - this.viewportHeight + 1;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const t = this.theme;
		const lines: string[] = [];

		if (this.expanded) {
			this.cachedLines = this.renderDetail(width);
			this.cachedWidth = width;
			return this.cachedLines;
		}

		// ─── Header ───────────────────────────────────────────
		lines.push(t.fg("accent", "━".repeat(width)));
		lines.push(t.fg("accent", t.bold("  📋 Context Inspector")));
		lines.push("");

		// ─── Usage summary bar ────────────────────────────────
		if (this.contextUsage) {
			const { tokens, limit, cacheRead, cacheWrite } = this.contextUsage;
			const fraction = limit > 0 ? tokens / limit : 0;
			const barWidth = Math.min(40, width - 30);

			lines.push(
				`  ${bar(fraction, barWidth, t)} ${t.fg("text", formatTokens(tokens))}/${t.fg("dim", formatTokens(limit))} ${t.fg("dim", `(${(fraction * 100).toFixed(1)}%)`)}`,
			);

			const cacheInfo: string[] = [];
			if (cacheRead > 0) cacheInfo.push(t.fg("success", `cache read: ${formatTokens(cacheRead)}`));
			if (cacheWrite > 0) cacheInfo.push(t.fg("warning", `cache write: ${formatTokens(cacheWrite)}`));
			if (cacheInfo.length > 0) {
				lines.push(`  ${cacheInfo.join("  ")}`);
			}
		} else {
			lines.push(`  ${t.fg("dim", "Estimated")} ~${t.fg("text", formatTokens(this.totalTokens))} tokens  ${t.fg("dim", formatBytes(this.totalChars))}`);
		}
		lines.push("");

		// ─── Section counts ───────────────────────────────────
		const sysTokens = this.systemSections.reduce((s, sec) => s + sec.tokens, 0);
		const msgTokens = this.messageSections.reduce((s, sec) => s + sec.tokens, 0);
		lines.push(
			`  ${t.fg("accent", "System:")} ~${formatTokens(sysTokens)} tokens (${this.systemSections.length} section${this.systemSections.length !== 1 ? "s" : ""})` +
				`    ${t.fg("accent", "Messages:")} ~${formatTokens(msgTokens)} tokens (${this.messageSections.length} message${this.messageSections.length !== 1 ? "s" : ""})`,
		);
		lines.push("");
		lines.push(t.fg("dim", "─".repeat(width)));

		// ─── System prompt sections ───────────────────────────
		if (this.systemSections.length > 0) {
			lines.push(t.fg("accent", t.bold("  SYSTEM PROMPT")));
		}

		const headerLineCount = lines.length;
		// Calculate viewport: terminal likely ~30–50 lines, leave room for header + footer
		this.viewportHeight = Math.max(5, 30 - headerLineCount - 3);

		const startSys = 0;
		const endSys = this.systemSections.length;
		const startMsg = endSys;

		// Render visible items
		const visStart = this.scrollOffset;
		const visEnd = Math.min(this.allSections.length, this.scrollOffset + this.viewportHeight);

		for (let i = visStart; i < visEnd; i++) {
			// Section header for messages transition
			if (i === startMsg && i >= visStart) {
				lines.push("");
				lines.push(t.fg("accent", t.bold("  MESSAGES")));
			}

			const sec = this.allSections[i]!;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? t.fg("accent", " ▸ ") : "   ";

			const roleColor = this.roleColor(sec.role);
			const labelStr = t.fg(roleColor, sec.label);
			const sizeStr = t.fg("dim", `~${formatTokens(sec.tokens)}tok ${formatBytes(sec.chars)}`);

			const mainLine = `${prefix}${labelStr}  ${sizeStr}`;
			lines.push(truncateToWidth(mainLine, width));

			// Show preview for selected item
			if (isSelected && sec.preview) {
				const previewLine = `     ${t.fg("muted", sec.preview)}`;
				lines.push(truncateToWidth(previewLine, width));
			}
		}

		// ─── Footer ───────────────────────────────────────────
		lines.push("");
		lines.push(t.fg("dim", "─".repeat(width)));

		const scrollInfo =
			this.allSections.length > this.viewportHeight
				? t.fg("dim", ` ${visStart + 1}-${visEnd}/${this.allSections.length}`)
				: "";
		lines.push(
			t.fg("dim", "  ↑↓/jk navigate • enter/space inspect • q/esc close") + scrollInfo,
		);
		lines.push(t.fg("accent", "━".repeat(width)));

		this.cachedLines = lines;
		this.cachedWidth = width;
		return lines;
	}

	private renderDetail(width: number): string[] {
		const t = this.theme;
		const sec = this.allSections[this.selectedIndex]!;
		const lines: string[] = [];

		lines.push(t.fg("accent", "━".repeat(width)));
		lines.push(
			t.fg("accent", t.bold(`  🔍 ${sec.label}`)) +
				`  ${t.fg("dim", `~${formatTokens(sec.tokens)} tokens  ${formatBytes(sec.chars)}`)}`,
		);
		lines.push(t.fg("dim", "─".repeat(width)));

		// Render detail content with scrolling
		const detail = sec.details ?? sec.preview;
		const detailLines = detail.split("\n").flatMap((line) => {
			// Wrap long lines
			if (visibleWidth(line) <= width - 4) return [`  ${line}`];
			const wrapped: string[] = [];
			let remaining = line;
			while (remaining.length > 0) {
				wrapped.push(`  ${remaining.slice(0, width - 4)}`);
				remaining = remaining.slice(width - 4);
			}
			return wrapped;
		});

		const maxScroll = Math.max(0, detailLines.length - this.viewportHeight);
		if (this.detailScroll > maxScroll) this.detailScroll = maxScroll;

		const visibleLines = detailLines.slice(
			this.detailScroll,
			this.detailScroll + this.viewportHeight + 10,
		);
		for (const line of visibleLines) {
			lines.push(truncateToWidth(line, width));
		}

		lines.push("");
		lines.push(t.fg("dim", "─".repeat(width)));
		const scrollInfo =
			detailLines.length > this.viewportHeight + 10
				? t.fg("dim", ` line ${this.detailScroll + 1}/${detailLines.length}`)
				: "";
		lines.push(
			t.fg("dim", "  ↑↓/jk scroll • enter/esc/q back") + scrollInfo,
		);
		lines.push(t.fg("accent", "━".repeat(width)));

		return lines;
	}

	private roleColor(role: string): string {
		switch (role) {
			case "system":
				return "accent";
			case "user":
				return "success";
			case "assistant":
				return "text";
			case "toolResult":
				return "warning";
			case "compaction":
				return "muted";
			case "branchSummary":
				return "muted";
			case "custom":
				return "dim";
			default:
				return "text";
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ─── Extension entry point ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let latestEffectiveSystemPrompt: string | undefined;

	pi.on("agent_start", (_event, ctx) => {
		latestEffectiveSystemPrompt = ctx.getSystemPrompt();
	});

	pi.on("session_tree", () => {
		latestEffectiveSystemPrompt = undefined;
	});

	pi.on("session_shutdown", () => {
		latestEffectiveSystemPrompt = undefined;
	});

	pi.registerCommand("context", {
		description: "Inspect the model's context window — system prompt, messages, tokens, cache",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Context inspector requires interactive mode", "warning");
				return;
			}

			const systemPrompt = latestEffectiveSystemPrompt ?? ctx.getSystemPrompt();
			const { systemSections, messageSections, totalTokens, totalChars } = buildSections(
				ctx,
				systemPrompt,
			);

			// Get real context usage if available
			const rawUsage = ctx.getContextUsage();
			const contextUsage = rawUsage
				? {
						tokens: rawUsage.tokens,
						limit: (ctx.model as any)?.contextWindow ?? 0,
						cacheRead: (rawUsage as any).cacheRead ?? 0,
						cacheWrite: (rawUsage as any).cacheWrite ?? 0,
					}
				: null;

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const inspector = new ContextInspector(
					systemSections,
					messageSections,
					totalTokens,
					totalChars,
					theme,
					contextUsage,
				);
				inspector.onClose = () => done(undefined);

				return {
					render: (w: number) => inspector.render(w),
					invalidate: () => inspector.invalidate(),
					handleInput: (data: string) => inspector.handleInput(data),
				};
			});
		},
	});
}

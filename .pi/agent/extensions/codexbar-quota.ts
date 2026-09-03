import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CODEXBAR_QUOTA_EVENT = "codexbar:quota";
export const CODEXBAR_QUOTA_REFRESH_MS = 2 * 60 * 1_000;
export const CODEXBAR_QUOTA_TIMEOUT_MS = 20_000;

const MAX_JSON_BYTES = 512 * 1_024;
const MAX_ACCOUNTS = 8;
const MAX_WINDOWS_PER_ACCOUNT = 3;

export type CodexBarQuotaProvider = "codex" | "claude";

export interface CodexQuotaWindow {
	readonly label: string;
	readonly remainingPercent: number;
}

export interface CodexAccountQuota {
	readonly windows: readonly CodexQuotaWindow[];
}

export interface CodexBarQuotaUpdate {
	readonly provider: CodexBarQuotaProvider;
	readonly accounts: readonly CodexAccountQuota[];
}

export interface CodexBarCommandResult {
	readonly stdout: string;
	readonly code: number;
	readonly killed?: boolean;
}

export interface QuotaRefreshPort {
	exec(
		command: string,
		args: readonly string[],
		options: { signal: AbortSignal; timeout: number },
	): Promise<CodexBarCommandResult>;
	publish(update: CodexBarQuotaUpdate): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function quotaWindowLabel(windowMinutes: number | undefined, fallback: string): string {
	if (windowMinutes === undefined || windowMinutes <= 0) return fallback;
	if (windowMinutes === 10_080) return "wk";
	if (windowMinutes === 43_200 || windowMinutes === 44_640) return "mo";
	if (windowMinutes % 1_440 === 0) return `${windowMinutes / 1_440}d`;
	if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`;
	return `${Math.round(windowMinutes)}m`;
}

function parseQuotaWindow(value: unknown, fallbackLabel: string): CodexQuotaWindow | undefined {
	if (!isRecord(value)) return undefined;
	const usedPercent = finiteNumber(value.usedPercent);
	if (usedPercent === undefined) return undefined;
	const remainingPercent = Math.round(100 - Math.max(0, Math.min(100, usedPercent)));
	return {
		label: quotaWindowLabel(finiteNumber(value.windowMinutes), fallbackLabel),
		remainingPercent,
	};
}

function uniqueWindows(windows: readonly (CodexQuotaWindow | undefined)[]): CodexQuotaWindow[] {
	const selected: CodexQuotaWindow[] = [];
	const labels = new Set<string>();
	for (const window of windows) {
		if (window === undefined || labels.has(window.label)) continue;
		labels.add(window.label);
		selected.push(window);
		if (selected.length === MAX_WINDOWS_PER_ACCOUNT) break;
	}
	return selected;
}

function parseAccountQuota(value: unknown, provider: CodexBarQuotaProvider): CodexAccountQuota | undefined {
	if (!isRecord(value) || value.provider !== provider) return undefined;
	const usage = isRecord(value.usage) ? value.usage : {};
	const dashboard = provider === "codex" && isRecord(value.openaiDashboard) ? value.openaiDashboard : {};
	const windows = uniqueWindows([
		parseQuotaWindow(usage.primary, "session") ?? parseQuotaWindow(dashboard.primaryLimit, "session"),
		parseQuotaWindow(usage.secondary, "wk") ?? parseQuotaWindow(dashboard.secondaryLimit, "wk"),
		parseQuotaWindow(usage.tertiary, "extra"),
	]);
	if (windows.length === 0) return undefined;
	return { windows };
}

/** Parse bounded quota-only data for one CodexBar provider. Account identity is never copied. */
export function parseCodexBarQuotas(
	stdout: string,
	provider: CodexBarQuotaProvider = "codex",
): CodexAccountQuota[] {
	if (Buffer.byteLength(stdout, "utf8") > MAX_JSON_BYTES) return [];
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return [];
	}
	if (!Array.isArray(payload)) return [];

	const accounts: CodexAccountQuota[] = [];
	for (let index = 0; index < payload.length && index < MAX_ACCOUNTS; index += 1) {
		const account = parseAccountQuota(payload[index], provider);
		if (account !== undefined) accounts.push(account);
	}
	return accounts;
}

function providerArgs(provider: CodexBarQuotaProvider): string[] {
	return [
		"usage",
		"--provider",
		provider,
		...(provider === "codex" ? ["--all-accounts"] : []),
		"--format",
		"json",
		"--json-only",
		"--no-credits",
	];
}

/** Refresh one provider. Failed CLI calls leave that provider's last good value intact. */
export async function refreshCodexBarQuota(
	port: QuotaRefreshPort,
	provider: CodexBarQuotaProvider,
	signal: AbortSignal,
): Promise<boolean> {
	let result: CodexBarCommandResult;
	try {
		result = await port.exec("codexbar", providerArgs(provider), {
			signal,
			timeout: CODEXBAR_QUOTA_TIMEOUT_MS,
		});
	} catch {
		return false;
	}
	if (signal.aborted || result.killed || result.code !== 0) return false;
	port.publish({ provider, accounts: parseCodexBarQuotas(result.stdout, provider) });
	return true;
}

export default function codexBarQuota(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let controller: AbortController | undefined;
	let generation = 0;
	let inFlight = false;

	const stop = (): void => {
		generation += 1;
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
		controller?.abort();
		controller = undefined;
		inFlight = false;
	};

	pi.on("session_start", (_event, ctx) => {
		stop();
		if (ctx.mode !== "tui") return;
		const sessionGeneration = generation;
		const port: QuotaRefreshPort = {
			exec: (command, args, options) => pi.exec(command, [...args], options),
			publish: (update) => pi.events.emit(CODEXBAR_QUOTA_EVENT, update),
		};

		const refresh = (): void => {
			if (inFlight || sessionGeneration !== generation) return;
			inFlight = true;
			const nextController = new AbortController();
			controller = nextController;
			void Promise.all([
				refreshCodexBarQuota(port, "codex", nextController.signal),
				refreshCodexBarQuota(port, "claude", nextController.signal),
			]).finally(() => {
				if (controller === nextController) controller = undefined;
				if (sessionGeneration === generation) inFlight = false;
			});
		};

		refresh();
		timer = setInterval(refresh, CODEXBAR_QUOTA_REFRESH_MS);
	});

	pi.on("session_shutdown", () => {
		stop();
		pi.events.emit(CODEXBAR_QUOTA_EVENT, { provider: "codex", accounts: [] });
		pi.events.emit(CODEXBAR_QUOTA_EVENT, { provider: "claude", accounts: [] });
	});
}

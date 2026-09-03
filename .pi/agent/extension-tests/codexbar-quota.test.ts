import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codexBarQuota, {
	CODEXBAR_QUOTA_EVENT,
	CODEXBAR_QUOTA_TIMEOUT_MS,
	parseCodexBarQuotas,
	refreshCodexBarQuota,
	type CodexBarQuotaProvider,
} from "../extensions/codexbar-quota.ts";

function codexAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		provider: "codex",
		source: "oauth",
		account: "alice.long.account@example.com",
		openaiDashboard: {
			primaryLimit: { usedPercent: 12.4, windowMinutes: 300 },
			secondaryLimit: { usedPercent: 34.6, windowMinutes: 10_080 },
		},
		usage: {
			primary: null,
			secondary: { usedPercent: 34.6, windowMinutes: 10_080 },
			tertiary: null,
		},
		...overrides,
	};
}

function claudeAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		provider: "claude",
		source: "web",
		account: "claude.user@example.com",
		usage: {
			primary: { usedPercent: 10, windowMinutes: 300 },
			secondary: { usedPercent: 25, windowMinutes: 10_080 },
			tertiary: null,
		},
		...overrides,
	};
}

describe("CodexBar quota parsing", () => {
	test("reads all visible Codex accounts, converts quota to percent left, and omits identity", () => {
		const quotas = parseCodexBarQuotas(
			JSON.stringify([
				codexAccount(),
				codexAccount({
					account: "bob@example.com",
					usage: {
						primary: { usedPercent: 90, windowMinutes: 300 },
						secondary: { usedPercent: 2, windowMinutes: 10_080 },
						tertiary: { usedPercent: 50, windowMinutes: 1_440 },
					},
				}),
			]),
		);

		expect(quotas).toEqual([
			{
				windows: [
					{ label: "5h", remainingPercent: 88 },
					{ label: "wk", remainingPercent: 65 },
				],
			},
			{
				windows: [
					{ label: "5h", remainingPercent: 10 },
					{ label: "wk", remainingPercent: 98 },
					{ label: "1d", remainingPercent: 50 },
				],
			},
		]);
		expect(JSON.stringify(quotas)).not.toContain("alice");
		expect(JSON.stringify(quotas)).not.toContain("bob");
		expect(JSON.stringify(quotas)).not.toContain("example.com");
	});

	test("parses Claude session and weekly quotas without copying its email", () => {
		const quotas = parseCodexBarQuotas(JSON.stringify([claudeAccount()]), "claude");

		expect(quotas).toEqual([
			{
				windows: [
					{ label: "5h", remainingPercent: 90 },
					{ label: "wk", remainingPercent: 75 },
				],
			},
		]);
		expect(JSON.stringify(quotas)).not.toContain("claude.user");
	});

	test("uses normalized usage first and Codex dashboard limits as a fallback", () => {
		const [quota] = parseCodexBarQuotas(
			JSON.stringify([
				codexAccount({
					usage: {
						accountEmail: "normalized@example.com",
						primary: { usedPercent: 25, windowMinutes: 60 },
						secondary: null,
						tertiary: null,
					},
					account: undefined,
				}),
			]),
		);

		expect(quota).toEqual({
			windows: [
				{ label: "1h", remainingPercent: 75 },
				{ label: "wk", remainingPercent: 65 },
			],
		});
	});

	test("clamps percentages, removes duplicate windows, and rejects other providers", () => {
		const [quota] = parseCodexBarQuotas(
			JSON.stringify([
				codexAccount({
					usage: {
						primary: { usedPercent: -20, windowMinutes: 300 },
						secondary: { usedPercent: 400, windowMinutes: 300 },
						tertiary: null,
					},
				}),
			]),
		);

		expect(quota).toEqual({ windows: [{ label: "5h", remainingPercent: 100 }] });
		expect(parseCodexBarQuotas(JSON.stringify([claudeAccount()]), "codex")).toEqual([]);
	});

	test("rejects malformed and oversized output", () => {
		expect(parseCodexBarQuotas("not json")).toEqual([]);
		expect(parseCodexBarQuotas(JSON.stringify({ provider: "codex" }))).toEqual([]);
		expect(
			parseCodexBarQuotas(JSON.stringify([codexAccount({ usage: {}, openaiDashboard: {} })])),
		).toEqual([]);
		expect(parseCodexBarQuotas(` ${"x".repeat(512 * 1_024)}`)).toEqual([]);
	});
});

describe("CodexBar quota refresh", () => {
	for (const provider of ["codex", "claude"] as const) {
		test(`runs the ${provider} CLI query and publishes quota-only data`, async () => {
			const calls: Array<{ command: string; args: readonly string[]; timeout: number }> = [];
			const published: unknown[] = [];
			const fixture = provider === "codex" ? codexAccount() : claudeAccount();

			const refreshed = await refreshCodexBarQuota(
				{
					async exec(command, args, options) {
						calls.push({ command, args, timeout: options.timeout });
						return { stdout: JSON.stringify([fixture]), code: 0, killed: false };
					},
					publish(update) {
						published.push(update);
					},
				},
				provider,
				new AbortController().signal,
			);

			expect(refreshed).toBe(true);
			expect(calls[0]?.command).toBe("codexbar");
			expect(calls[0]?.args).toContain("--provider");
			expect(calls[0]?.args).toContain(provider);
			expect(calls[0]?.args.includes("--all-accounts")).toBe(provider === "codex");
			expect(calls[0]?.timeout).toBe(CODEXBAR_QUOTA_TIMEOUT_MS);
			expect(published).toHaveLength(1);
			expect((published[0] as { provider: string }).provider).toBe(provider);
			expect(JSON.stringify(published)).not.toContain("example.com");
		});
	}

	test("leaves the last good quota intact when a command fails or is aborted", async () => {
		for (const result of [
			{ stdout: "", code: 1, killed: false },
			{ stdout: "[]", code: 0, killed: true },
		]) {
			const published: unknown[] = [];
			const refreshed = await refreshCodexBarQuota(
				{
					exec: async () => result,
					publish: (update) => published.push(update),
				},
				"codex",
				new AbortController().signal,
			);
			expect(refreshed).toBe(false);
			expect(published).toEqual([]);
		}

		const controller = new AbortController();
		controller.abort();
		const published: unknown[] = [];
		expect(
			await refreshCodexBarQuota(
				{
					exec: async () => ({ stdout: "[]", code: 0, killed: false }),
					publish: (update) => published.push(update),
				},
				"claude",
				controller.signal,
			),
		).toBe(false);
		expect(published).toEqual([]);
	});

	test("refreshes both providers in TUI mode and clears both on shutdown", async () => {
		type Handler = (event: unknown, ctx: unknown) => unknown;
		const handlers = new Map<string, Handler>();
		const published: Array<{ channel: string; data: unknown }> = [];
		const pi = {
			on(event: string, handler: Handler) {
				handlers.set(event, handler);
			},
			events: {
				emit(channel: string, data: unknown) {
					published.push({ channel, data });
				},
			},
			exec: async (_command: string, args: string[]) => {
				const provider = args[args.indexOf("--provider") + 1] as CodexBarQuotaProvider;
				const fixture = provider === "codex" ? codexAccount() : claudeAccount();
				return { stdout: JSON.stringify([fixture]), stderr: "", code: 0, killed: false };
			},
		};
		codexBarQuota(pi as unknown as ExtensionAPI);

		handlers.get("session_start")?.({}, { mode: "tui" });
		for (let attempt = 0; attempt < 20 && published.length < 2; attempt += 1) await Bun.sleep(1);
		expect(
			published
				.map(({ data }) => (data as { provider: string }).provider)
				.sort(),
		).toEqual(["claude", "codex"]);

		handlers.get("session_shutdown")?.({}, { mode: "tui" });
		expect(published.slice(-2)).toEqual([
			{ channel: CODEXBAR_QUOTA_EVENT, data: { provider: "codex", accounts: [] } },
			{ channel: CODEXBAR_QUOTA_EVENT, data: { provider: "claude", accounts: [] } },
		]);
	});
});

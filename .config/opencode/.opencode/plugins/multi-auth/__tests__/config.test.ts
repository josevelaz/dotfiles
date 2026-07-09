import { describe, expect, test } from "bun:test"
import {
	ConfigError,
	DEFAULT_COOLDOWN_SECONDS,
	DEFAULT_MAX_ATTEMPTS_PER_REQUEST,
	DEFAULT_MAX_COOLDOWN_SECONDS,
	DEFAULT_MAX_REPLAY_BODY_BYTES,
	DEFAULT_NOTIFY,
	DEFAULT_REFRESH_SKEW_SECONDS,
	DEFAULT_RETRY_ON,
	DEFAULT_STICKY_WITHIN_SESSION,
	UNKNOWN_ACCOUNT_PRIORITY_BASE,
	effectivePriority,
	parseConfig,
	type ProviderConfig,
	type ResolvedConfig,
} from "../config"

describe("parseConfig", () => {
	test("empty/missing config → sensible defaults, no providers enabled", () => {
		expect(parseConfig(undefined)).toEqual({ providers: {} })
		expect(parseConfig(null)).toEqual({ providers: {} })
		expect(parseConfig({})).toEqual({ providers: {} })
		expect(parseConfig({ providers: {} })).toEqual({ providers: {} })
	})

	test("full valid config parses to expected resolved values", () => {
		const raw = {
			providers: {
				anthropic: {
					enabled: true,
					accounts: [
						{ label: "work-max", priority: 1 },
						{ label: "personal-pro", priority: 2, disabled: false },
					],
					defaultCooldownSeconds: 300,
					maxCooldownSeconds: 18000,
					refreshSkewSeconds: 120,
					stickyWithinSession: true,
					failover: {
						maxAttemptsPerRequest: 3,
						retryOn: ["quota", "rate_limit"],
						maxReplayBodyBytes: 10485760,
						notify: "toast",
					},
				},
			},
		}

		const resolved = parseConfig(raw)
		expect(resolved).toEqual({
			providers: {
				anthropic: {
					enabled: true,
					accounts: [
						{ label: "work-max", priority: 1, disabled: false },
						{ label: "personal-pro", priority: 2, disabled: false },
					],
					defaultCooldownSeconds: 300,
					maxCooldownSeconds: 18000,
					refreshSkewSeconds: 120,
					stickyWithinSession: true,
					failover: {
						maxAttemptsPerRequest: 3,
						retryOn: ["quota", "rate_limit"],
						maxReplayBodyBytes: 10485760,
						notify: "toast",
					},
				},
			},
		} satisfies ResolvedConfig)
	})

	test("defaults every optional field on a minimal provider entry", () => {
		const resolved = parseConfig({
			providers: {
				anthropic: {},
			},
		})

		expect(resolved.providers.anthropic).toEqual({
			enabled: true,
			accounts: [],
			defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
			maxCooldownSeconds: DEFAULT_MAX_COOLDOWN_SECONDS,
			refreshSkewSeconds: DEFAULT_REFRESH_SKEW_SECONDS,
			stickyWithinSession: DEFAULT_STICKY_WITHIN_SESSION,
			failover: {
				maxAttemptsPerRequest: DEFAULT_MAX_ATTEMPTS_PER_REQUEST,
				retryOn: [...DEFAULT_RETRY_ON],
				maxReplayBodyBytes: DEFAULT_MAX_REPLAY_BODY_BYTES,
				notify: DEFAULT_NOTIFY,
			},
		})
	})

	test("defaults account.disabled to false when omitted", () => {
		const resolved = parseConfig({
			providers: {
				anthropic: {
					accounts: [{ label: "only", priority: 1 }],
				},
			},
		})
		expect(resolved.providers.anthropic!.accounts[0]!.disabled).toBe(false)
	})

	test("defaults failover when omitted", () => {
		const resolved = parseConfig({
			providers: {
				anthropic: {
					enabled: false,
					stickyWithinSession: false,
				},
			},
		})
		expect(resolved.providers.anthropic!.enabled).toBe(false)
		expect(resolved.providers.anthropic!.stickyWithinSession).toBe(false)
		expect(resolved.providers.anthropic!.failover.notify).toBe("toast")
		expect(resolved.providers.anthropic!.failover.maxReplayBodyBytes).toBe(
			DEFAULT_MAX_REPLAY_BODY_BYTES,
		)
	})

	test("accepts notify modes toast | log | silent", () => {
		for (const notify of ["toast", "log", "silent"] as const) {
			const resolved = parseConfig({
				providers: {
					anthropic: { failover: { notify } },
				},
			})
			expect(resolved.providers.anthropic!.failover.notify).toBe(notify)
		}
	})
})

describe("parseConfig invalid config", () => {
	test("wrong root type", () => {
		expect(() => parseConfig("nope")).toThrow(ConfigError)
		expect(() => parseConfig("nope")).toThrow(/expected object/)
	})

	test("providers wrong type includes key path", () => {
		expect(() => parseConfig({ providers: [] })).toThrow(/providers:/)
		expect(() => parseConfig({ providers: "x" })).toThrow(/providers:/)
	})

	test("provider wrong type includes key path", () => {
		expect(() => parseConfig({ providers: { anthropic: 1 } })).toThrow(
			/providers\.anthropic:/,
		)
	})

	test("negative numbers include key path", () => {
		expect(() =>
			parseConfig({
				providers: { anthropic: { defaultCooldownSeconds: -1 } },
			}),
		).toThrow(/providers\.anthropic\.defaultCooldownSeconds/)

		expect(() =>
			parseConfig({
				providers: { anthropic: { maxCooldownSeconds: -5 } },
			}),
		).toThrow(/providers\.anthropic\.maxCooldownSeconds/)

		expect(() =>
			parseConfig({
				providers: { anthropic: { refreshSkewSeconds: -1 } },
			}),
		).toThrow(/providers\.anthropic\.refreshSkewSeconds/)

		expect(() =>
			parseConfig({
				providers: {
					anthropic: { failover: { maxAttemptsPerRequest: 0 } },
				},
			}),
		).toThrow(/providers\.anthropic\.failover\.maxAttemptsPerRequest/)

		expect(() =>
			parseConfig({
				providers: {
					anthropic: { failover: { maxReplayBodyBytes: -1 } },
				},
			}),
		).toThrow(/providers\.anthropic\.failover\.maxReplayBodyBytes/)
	})

	test("bad notify value includes key path", () => {
		expect(() =>
			parseConfig({
				providers: {
					anthropic: { failover: { notify: "email" } },
				},
			}),
		).toThrow(/providers\.anthropic\.failover\.notify/)
		expect(() =>
			parseConfig({
				providers: {
					anthropic: { failover: { notify: "email" } },
				},
			}),
		).toThrow(/toast \| log \| silent/)
	})

	test("bad retryOn value includes key path", () => {
		expect(() =>
			parseConfig({
				providers: {
					anthropic: { failover: { retryOn: ["auth"] } },
				},
			}),
		).toThrow(/providers\.anthropic\.failover\.retryOn\[0\]/)
	})

	test("wrong boolean type includes key path", () => {
		expect(() =>
			parseConfig({
				providers: { anthropic: { enabled: "yes" } },
			}),
		).toThrow(/providers\.anthropic\.enabled/)
	})

	test("account missing label/priority includes key path", () => {
		expect(() =>
			parseConfig({
				providers: {
					anthropic: { accounts: [{ priority: 1 }] },
				},
			}),
		).toThrow(/providers\.anthropic\.accounts\[0\]\.label/)

		expect(() =>
			parseConfig({
				providers: {
					anthropic: { accounts: [{ label: "a" }] },
				},
			}),
		).toThrow(/providers\.anthropic\.accounts\[0\]\.priority/)
	})

	test("empty account label includes key path", () => {
		expect(() =>
			parseConfig({
				providers: {
					anthropic: { accounts: [{ label: "", priority: 1 }] },
				},
			}),
		).toThrow(/providers\.anthropic\.accounts\[0\]\.label/)
	})
})

describe("parseConfig duplicate labels and priorities", () => {
	test("duplicate labels → error with key path", () => {
		expect(() =>
			parseConfig({
				providers: {
					anthropic: {
						accounts: [
							{ label: "work", priority: 1 },
							{ label: "work", priority: 2 },
						],
					},
				},
			}),
		).toThrow(/providers\.anthropic\.accounts\[1\]\.label/)
		expect(() =>
			parseConfig({
				providers: {
					anthropic: {
						accounts: [
							{ label: "work", priority: 1 },
							{ label: "work", priority: 2 },
						],
					},
				},
			}),
		).toThrow(/duplicate account label "work"/)
	})

	test("duplicate priorities → OK", () => {
		const resolved = parseConfig({
			providers: {
				anthropic: {
					accounts: [
						{ label: "a", priority: 1 },
						{ label: "b", priority: 1 },
					],
				},
			},
		})
		expect(resolved.providers.anthropic!.accounts.map((a) => a.priority)).toEqual([1, 1])
	})
})

describe("effectivePriority", () => {
	const provider: ProviderConfig = {
		enabled: true,
		accounts: [
			{ label: "work-max", priority: 1, disabled: false },
			{ label: "personal-pro", priority: 2, disabled: false },
		],
		defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
		maxCooldownSeconds: DEFAULT_MAX_COOLDOWN_SECONDS,
		refreshSkewSeconds: DEFAULT_REFRESH_SKEW_SECONDS,
		stickyWithinSession: true,
		failover: {
			maxAttemptsPerRequest: DEFAULT_MAX_ATTEMPTS_PER_REQUEST,
			retryOn: [...DEFAULT_RETRY_ON],
			maxReplayBodyBytes: DEFAULT_MAX_REPLAY_BODY_BYTES,
			notify: DEFAULT_NOTIFY,
		},
	}

	test("configured account uses config priority", () => {
		expect(effectivePriority("work-max", provider, 99)).toBe(1)
		expect(effectivePriority("personal-pro", provider, 0)).toBe(2)
	})

	test("store-account-without-config gets fallback priority 100+index", () => {
		expect(effectivePriority("unknown-from-store", provider, 0)).toBe(
			UNKNOWN_ACCOUNT_PRIORITY_BASE + 0,
		)
		expect(effectivePriority("another", provider, 3)).toBe(UNKNOWN_ACCOUNT_PRIORITY_BASE + 3)
		expect(effectivePriority("another", provider, 3)).toBe(103)
	})
})

describe("F1: origin allowlist / redirect keys stripped", () => {
	test("allowedOrigins / apiOrigins / followRedirects have no effect on resolved config", () => {
		const resolved = parseConfig({
			allowedOrigins: ["https://evil.example"],
			apiOrigins: ["https://evil.example"],
			followRedirects: true,
			redirect: "follow",
			providers: {
				anthropic: {
					allowedOrigins: ["https://evil.example"],
					apiOrigins: ["https://api.evil"],
					followRedirects: true,
					redirectPolicy: "follow",
					originAllowlist: ["*"],
					enabled: true,
					accounts: [{ label: "a", priority: 1 }],
					failover: {
						allowedOrigins: ["https://evil.example"],
						followRedirects: true,
						notify: "log",
					},
				},
			},
		})

		// Resolved shape has only known fields — no origin/redirect keys
		const json = JSON.stringify(resolved)
		expect(json).not.toContain("allowedOrigins")
		expect(json).not.toContain("apiOrigins")
		expect(json).not.toContain("followRedirects")
		expect(json).not.toContain("redirectPolicy")
		expect(json).not.toContain("originAllowlist")
		expect(json).not.toContain("evil.example")

		// And the type-level surface is only the known keys
		const provider = resolved.providers.anthropic!
		expect(Object.keys(provider).sort()).toEqual(
			[
				"accounts",
				"defaultCooldownSeconds",
				"enabled",
				"failover",
				"maxCooldownSeconds",
				"refreshSkewSeconds",
				"stickyWithinSession",
			].sort(),
		)
		expect(Object.keys(provider.failover).sort()).toEqual(
			["maxAttemptsPerRequest", "maxReplayBodyBytes", "notify", "retryOn"].sort(),
		)
		expect(provider.failover.notify).toBe("log")
		expect(provider.enabled).toBe(true)
	})
})

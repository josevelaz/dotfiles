/**
 * Fixture-driven tests for multi-auth exhaustion detection.
 */
import { describe, expect, test } from "bun:test"
import * as path from "node:path"
import {
	DEFAULT_COOLDOWN_SECONDS,
	DEFAULT_MAX_COOLDOWN_SECONDS,
} from "../config"
import {
	anthropicRefinement,
	classify,
	classifyAnthropic,
	exponentialCooldownSeconds,
	getHeader,
	parseAnthropicResetAtMs,
	parseResetTimestamp,
	parseRetryAfterSeconds,
	type Classification,
	type ResponseLike,
} from "../detect"

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURES = path.join(import.meta.dir, "fixtures")

async function loadFixture(name: string): Promise<ResponseLike> {
	const file = Bun.file(path.join(FIXTURES, name))
	const data = (await file.json()) as {
		status: number
		headers?: Record<string, string>
		body?: unknown
	}
	return {
		status: data.status,
		headers: data.headers ?? {},
		body: data.body,
	}
}

function asExhausted(c: Classification) {
	expect(c.kind).toBe("exhausted")
	if (c.kind !== "exhausted") throw new Error("expected exhausted")
	return c
}

// ---------------------------------------------------------------------------
// parse helpers
// ---------------------------------------------------------------------------

describe("parseRetryAfterSeconds", () => {
	const now = Date.UTC(2025, 0, 1, 12, 0, 0) // 2025-01-01T12:00:00Z

	test("integer seconds", () => {
		expect(parseRetryAfterSeconds("30", now)).toBe(30)
		expect(parseRetryAfterSeconds("0", now)).toBe(0)
		expect(parseRetryAfterSeconds(" 45 ", now)).toBe(45)
	})

	test("HTTP-date relative to now", () => {
		// 90 seconds after `now`
		const date = new Date(now + 90_000).toUTCString()
		expect(parseRetryAfterSeconds(date, now)).toBe(90)
	})

	test("HTTP-date in the past → 0", () => {
		const date = new Date(now - 60_000).toUTCString()
		expect(parseRetryAfterSeconds(date, now)).toBe(0)
	})

	test("missing / unparseable → null", () => {
		expect(parseRetryAfterSeconds(null, now)).toBeNull()
		expect(parseRetryAfterSeconds("", now)).toBeNull()
		expect(parseRetryAfterSeconds("not-a-date", now)).toBeNull()
	})
})

describe("parseResetTimestamp", () => {
	test("unix epoch seconds", () => {
		expect(parseResetTimestamp("1764554400")).toBe(1764554400 * 1000)
	})

	test("RFC 3339", () => {
		expect(parseResetTimestamp("2025-12-01T02:00:00Z")).toBe(
			Date.parse("2025-12-01T02:00:00Z"),
		)
	})

	test("nullish / garbage → null", () => {
		expect(parseResetTimestamp(null)).toBeNull()
		expect(parseResetTimestamp("nope")).toBeNull()
	})
})

describe("exponentialCooldownSeconds", () => {
	test("grows as 2^trips and caps at max", () => {
		expect(exponentialCooldownSeconds(0, 300, 18000)).toBe(300)
		expect(exponentialCooldownSeconds(1, 300, 18000)).toBe(600)
		expect(exponentialCooldownSeconds(2, 300, 18000)).toBe(1200)
		expect(exponentialCooldownSeconds(3, 300, 18000)).toBe(2400)
		// 300 * 2^6 = 19200 > 18000 → cap
		expect(exponentialCooldownSeconds(6, 300, 18000)).toBe(18000)
		expect(exponentialCooldownSeconds(20, 300, 18000)).toBe(18000)
	})
})

// ---------------------------------------------------------------------------
// Fixture-driven classification
// ---------------------------------------------------------------------------

describe("classify — fixtures", () => {
	test("429 + retry-after → exhausted with cooldownSeconds 30", async () => {
		const res = await loadFixture("429-retry-after.json")
		const now = 1_700_000_000_000
		const result = classifyAnthropic(res, { now })
		const ex = asExhausted(result)
		expect(ex.cooldownSeconds).toBe(30)
		expect(ex.resetAtMs).toBe(now + 30_000)
		expect(ex.reason).toBe("rate_limit")
	})

	test("429 + rate_limit_error body + unified reset → exhausted with precise resetAtMs", async () => {
		const res = await loadFixture("429-rate-limit-error-body.json")
		const now = 1_700_000_000_000
		const result = classifyAnthropic(res, { now })
		const ex = asExhausted(result)
		// Fixture: anthropic-ratelimit-unified-reset = 1764554400
		expect(ex.resetAtMs).toBe(1764554400 * 1000)
		expect(ex.cooldownSeconds).toBe(
			Math.ceil((1764554400 * 1000 - now) / 1000),
		)
		// unified-status rejected → quota (subscription window)
		expect(ex.reason).toBe("quota")
	})

	test("429 weekly-limit message → exhausted reason quota", async () => {
		const res = await loadFixture("429-weekly-limit.json")
		const now = 1_700_000_000_000
		const result = classifyAnthropic(res, { now })
		const ex = asExhausted(result)
		expect(ex.reason).toBe("quota")
		expect(ex.resetAtMs).toBe(1764615600 * 1000)
	})

	test("529 overloaded → transient (NOT exhaustion)", async () => {
		const res = await loadFixture("529-overloaded.json")
		const result = classifyAnthropic(res)
		expect(result).toEqual({ kind: "transient" })
	})

	test("401 justRefreshed=true → needs_reauth; false → auth_stale", async () => {
		const res = await loadFixture("401-after-refresh.json")
		expect(classifyAnthropic(res, { justRefreshed: true })).toEqual({
			kind: "needs_reauth",
		})
		expect(classifyAnthropic(res, { justRefreshed: false })).toEqual({
			kind: "auth_stale",
		})
		expect(classifyAnthropic(res, {})).toEqual({ kind: "auth_stale" })
	})

	test("5xx → transient", async () => {
		const res = await loadFixture("500-server-error.json")
		expect(classifyAnthropic(res)).toEqual({ kind: "transient" })
		expect(classify(res)).toEqual({ kind: "transient" })
	})
})

// ---------------------------------------------------------------------------
// Generic behavior (no refinement)
// ---------------------------------------------------------------------------

describe("classify — generic", () => {
	test("200 → none", () => {
		expect(classify({ status: 200 })).toEqual({ kind: "none" })
	})

	test("403 justRefreshed → needs_reauth", () => {
		expect(classify({ status: 403 }, { justRefreshed: true })).toEqual({
			kind: "needs_reauth",
		})
		expect(classify({ status: 403 }, { justRefreshed: false })).toEqual({
			kind: "auth_stale",
		})
	})

	test("networkError / status 0 → transient", () => {
		expect(classify({ status: 0, networkError: true })).toEqual({
			kind: "transient",
		})
		expect(classify({ status: 0 })).toEqual({ kind: "transient" })
	})

	test("429 without retry-after uses exponential default cooldown", () => {
		const now = 1_700_000_000_000
		const r0 = asExhausted(
			classify(
				{ status: 429 },
				{
					now,
					consecutiveTrips: 0,
					defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
					maxCooldownSeconds: DEFAULT_MAX_COOLDOWN_SECONDS,
				},
			),
		)
		expect(r0.cooldownSeconds).toBe(DEFAULT_COOLDOWN_SECONDS)
		expect(r0.resetAtMs).toBe(now + DEFAULT_COOLDOWN_SECONDS * 1000)

		const r2 = asExhausted(
			classify(
				{ status: 429 },
				{
					now,
					consecutiveTrips: 2,
					defaultCooldownSeconds: 300,
					maxCooldownSeconds: 18000,
				},
			),
		)
		expect(r2.cooldownSeconds).toBe(1200)

		const rCap = asExhausted(
			classify(
				{ status: 429 },
				{
					now,
					consecutiveTrips: 10,
					defaultCooldownSeconds: 300,
					maxCooldownSeconds: 18000,
				},
			),
		)
		expect(rCap.cooldownSeconds).toBe(18000)
	})

	test("429 + retry-after HTTP-date parsed correctly", () => {
		const now = Date.UTC(2025, 5, 15, 10, 0, 0)
		const resetDate = new Date(now + 120_000)
		const result = asExhausted(
			classify(
				{
					status: 429,
					headers: { "retry-after": resetDate.toUTCString() },
				},
				{ now },
			),
		)
		expect(result.cooldownSeconds).toBe(120)
		expect(result.resetAtMs).toBe(now + 120_000)
	})

	test("429 with anthropic refinement uses provider hint when no retry-after", () => {
		const now = 1_700_000_000_000
		const resetEpoch = 1_700_000_600 // seconds
		const result = asExhausted(
			classify(
				{
					status: 429,
					headers: {
						"anthropic-ratelimit-unified-reset": String(resetEpoch),
						"anthropic-ratelimit-unified-status": "rejected",
					},
					body: {
						type: "error",
						error: { type: "rate_limit_error", message: "rate limited" },
					},
				},
				{ now, refinement: anthropicRefinement },
			),
		)
		expect(result.resetAtMs).toBe(resetEpoch * 1000)
		expect(result.reason).toBe("quota")
	})
})

// ---------------------------------------------------------------------------
// Anthropic header helpers
// ---------------------------------------------------------------------------

describe("parseAnthropicResetAtMs", () => {
	test("prefers unified-reset", () => {
		expect(
			parseAnthropicResetAtMs({
				"anthropic-ratelimit-unified-reset": "1764554400",
				"anthropic-ratelimit-requests-reset": "2025-12-01T02:00:00Z",
			}),
		).toBe(1764554400 * 1000)
	})

	test("falls back to RFC3339 requests-reset", () => {
		expect(
			parseAnthropicResetAtMs({
				"anthropic-ratelimit-requests-reset": "2025-12-01T02:00:00Z",
			}),
		).toBe(Date.parse("2025-12-01T02:00:00Z"))
	})

	test("getHeader is case-insensitive", () => {
		expect(getHeader({ "Retry-After": "10" }, "retry-after")).toBe("10")
		expect(getHeader({ "RETRY-AFTER": "10" }, "Retry-After")).toBe("10")
	})
})

describe("anthropicRefinement overloaded body on non-529", () => {
	test("overloaded_error body → transient even if status is 529-shaped only via body", () => {
		// status 503 with overloaded body still transient via refinement
		const result = classify(
			{
				status: 503,
				body: {
					type: "error",
					error: { type: "overloaded_error", message: "Overloaded" },
				},
			},
			{ refinement: anthropicRefinement },
		)
		// Generic already marks 5xx as transient; refinement keeps it
		expect(result).toEqual({ kind: "transient" })
	})
})

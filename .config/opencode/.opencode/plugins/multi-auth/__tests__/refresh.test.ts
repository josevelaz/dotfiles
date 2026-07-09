/**
 * refresh.ts orchestration tests: F4 outcomes, write-then-use, single-flight.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { RefreshResult, TokenSet } from "../adapters/types"
import {
	_resetRefreshMutexesForTests,
	computeBackoffMs,
	refreshAccount,
} from "../refresh"

afterEach(() => {
	_resetRefreshMutexesForTests()
})

function okTokens(n = 1): RefreshResult {
	return {
		outcome: "ok",
		access: `access-${n}`,
		refresh: `refresh-${n}`,
		expires: Date.now() + 3_600_000,
	}
}

describe("computeBackoffMs", () => {
	test("grows with attempt and respects cap", () => {
		const r = () => 0
		expect(computeBackoffMs(0, 50, 2000, r)).toBe(50)
		expect(computeBackoffMs(1, 50, 2000, r)).toBe(100)
		expect(computeBackoffMs(10, 50, 200, r)).toBe(200)
	})
})

describe("refreshAccount — happy path + write-then-use", () => {
	test("persist is invoked BEFORE function resolves with new tokens", async () => {
		const order: string[] = []
		let exposedAccess: string | null = null

		const result = await refreshAccount({
			label: "work-max",
			refreshToken: "rt-old",
			attempt: async () => {
				order.push("attempt")
				return okTokens(1)
			},
			persist: async (tokens: TokenSet) => {
				order.push("persist")
				// Access must not have been returned to caller yet
				expect(exposedAccess).toBeNull()
				expect(tokens.refresh).toBe("refresh-1")
				expect(tokens.access).toBe("access-1")
			},
			maxRetries: 2,
			sleep: async () => {},
			random: () => 0,
		})

		order.push("resolved")
		if (result.outcome === "ok") {
			exposedAccess = result.access
		}

		expect(result.outcome).toBe("ok")
		expect(order).toEqual(["attempt", "persist", "resolved"])
		if (result.outcome === "ok") {
			expect(result.access).toBe("access-1")
			expect(result.refresh).toBe("refresh-1")
		}
	})

	test("persist failure prevents returning ok tokens", async () => {
		await expect(
			refreshAccount({
				label: "a",
				refreshToken: "rt",
				attempt: async () => okTokens(),
				persist: async () => {
					throw new Error("disk full")
				},
				sleep: async () => {},
			}),
		).rejects.toThrow("disk full")
	})
})

describe("F4 — invalid_grant → needs_reauth (no retry)", () => {
	test("explicit invalid_grant stops immediately", async () => {
		let attempts = 0
		const result = await refreshAccount({
			label: "acct",
			refreshToken: "dead",
			attempt: async () => {
				attempts += 1
				return { outcome: "needs_reauth", error: "invalid_grant" }
			},
			persist: async () => {
				throw new Error("persist must not run")
			},
			maxRetries: 2,
			sleep: async () => {},
		})
		expect(result.outcome).toBe("needs_reauth")
		expect(attempts).toBe(1)
	})
})

describe("F4 — ambiguous failures → retry then transient", () => {
	test("network/transient retried max 2 times (3 total) then transient", async () => {
		let attempts = 0
		const sleeps: number[] = []
		const result = await refreshAccount({
			label: "acct",
			refreshToken: "rt",
			attempt: async () => {
				attempts += 1
				return {
					outcome: "transient",
					error: "network_error",
					attempts: 1,
				}
			},
			persist: async () => {
				throw new Error("persist must not run")
			},
			maxRetries: 2,
			backoffBaseMs: 10,
			sleep: async (ms) => {
				sleeps.push(ms)
			},
			random: () => 0,
		})
		expect(result.outcome).toBe("transient")
		if (result.outcome === "transient") {
			expect(result.attempts).toBe(3)
		}
		expect(attempts).toBe(3)
		expect(sleeps.length).toBe(2)
	})

	test("timeout-shaped transient then success on retry", async () => {
		let attempts = 0
		const result = await refreshAccount({
			label: "acct",
			refreshToken: "rt",
			attempt: async () => {
				attempts += 1
				if (attempts < 2) {
					return {
						outcome: "transient",
						error: "timeout",
						attempts: 1,
					}
				}
				return okTokens(2)
			},
			persist: async () => {},
			maxRetries: 2,
			sleep: async () => {},
			random: () => 0,
		})
		expect(result.outcome).toBe("ok")
		expect(attempts).toBe(2)
	})

	test("5xx-shaped and unknown error codes are transient (not needs_reauth)", async () => {
		for (const error of ["http_503", "token_error:server_error", "token_error:weird"]) {
			_resetRefreshMutexesForTests()
			let attempts = 0
			const result = await refreshAccount({
				label: `acct-${error}`,
				refreshToken: "rt",
				attempt: async () => {
					attempts += 1
					return { outcome: "transient", error, attempts: 1 }
				},
				persist: async () => {
					throw new Error("no")
				},
				maxRetries: 1,
				sleep: async () => {},
				random: () => 0,
			})
			expect(result.outcome).toBe("transient")
			expect(attempts).toBe(2)
		}
	})

	test("state remains recoverable after transient (caller can retry later)", async () => {
		// First call exhausts retries → transient
		const r1 = await refreshAccount({
			label: "recoverable",
			refreshToken: "rt",
			attempt: async () => ({
				outcome: "transient",
				error: "network_error",
				attempts: 1,
			}),
			persist: async () => {},
			maxRetries: 0,
			sleep: async () => {},
		})
		expect(r1.outcome).toBe("transient")

		// Later call can still succeed — no sticky needs_reauth
		const r2 = await refreshAccount({
			label: "recoverable",
			refreshToken: "rt",
			attempt: async () => okTokens(9),
			persist: async () => {},
			maxRetries: 0,
			sleep: async () => {},
		})
		expect(r2.outcome).toBe("ok")
	})
})

describe("single-flight mutex per account label", () => {
	test("concurrent refresh for same label is serialized", async () => {
		let inFlight = 0
		let maxInFlight = 0
		let calls = 0

		const run = () =>
			refreshAccount({
				label: "same",
				refreshToken: "rt",
				attempt: async () => {
					calls += 1
					inFlight += 1
					maxInFlight = Math.max(maxInFlight, inFlight)
					await new Promise((r) => setTimeout(r, 30))
					inFlight -= 1
					return okTokens(calls)
				},
				persist: async () => {},
				sleep: async () => {},
			})

		const [a, b] = await Promise.all([run(), run()])
		expect(a.outcome).toBe("ok")
		expect(b.outcome).toBe("ok")
		expect(maxInFlight).toBe(1)
		expect(calls).toBe(2)
	})
})

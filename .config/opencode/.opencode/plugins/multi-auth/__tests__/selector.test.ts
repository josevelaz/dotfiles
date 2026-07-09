import { describe, expect, test } from "bun:test"
import {
	select,
	type SelectResult,
	type SelectorAccount,
	type SelectorConfig,
} from "../selector"

const sticky: SelectorConfig = { stickyWithinSession: true }
const noSticky: SelectorConfig = { stickyWithinSession: false }

function acct(
	partial: Partial<SelectorAccount> & Pick<SelectorAccount, "label" | "priority">,
): SelectorAccount {
	return {
		state: "available",
		resetAt: null,
		lastExhaustedAt: null,
		addedAt: 0,
		...partial,
	}
}

function labelOf(result: SelectResult): string | null {
	return result.ok ? result.account.label : null
}

/** Fisher–Yates with mulberry32 PRNG for reproducible shuffles. */
function mulberry32(seed: number): () => number {
	return () => {
		let t = (seed += 0x6d2b79f5)
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function shuffle<T>(arr: readonly T[], seed: number): T[] {
	const out = [...arr]
	const rand = mulberry32(seed)
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1))
		;[out[i], out[j]] = [out[j]!, out[i]!]
	}
	return out
}

describe("select — basic priority", () => {
	test("picks lowest priority number", () => {
		const accounts = [
			acct({ label: "b", priority: 2 }),
			acct({ label: "a", priority: 1 }),
			acct({ label: "c", priority: 3 }),
		]
		expect(labelOf(select(accounts, sticky, 1000))).toBe("a")
	})
})

describe("select — determinism", () => {
	const accounts = [
		acct({ label: "x", priority: 1, lastExhaustedAt: 50, addedAt: 10 }),
		acct({ label: "y", priority: 1, lastExhaustedAt: 50, addedAt: 20 }),
		acct({ label: "z", priority: 2, addedAt: 5 }),
	]
	const now = 1000
	const opts = { sessionAffinity: "z" as const }

	test("same inputs twice → same output", () => {
		const a = select(accounts, sticky, now, opts)
		const b = select(accounts, sticky, now, opts)
		expect(a).toEqual(b)
	})

	test("input array order does not affect result (total sort)", () => {
		const baseline = select(accounts, noSticky, now)
		for (let seed = 0; seed < 32; seed++) {
			const shuffled = shuffle(accounts, seed)
			expect(select(shuffled, noSticky, now)).toEqual(baseline)
		}
	})
})

describe("select — failback after reset (lazy recovery)", () => {
	const T = 5000
	const accounts: SelectorAccount[] = [
		acct({
			label: "A",
			priority: 1,
			state: "cooling_down",
			resetAt: T,
			lastExhaustedAt: 1000,
			addedAt: 1,
		}),
		acct({ label: "B", priority: 2, state: "available", addedAt: 2 }),
	]

	test("before resetAt selects lower-priority available account", () => {
		expect(labelOf(select(accounts, sticky, T - 1))).toBe("B")
	})

	test("at resetAt higher-priority account is selected immediately", () => {
		expect(labelOf(select(accounts, sticky, T))).toBe("A")
	})

	test("after resetAt higher-priority account is selected", () => {
		expect(labelOf(select(accounts, sticky, T + 100))).toBe("A")
	})
})

describe("select — all exhausted with earliestResetAt", () => {
	test("returns earliest resetAt across multiple cooling_down accounts", () => {
		const accounts = [
			acct({
				label: "a",
				priority: 1,
				state: "cooling_down",
				resetAt: 9000,
			}),
			acct({
				label: "b",
				priority: 2,
				state: "cooling_down",
				resetAt: 3000,
			}),
			acct({
				label: "c",
				priority: 3,
				state: "cooling_down",
				resetAt: 6000,
			}),
		]
		const result = select(accounts, sticky, 1000)
		expect(result).toEqual({
			ok: false,
			allExhausted: true,
			earliestResetAt: 3000,
		})
	})

	test("earliestResetAt is null when no cooling_down with resetAt", () => {
		const accounts = [
			acct({ label: "a", priority: 1, state: "needs_reauth" }),
			acct({ label: "b", priority: 2, state: "disabled" }),
		]
		const result = select(accounts, sticky, 1000)
		expect(result).toEqual({
			ok: false,
			allExhausted: true,
			earliestResetAt: null,
		})
	})

	test("ignores null resetAt when computing earliest", () => {
		const accounts = [
			acct({
				label: "a",
				priority: 1,
				state: "cooling_down",
				resetAt: null,
			}),
			acct({
				label: "b",
				priority: 2,
				state: "cooling_down",
				resetAt: 4000,
			}),
		]
		const result = select(accounts, sticky, 1000)
		expect(result).toEqual({
			ok: false,
			allExhausted: true,
			earliestResetAt: 4000,
		})
	})
})

describe("select — needs_reauth / disabled never selected", () => {
	test("never selected even when everything else is exhausted", () => {
		const accounts = [
			acct({ label: "good-but-cooling", priority: 1, state: "cooling_down", resetAt: 9999 }),
			acct({ label: "reauth", priority: 0, state: "needs_reauth" }),
			acct({ label: "off", priority: 0, state: "disabled" }),
		]
		const result = select(accounts, sticky, 1000)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.earliestResetAt).toBe(9999)
		}
	})

	test("available lower-priority preferred over needs_reauth higher priority", () => {
		const accounts = [
			acct({ label: "reauth", priority: 0, state: "needs_reauth" }),
			acct({ label: "ok", priority: 5, state: "available" }),
		]
		expect(labelOf(select(accounts, sticky, 1000))).toBe("ok")
	})
})

describe("select — exclusion set", () => {
	test("excluded labels never returned", () => {
		const accounts = [
			acct({ label: "a", priority: 1 }),
			acct({ label: "b", priority: 2 }),
			acct({ label: "c", priority: 3 }),
		]
		expect(labelOf(select(accounts, sticky, 1000, { exclude: new Set(["a"]) }))).toBe("b")
		expect(
			labelOf(select(accounts, sticky, 1000, { exclude: new Set(["a", "b"]) })),
		).toBe("c")
	})

	test("excluding all candidates yields allExhausted", () => {
		const accounts = [
			acct({ label: "a", priority: 1 }),
			acct({
				label: "cool",
				priority: 2,
				state: "cooling_down",
				resetAt: 5000,
			}),
		]
		const result = select(accounts, sticky, 1000, { exclude: new Set(["a"]) })
		expect(result).toEqual({
			ok: false,
			allExhausted: true,
			earliestResetAt: 5000,
		})
	})
})

describe("select — session stickiness", () => {
	test("affinity kept at tied best priority", () => {
		const accounts = [
			acct({ label: "a", priority: 1, lastExhaustedAt: 10, addedAt: 1 }),
			acct({ label: "b", priority: 1, lastExhaustedAt: null, addedAt: 2 }),
			acct({ label: "c", priority: 2 }),
		]
		// Without stickiness, b wins (null lastExhaustedAt)
		expect(labelOf(select(accounts, noSticky, 1000))).toBe("b")
		// With affinity on a at same best priority, stick to a
		expect(
			labelOf(select(accounts, sticky, 1000, { sessionAffinity: "a" })),
		).toBe("a")
	})

	test("affinity dropped when strictly better priority available", () => {
		const accounts = [
			acct({ label: "sticky", priority: 2 }),
			acct({ label: "better", priority: 1 }),
		]
		expect(
			labelOf(select(accounts, sticky, 1000, { sessionAffinity: "sticky" })),
		).toBe("better")
	})

	test("affinity ignored when stickyWithinSession is false", () => {
		const accounts = [
			acct({ label: "a", priority: 1, lastExhaustedAt: 100, addedAt: 1 }),
			acct({ label: "b", priority: 1, lastExhaustedAt: null, addedAt: 2 }),
		]
		expect(
			labelOf(select(accounts, noSticky, 1000, { sessionAffinity: "a" })),
		).toBe("b")
	})

	test("affinity ignored when affinity account is not a candidate", () => {
		const accounts = [
			acct({
				label: "sticky",
				priority: 1,
				state: "cooling_down",
				resetAt: 9999,
			}),
			acct({ label: "other", priority: 2 }),
		]
		expect(
			labelOf(select(accounts, sticky, 1000, { sessionAffinity: "sticky" })),
		).toBe("other")
	})

	test("affinity ignored when affinity is excluded", () => {
		const accounts = [
			acct({ label: "a", priority: 1 }),
			acct({ label: "b", priority: 1, lastExhaustedAt: 50 }),
		]
		expect(
			labelOf(
				select(accounts, sticky, 1000, {
					sessionAffinity: "a",
					exclude: new Set(["a"]),
				}),
			),
		).toBe("b")
	})
})

describe("select — duplicate priority tie-breaks", () => {
	test("null lastExhaustedAt preferred over exhausted", () => {
		const accounts = [
			acct({ label: "exhausted", priority: 1, lastExhaustedAt: 100, addedAt: 1 }),
			acct({ label: "fresh", priority: 1, lastExhaustedAt: null, addedAt: 99 }),
		]
		expect(labelOf(select(accounts, noSticky, 1000))).toBe("fresh")
	})

	test("least-recently-exhausted wins among exhausted", () => {
		const accounts = [
			acct({ label: "recent", priority: 1, lastExhaustedAt: 500, addedAt: 1 }),
			acct({ label: "older", priority: 1, lastExhaustedAt: 100, addedAt: 2 }),
		]
		expect(labelOf(select(accounts, noSticky, 1000))).toBe("older")
	})

	test("addedAt breaks remaining ties", () => {
		const accounts = [
			acct({ label: "later", priority: 1, lastExhaustedAt: null, addedAt: 20 }),
			acct({ label: "earlier", priority: 1, lastExhaustedAt: null, addedAt: 10 }),
		]
		expect(labelOf(select(accounts, noSticky, 1000))).toBe("earlier")
	})

	test("label is final total-order tiebreak", () => {
		const accounts = [
			acct({ label: "z", priority: 1, lastExhaustedAt: null, addedAt: 1 }),
			acct({ label: "a", priority: 1, lastExhaustedAt: null, addedAt: 1 }),
		]
		expect(labelOf(select(accounts, noSticky, 1000))).toBe("a")
		// Order independence
		expect(labelOf(select([...accounts].reverse(), noSticky, 1000))).toBe("a")
	})
})

describe("select — cooling_down without usable resetAt stays out", () => {
	test("cooling_down with null resetAt is not a candidate", () => {
		const accounts = [
			acct({
				label: "stuck",
				priority: 1,
				state: "cooling_down",
				resetAt: null,
			}),
			acct({ label: "ok", priority: 9 }),
		]
		expect(labelOf(select(accounts, sticky, 1e12))).toBe("ok")
	})
})

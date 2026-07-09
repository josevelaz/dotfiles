/**
 * Pure account selector for multi-auth.
 * No I/O, no Date.now — `now` is always a parameter.
 */

export type AccountState =
	| "available"
	| "cooling_down"
	| "needs_reauth"
	| "disabled"

export interface SelectorAccount {
	label: string
	/** Lower = higher priority (resolved by caller). */
	priority: number
	state: AccountState
	/** Epoch ms when cooling_down ends; null if unknown. */
	resetAt: number | null
	lastExhaustedAt: number | null
	addedAt: number
}

export interface SelectorConfig {
	stickyWithinSession: boolean
}

export interface SelectOptions {
	sessionAffinity?: string
	/** Labels already tried this request — never returned. */
	exclude?: ReadonlySet<string>
}

export type SelectResult =
	| { ok: true; account: SelectorAccount }
	| { ok: false; allExhausted: true; earliestResetAt: number | null }

function isCandidate(account: SelectorAccount, now: number): boolean {
	if (account.state === "available") return true
	if (account.state === "cooling_down" && account.resetAt !== null && now >= account.resetAt) {
		return true
	}
	return false
}

function compareCandidates(a: SelectorAccount, b: SelectorAccount): number {
	if (a.priority !== b.priority) return a.priority - b.priority
	// nulls-first: never exhausted preferred
	const aEx = a.lastExhaustedAt
	const bEx = b.lastExhaustedAt
	if (aEx === null && bEx !== null) return -1
	if (aEx !== null && bEx === null) return 1
	if (aEx !== null && bEx !== null && aEx !== bEx) return aEx - bEx
	if (a.addedAt !== b.addedAt) return a.addedAt - b.addedAt
	// Total order: label as final tiebreak (determinism under shuffle)
	if (a.label < b.label) return -1
	if (a.label > b.label) return 1
	return 0
}

function earliestResetAmongCoolingDown(
	accounts: readonly SelectorAccount[],
): number | null {
	let earliest: number | null = null
	for (const a of accounts) {
		if (a.state !== "cooling_down") continue
		if (a.resetAt === null) continue
		if (earliest === null || a.resetAt < earliest) earliest = a.resetAt
	}
	return earliest
}

/**
 * Select the best available account by priority / exhaustion / stickiness.
 *
 * Lazy recovery: cooling_down accounts with `now >= resetAt` are treated as
 * available without any timer side effects.
 */
export function select(
	accounts: readonly SelectorAccount[],
	config: SelectorConfig,
	now: number,
	opts?: SelectOptions,
): SelectResult {
	const exclude = opts?.exclude

	const candidates = accounts.filter((a) => {
		if (a.state === "disabled" || a.state === "needs_reauth") return false
		if (exclude?.has(a.label)) return false
		return isCandidate(a, now)
	})

	if (candidates.length === 0) {
		return {
			ok: false,
			allExhausted: true,
			earliestResetAt: earliestResetAmongCoolingDown(accounts),
		}
	}

	const minPriority = Math.min(...candidates.map((c) => c.priority))

	if (config.stickyWithinSession && opts?.sessionAffinity) {
		const affinity = candidates.find((c) => c.label === opts.sessionAffinity)
		if (affinity && affinity.priority === minPriority) {
			return { ok: true, account: affinity }
		}
	}

	const sorted = [...candidates].sort(compareCandidates)
	return { ok: true, account: sorted[0]! }
}

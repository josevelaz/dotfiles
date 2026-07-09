/**
 * Provider-agnostic OAuth token refresh orchestration.
 *
 * - Per-account in-process async mutex (single-flight)
 * - Rotation-safe write-then-use: `persist` runs before tokens are returned
 * - F4 outcomes: explicit `invalid_grant` → needs_reauth; ambiguous failures
 *   get bounded retry (max 2 retries) with jittered backoff → transient
 *
 * Does not import store.ts — callers pass a `persist` callback.
 *
 * @module multi-auth/refresh
 */

import { Mutex } from "../kdco-primitives/mutex"
import type { RefreshResult, TokenSet } from "./adapters/types"

// =============================================================================
// TYPES
// =============================================================================

/**
 * Single-attempt refresh function (typically `adapter.refresh`).
 * Must NOT implement multi-attempt retry itself — this module owns retries.
 */
export type RefreshAttempt = (
	refreshToken: string,
) => Promise<RefreshResult>

export type PersistTokens = (tokens: TokenSet) => Promise<void>

export type RefreshAccountInput = {
	/** Account label — mutex key for single-flight. */
	label: string
	/** Current refresh token. */
	refreshToken: string
	/** One-shot token-endpoint call. */
	attempt: RefreshAttempt
	/**
	 * Persist rotated tokens BEFORE the new access token is returned/used.
	 * Required for rotation-safe ordering (S3 / write-then-use).
	 */
	persist: PersistTokens
	/**
	 * Max *retries* after the first attempt (default 2 → up to 3 total calls).
	 * Only applied to ambiguous/transient failures — never to needs_reauth.
	 */
	maxRetries?: number
	/** Base backoff in ms before jitter (default 50). */
	backoffBaseMs?: number
	/** Cap on backoff delay (default 2000). */
	backoffMaxMs?: number
	/** Injectable sleep (tests). */
	sleep?: (ms: number) => Promise<void>
	/** Injectable RNG for jitter in [0, 1). */
	random?: () => number
}

// =============================================================================
// PER-ACCOUNT MUTEX
// =============================================================================

const accountMutexes = new Map<string, Mutex>()

function mutexFor(label: string): Mutex {
	let m = accountMutexes.get(label)
	if (!m) {
		m = new Mutex()
		accountMutexes.set(label, m)
	}
	return m
}

/** Test helper: drop all in-process refresh mutexes. */
export function _resetRefreshMutexesForTests(): void {
	accountMutexes.clear()
}

// =============================================================================
// BACKOFF
// =============================================================================

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Jittered exponential backoff: base * 2^attempt + random(0, base), capped.
 */
export function computeBackoffMs(
	attemptIndex: number,
	baseMs: number,
	maxMs: number,
	random: () => number,
): number {
	const exp = baseMs * 2 ** attemptIndex
	const jitter = Math.floor(random() * baseMs)
	return Math.min(maxMs, exp + jitter)
}

// =============================================================================
// ORCHESTRATION
// =============================================================================

/**
 * Refresh tokens for one account under a per-label mutex.
 *
 * F4:
 * - `invalid_grant` / `needs_reauth` from a single attempt → stop, return needs_reauth
 * - network / timeout / 5xx / unknown → retry up to maxRetries, then transient
 * - success → await persist(tokens) then return ok (write-then-use)
 */
export async function refreshAccount(
	input: RefreshAccountInput,
): Promise<RefreshResult> {
	const label = input.label
	if (!label) {
		return { outcome: "needs_reauth", error: "label_required" }
	}

	const maxRetries = input.maxRetries ?? 2
	const backoffBaseMs = input.backoffBaseMs ?? 50
	const backoffMaxMs = input.backoffMaxMs ?? 2000
	const sleep = input.sleep ?? defaultSleep
	const random = input.random ?? Math.random

	const mutex = mutexFor(label)

	return mutex.runExclusive(async () => {
		let attempts = 0
		let lastError: string | undefined

		while (attempts <= maxRetries) {
			attempts += 1
			const result = await input.attempt(input.refreshToken)

			if (result.outcome === "ok") {
				const tokens: TokenSet = {
					access: result.access,
					refresh: result.refresh,
					expires: result.expires,
				}
				// Write-then-use: persist rotated refresh BEFORE exposing access
				await input.persist(tokens)
				return {
					outcome: "ok" as const,
					...tokens,
				}
			}

			if (result.outcome === "needs_reauth") {
				return {
					outcome: "needs_reauth" as const,
					error: result.error ?? "invalid_grant",
				}
			}

			// transient
			lastError = result.error
			if (attempts > maxRetries) {
				break
			}
			const delay = computeBackoffMs(
				attempts - 1,
				backoffBaseMs,
				backoffMaxMs,
				random,
			)
			await sleep(delay)
		}

		return {
			outcome: "transient" as const,
			error: lastError ?? "transient_failure",
			attempts,
		}
	})
}

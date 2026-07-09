/**
 * Status / notify surface for multi-auth.
 *
 * Toast via `client.tui.showToast` when available; degrades to structured log.
 * All messages pass through `redact` — labels only, never tokens.
 *
 * @module multi-auth/status
 */

import { redact, type Logger } from "./fetch-wrapper"
import type { NotifyMode } from "./config"

// =============================================================================
// TYPES
// =============================================================================

/** Minimal client surface used for toast + structured log. */
export type StatusClient = {
	tui?: {
		showToast?: (options: {
			body: {
				title?: string
				message: string
				variant: "info" | "success" | "warning" | "error"
				duration?: number
			}
		}) => Promise<unknown>
	}
	app?: {
		log?: (options: {
			body: {
				service: string
				level: "debug" | "info" | "warn" | "error"
				message: string
			}
		}) => Promise<unknown>
	}
}

export type CreateStatusOptions = {
	client?: StatusClient | null
	mode: NotifyMode
	logger?: Logger
	/** Log service name (default: multi-auth). */
	service?: string
}

export type Status = {
	/** Primary notify used by the fetch wrapper. */
	notify: (message: string) => void
	/** Structured helpers (label-only messages). */
	accountAdded: (label: string) => void
	fallback: (fromLabel: string, toLabel: string) => void
	allExhausted: (accountCount: number, earliestResetAt: number | null) => void
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

function formatReset(resetAt: number | null): string {
	if (resetAt == null) return "unknown"
	try {
		return new Date(resetAt).toISOString()
	} catch {
		return String(resetAt)
	}
}

/**
 * Create a status notifier for multi-auth events.
 *
 * - `toast`: prefer `client.tui.showToast`, fall back to log
 * - `log`: structured / console log only
 * - `silent`: no-op
 */
export function createStatus(options: CreateStatusOptions): Status {
	const { client, mode, logger = console, service = "multi-auth" } = options

	const writeLog = (level: "info" | "warn", message: string): void => {
		const safe = redact(message)
		const appLog = client?.app?.log
		if (appLog) {
			void appLog({ body: { service, level, message: safe } }).catch(() => {
				;(logger[level] ?? logger.log)?.(`[${service}] ${safe}`)
			})
			return
		}
		;(logger[level] ?? logger.log)?.(`[${service}] ${safe}`)
	}

	const notify = (message: string): void => {
		const safe = redact(message)
		if (mode === "silent") return
		if (mode === "log") {
			writeLog("info", safe)
			return
		}
		// toast
		const showToast = client?.tui?.showToast
		if (typeof showToast === "function") {
			void showToast({
				body: {
					title: "multi-auth",
					message: safe,
					variant: "info",
				},
			}).catch(() => {
				writeLog("info", safe)
			})
			return
		}
		writeLog("info", safe)
	}

	return {
		notify,
		accountAdded(label: string): void {
			notify(`account added: ${label}`)
		},
		fallback(fromLabel: string, toLabel: string): void {
			notify(`fallback from ${fromLabel} to ${toLabel}`)
		},
		allExhausted(accountCount: number, earliestResetAt: number | null): void {
			notify(
				`all ${accountCount} accounts exhausted, earliest reset at ${formatReset(earliestResetAt)}`,
			)
		},
	}
}

import type { createOpencodeClient } from "@opencode-ai/sdk"

import { isOpaqueAccountId, type PluginLogger } from "./types"

const REDACTED = "[REDACTED]"

type LogLevel = "debug" | "info" | "warn" | "error"
type Client = ReturnType<typeof createOpencodeClient>

function shouldRedactKey(key: string): boolean {
	const normalized = key.toLowerCase()
	return [
		"access",
		"access_token",
		"accesstoken",
		"refresh",
		"refresh_token",
		"refreshtoken",
		"authorization",
		"secretref",
		"secret_ref",
		"identitykey",
		"identity_key",
		"label",
		"accountlabel",
		"account_label",
	].includes(normalized)
		|| normalized.endsWith("token")
		|| normalized.endsWith("secret")
		|| normalized.endsWith("identity")
}

function redactString(key: string | undefined, value: string): string {
	if (!key) return value
	const normalized = key.toLowerCase()
	if (normalized === "id" || normalized === "accountid" || normalized === "account_id") {
		return isOpaqueAccountId(value) ? value : REDACTED
	}
	if (normalized === "authorization") {
		return REDACTED
	}
	return shouldRedactKey(key) ? REDACTED : value
}

export function redactForLog(value: unknown, key?: string): unknown {
	if (value === null || value === undefined) return value
	if (typeof value === "string") return redactString(key, value)
	if (typeof value !== "object") return value
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map((entry) => redactForLog(entry))

	const result: Record<string, unknown> = {}
	for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
		if (typeof childValue === "string") {
			result[childKey] = redactString(childKey, childValue)
			continue
		}
		result[childKey] = redactForLog(childValue, childKey)
	}
	return result
}

export function createLogger(client: Client, service = "github-copilot-multi-account"): PluginLogger {
	const log = (level: LogLevel, message: string, extra?: unknown) => {
		client.app
			.log({
				body: {
					service,
					level,
					message,
					extra: extra === undefined ? undefined : redactForLog(extra),
				},
			})
			.catch(() => {})
	}

	return {
		debug(message, extra) {
			log("debug", message, extra)
		},
		info(message, extra) {
			log("info", message, extra)
		},
		warn(message, extra) {
			log("warn", message, extra)
		},
		error(message, extra) {
			log("error", message, extra)
		},
		count(metric, value = 1, extra) {
			log("info", `metric:${metric}`, { value, ...(typeof extra === "object" && extra ? (extra as Record<string, unknown>) : {}) })
		},
	}
}

import { type ClassifierResult, type ReplaySnapshot } from "./types"

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined
	const numeric = Number.parseInt(value, 10)
	if (!Number.isNaN(numeric)) return Math.max(0, numeric * 1_000)
	const date = Date.parse(value)
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
	return undefined
}

function extractReason(bodyText: string): string {
	const trimmed = bodyText.trim()
	return trimmed.length > 0 ? trimmed.slice(0, 200) : "upstream response"
}

function buildRetryMetadata(response: Response): Pick<ClassifierResult, "retryAt" | "retryAfterMs"> {
	const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"))
	if (retryAfterMs === undefined) return {}
	return { retryAfterMs, retryAt: Date.now() + retryAfterMs }
}

export async function snapshotReplayableRequest(
	input: Request | string | URL,
	init?: RequestInit,
): Promise<ReplaySnapshot | null> {
	const request = input instanceof Request ? input : new Request(input, init)
	const method = request.method.toUpperCase()
	const accept = request.headers.get("accept") ?? ""
	const streaming = accept.includes("text/event-stream")
	if (request.bodyUsed) return null

	const clone = request.clone()
	const contentType = clone.headers.get("content-type") ?? ""
	if (clone.body && contentType.includes("multipart/form-data")) return null

	const text = await clone.text()
	return {
		method,
		headers: new Headers(clone.headers),
		bodyText: text.length > 0 ? text : undefined,
		url: clone.url,
		streaming,
	}
}

export function canReplayRequest(snapshot: ReplaySnapshot | null): boolean {
	return snapshot !== null && !snapshot.streaming
}

export function buildReplayRequestInit(snapshot: ReplaySnapshot, accessToken: string): RequestInit {
	const headers = new Headers(snapshot.headers)
	headers.set("authorization", `Bearer ${accessToken}`)
	return {
		method: snapshot.method,
		headers,
		body: snapshot.bodyText,
	}
}

export function classifyCopilotResponse(response: Response, bodyText: string): ClassifierResult {
	if (response.ok) return { disposition: "success" }

	const normalized = bodyText.toLowerCase()
	if (response.status === 401) {
		return { disposition: "refresh_and_retry", reason: extractReason(bodyText) }
	}

	if (response.status === 403) {
		if (normalized.includes("expired") || normalized.includes("token revoked")) {
			return { disposition: "refresh_and_retry", reason: extractReason(bodyText) }
		}
		return { disposition: "fail_without_rotation", reason: extractReason(bodyText) }
	}

	if (response.status === 429) {
		const retry = buildRetryMetadata(response)
		const scopeHeader = (response.headers.get("x-ratelimit-scope") ?? "").toLowerCase()
		const isAccountScoped = scopeHeader === "account" || normalized.includes("account-scoped") || normalized.includes("per-account")
		if (isAccountScoped) {
			return {
				disposition: "rotate_account",
				cooldownScope: "account",
				accountScoped: true,
				reason: extractReason(bodyText),
				...retry,
			}
		}
		return {
			disposition: "fail_with_retry_time",
			cooldownScope: "provider",
			accountScoped: false,
			reason: extractReason(bodyText),
			...retry,
		}
	}

	if (response.status >= 500) {
		return { disposition: "retry_same_account", reason: extractReason(bodyText) }
	}

	if (response.status >= 400) {
		return { disposition: "fail_request", reason: extractReason(bodyText) }
	}

	return { disposition: "fail_without_rotation", reason: extractReason(bodyText) }
}

export function classifyCopilotFailure(error: unknown): ClassifierResult {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
	if (
		message.includes("timeout") ||
		message.includes("timed out") ||
		message.includes("econnreset") ||
		message.includes("network") ||
		message.includes("socket hang up")
	) {
		return { disposition: "retry_same_account", reason: message }
	}
	return { disposition: "fail_request", reason: message }
}

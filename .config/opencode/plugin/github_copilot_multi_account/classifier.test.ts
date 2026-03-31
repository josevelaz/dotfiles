import { expect, test } from "bun:test"

import { classifyCopilotFailure, classifyCopilotResponse } from "./classifier"

test("expired token responses request refresh", () => {
	const response = new Response(JSON.stringify({ error: "token expired" }), { status: 401 })
	expect(classifyCopilotResponse(response, "token expired").disposition).toBe("refresh_and_retry")
})

test("org restriction responses fail without rotation", () => {
	const response = new Response(JSON.stringify({ error: "org policy forbids this model" }), { status: 403 })
	expect(classifyCopilotResponse(response, "org policy forbids this model").disposition).toBe("fail_without_rotation")
})

test("account-scoped 429 rotates and ambiguous 429 fails closed", () => {
	const accountScoped = new Response("account-scoped throttle", {
		status: 429,
		headers: { "retry-after": "60", "x-ratelimit-scope": "account" },
	})
	const ambiguous = new Response("global throttle", { status: 429, headers: { "retry-after": "60" } })

	expect(classifyCopilotResponse(accountScoped, "account-scoped throttle").disposition).toBe("rotate_account")
	expect(classifyCopilotResponse(ambiguous, "global throttle").disposition).toBe("fail_with_retry_time")
})

test("5xx retries same account and invalid requests fail immediately", () => {
	const transient = new Response("server error", { status: 503 })
	const invalid = new Response("bad request", { status: 400 })

	expect(classifyCopilotResponse(transient, "server error").disposition).toBe("retry_same_account")
	expect(classifyCopilotResponse(invalid, "bad request").disposition).toBe("fail_request")
})

test("transport failures classify separately", () => {
	expect(classifyCopilotFailure(new Error("socket hang up")).disposition).toBe("retry_same_account")
	expect(classifyCopilotFailure(new Error("validation failed")).disposition).toBe("fail_request")
})

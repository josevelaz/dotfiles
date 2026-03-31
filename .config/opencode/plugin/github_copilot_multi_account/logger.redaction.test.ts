import { expect, test } from "bun:test"

import { redactForLog } from "./logger"

test("redacts nested tokens and identity metadata", () => {
	const redacted = redactForLog({
		headers: {
			Authorization: "Bearer super-secret",
		},
		credentials: {
			accessToken: "access-token",
			refreshToken: "refresh-token",
			secretRef: "copilot-secret-123",
		},
		accounts: [
			{
				id: "github-user-123",
				label: "alice@example.com",
				identityKey: "identity-1",
			},
			{
				id: "copilot-acct-abcdef123456",
			},
		],
	}) as any

	expect(redacted.headers.Authorization).toBe("[REDACTED]")
	expect(redacted.credentials.accessToken).toBe("[REDACTED]")
	expect(redacted.credentials.refreshToken).toBe("[REDACTED]")
	expect(redacted.credentials.secretRef).toBe("[REDACTED]")
	expect(redacted.accounts[0].id).toBe("[REDACTED]")
	expect(redacted.accounts[0].label).toBe("[REDACTED]")
	expect(redacted.accounts[0].identityKey).toBe("[REDACTED]")
	expect(redacted.accounts[1].id).toBe("copilot-acct-abcdef123456")
})

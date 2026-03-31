type Parser<T> = {
	parse(input: unknown): T
}

function fail(message: string): never {
	throw new Error(message)
}

function asObject(input: unknown, label: string): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) fail(`${label} must be an object`)
	return input as Record<string, unknown>
}

function asString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`)
	return value
}

function asNullableString(value: unknown, label: string): string | null {
	if (value === null || value === undefined) return null
	return asString(value, label)
}

function asBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") fail(`${label} must be a boolean`)
	return value
}

function asNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${label} must be a non-negative number`)
	return value
}

function asNullableNumber(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null
	return asNumber(value, label)
}

function asRecordOfNumbers(value: unknown, label: string): Record<string, number> {
	const obj = asObject(value, label)
	const result: Record<string, number> = {}
	for (const [key, entry] of Object.entries(obj)) result[key] = asNumber(entry, `${label}.${key}`)
	return result
}

export const capabilityGateEvidenceSchema: Parser<Record<string, unknown>> = {
	parse(input) {
		const obj = asObject(input, "capabilityGateEvidence")
		const goNoGo = asString(obj.goNoGo, "goNoGo")
		if (goNoGo !== "go" && goNoGo !== "stop") fail("goNoGo must be 'go' or 'stop'")
		if (asString(obj.providerId, "providerId") !== "github-copilot") fail("providerId must be github-copilot")
		return {
			authMethodShape: asString(obj.authMethodShape, "authMethodShape"),
			loaderShape: asString(obj.loaderShape, "loaderShape"),
			opencodeVersion: asString(obj.opencodeVersion, "opencodeVersion"),
			pluginVersion: asString(obj.pluginVersion, "pluginVersion"),
			providerId: "github-copilot",
			authMethodId: asString(obj.authMethodId, "authMethodId"),
			validationCommand: asString(obj.validationCommand, "validationCommand"),
			probeScript: asString(obj.probeScript, "probeScript"),
			validationDate: asString(obj.validationDate, "validationDate"),
			providerContractSummary: asString(obj.providerContractSummary, "providerContractSummary"),
			refreshContractSummary: asString(obj.refreshContractSummary, "refreshContractSummary"),
			requestFixtureHash: asString(obj.requestFixtureHash, "requestFixtureHash"),
			responseFixtureHash: asString(obj.responseFixtureHash, "responseFixtureHash"),
			replayProof: asString(obj.replayProof, "replayProof"),
			persistenceProof: asString(obj.persistenceProof, "persistenceProof"),
			transportOverrideProof: asString(obj.transportOverrideProof, "transportOverrideProof"),
			canInspectResponse: asBoolean(obj.canInspectResponse, "canInspectResponse"),
			canReplayBufferedRequest: asBoolean(obj.canReplayBufferedRequest, "canReplayBufferedRequest"),
			canPersistDuringRequest: asBoolean(obj.canPersistDuringRequest, "canPersistDuringRequest"),
			canOverrideTransport: asBoolean(obj.canOverrideTransport, "canOverrideTransport"),
			goNoGo,
		}
	},
}

function parseRecoverableError(value: unknown) {
	if (value === null || value === undefined) return null
	const obj = asObject(value, "recoverableError")
	return {
		code: asString(obj.code, "recoverableError.code"),
		message: asString(obj.message, "recoverableError.message"),
		detectedAt: asNumber(obj.detectedAt, "recoverableError.detectedAt"),
		requiresReauth: asBoolean(obj.requiresReauth, "recoverableError.requiresReauth"),
	}
}

function parseAccount(value: unknown) {
	const obj = asObject(value, "account")
	const status = asString(obj.status, "account.status")
	if (!["active", "cooldown", "reauth_required", "disabled", "removed"].includes(status)) {
		fail("account.status must be a known status")
	}
	const schemaVersion = asNumber(obj.schemaVersion, "account.schemaVersion")
	if (schemaVersion !== 1) fail("account.schemaVersion must be 1")
	return {
		id: asString(obj.id, "account.id"),
		identityKey: asString(obj.identityKey, "account.identityKey"),
		label: asString(obj.label, "account.label"),
		secretRef: asString(obj.secretRef, "account.secretRef"),
		credentialVersion: asNumber(obj.credentialVersion, "account.credentialVersion"),
		status,
		expiresAt: asNullableNumber(obj.expiresAt, "account.expiresAt"),
		cooldownUntil: asNullableNumber(obj.cooldownUntil, "account.cooldownUntil"),
		modelCooldowns: asRecordOfNumbers(obj.modelCooldowns ?? {}, "account.modelCooldowns"),
		preferred: asBoolean(obj.preferred, "account.preferred"),
		lastUsedAt: asNullableNumber(obj.lastUsedAt, "account.lastUsedAt"),
		lastSwitchReason: asNullableString(obj.lastSwitchReason, "account.lastSwitchReason"),
		recentFailureReason: asNullableString(obj.recentFailureReason, "account.recentFailureReason"),
		recentFailureAt: asNullableNumber(obj.recentFailureAt, "account.recentFailureAt"),
		recoverableError: parseRecoverableError(obj.recoverableError),
		schemaVersion,
	}
}

export const accountRegistrySchema: Parser<Record<string, unknown>> = {
	parse(input) {
		const obj = asObject(input, "accountRegistry")
		const version = asNumber(obj.version, "version")
		if (version !== 1) fail("version must be 1")
		const scopeValue = obj.sharedBackoffScope ?? null
		if (scopeValue !== null && scopeValue !== "provider" && scopeValue !== "model-family") {
			fail("sharedBackoffScope must be provider, model-family, or null")
		}
		if (!Array.isArray(obj.accounts)) fail("accounts must be an array")
		return {
			version,
			revision: asNumber(obj.revision, "revision"),
			importDeclined: asBoolean(obj.importDeclined, "importDeclined"),
			activeAccountId: asNullableString(obj.activeAccountId, "activeAccountId"),
			sharedBackoffUntil: asNullableNumber(obj.sharedBackoffUntil, "sharedBackoffUntil"),
			sharedBackoffScope: scopeValue,
			sharedBackoffReason: asNullableString(obj.sharedBackoffReason, "sharedBackoffReason"),
			accounts: obj.accounts.map(parseAccount),
		}
	},
}

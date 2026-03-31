import { createOpaqueAccountId, type AccountRegistry, type CopilotAccountRecord } from "./types"

type ImportedAccountInput = {
	identityKey: string
	label: string
	secretRef: string
	credentialVersion: number
	expiresAt: number | null
	preferred?: boolean
}

function isAccountEligible(account: CopilotAccountRecord, now: number): boolean {
	if (account.status === "removed" || account.status === "disabled" || account.status === "reauth_required") return false
	if (account.recoverableError?.requiresReauth) return false
	if (account.cooldownUntil !== null && account.cooldownUntil > now) return false
	return true
}

export function pickEligibleAccount(registry: AccountRegistry, now = Date.now()): CopilotAccountRecord | null {
	if (registry.sharedBackoffUntil !== null && registry.sharedBackoffUntil > now) return null
	if (registry.accounts.length === 0) return null

	const activeIndex = registry.activeAccountId
		? registry.accounts.findIndex((account) => account.id === registry.activeAccountId)
		: -1

	if (activeIndex >= 0) {
		const activeAccount = registry.accounts[activeIndex]
		if (isAccountEligible(activeAccount, now)) return activeAccount
	}

	for (let offset = 1; offset <= registry.accounts.length; offset += 1) {
		const index = activeIndex >= 0 ? (activeIndex + offset) % registry.accounts.length : offset - 1
		const candidate = registry.accounts[index]
		if (isAccountEligible(candidate, now)) return candidate
	}

	return null
}

export function mergeImportedAccount(registry: AccountRegistry, input: ImportedAccountInput): AccountRegistry {
	const existing = registry.accounts.find((account) => account.identityKey === input.identityKey)
	if (existing) {
		existing.label = input.label
		existing.secretRef = input.secretRef
		existing.credentialVersion = input.credentialVersion
		existing.expiresAt = input.expiresAt
		existing.status = "active"
		existing.recoverableError = null
		existing.preferred = input.preferred ?? existing.preferred
		if (existing.preferred) registry.activeAccountId = existing.id
		return registry
	}

	const account: CopilotAccountRecord = {
		id: createOpaqueAccountId(input.identityKey),
		identityKey: input.identityKey,
		label: input.label,
		secretRef: input.secretRef,
		credentialVersion: input.credentialVersion,
		status: "active",
		expiresAt: input.expiresAt,
		cooldownUntil: null,
		modelCooldowns: {},
		preferred: input.preferred ?? registry.accounts.length === 0,
		lastUsedAt: null,
		lastSwitchReason: null,
		recentFailureReason: null,
		recentFailureAt: null,
		recoverableError: null,
		schemaVersion: 1,
	}
	registry.accounts.push(account)
	if (account.preferred || !registry.activeAccountId) registry.activeAccountId = account.id
	return registry
}

export function applyAccountCooldown(
	registry: AccountRegistry,
	accountId: string,
	cooldownUntil: number,
	reason: string,
	modelFamily?: string,
): AccountRegistry {
	registry.accounts = registry.accounts.map((account) => {
		if (account.id !== accountId) return account
		return {
			...account,
			status: "cooldown",
			cooldownUntil,
			lastSwitchReason: reason,
			modelCooldowns: modelFamily ? { ...account.modelCooldowns, [modelFamily]: cooldownUntil } : account.modelCooldowns,
		}
	})
	return registry
}

export function applySharedBackoff(
	registry: AccountRegistry,
	sharedBackoffUntil: number,
	reason: string,
	scope: "provider" | "model-family" = "provider",
): AccountRegistry {
	registry.sharedBackoffUntil = sharedBackoffUntil
	registry.sharedBackoffReason = reason
	registry.sharedBackoffScope = scope
	return registry
}

export function setActiveAccount(registry: AccountRegistry, accountId: string): AccountRegistry {
	registry.activeAccountId = accountId
	registry.accounts = registry.accounts.map((account) => ({
		...account,
		preferred: account.id === accountId,
	}))
	return registry
}

export function disableAccount(registry: AccountRegistry, accountId: string): AccountRegistry {
	registry.accounts = registry.accounts.map((account) => {
		if (account.id !== accountId) return account
		return { ...account, status: "disabled", preferred: false }
	})
	if (registry.activeAccountId === accountId) registry.activeAccountId = null
	return registry
}

export function enableAccount(registry: AccountRegistry, accountId: string): AccountRegistry {
	registry.accounts = registry.accounts.map((account) => {
		if (account.id !== accountId) return account
		return { ...account, status: "active", recoverableError: null }
	})
	return registry
}

export function markAccountUsed(registry: AccountRegistry, accountId: string, reason: string, now = Date.now()): AccountRegistry {
	registry.accounts = registry.accounts.map((account) => {
		if (account.id !== accountId) return account
		return {
			...account,
			lastUsedAt: now,
			lastSwitchReason: reason,
			status: account.cooldownUntil !== null && account.cooldownUntil > now ? "cooldown" : "active",
		}
	})
	registry.activeAccountId = accountId
	return registry
}

export function earliestRetryAt(registry: AccountRegistry, now = Date.now()): number | null {
	const values = [
		registry.sharedBackoffUntil,
		...registry.accounts.map((account) => account.cooldownUntil),
	].filter((value): value is number => value !== null && value > now)
	if (values.length === 0) return null
	return Math.min(...values)
}

import type { Auth, Provider } from "@opencode-ai/sdk"

import {
	applyAccountCooldown,
	applySharedBackoff,
	earliestRetryAt,
	markAccountUsed,
	mergeImportedAccount,
	pickEligibleAccount,
	setActiveAccount,
} from "./accounts"
import {
	buildReplayRequestInit,
	canReplayRequest,
	classifyCopilotFailure,
	classifyCopilotResponse,
	snapshotReplayableRequest,
} from "./classifier"
import { createSecretStore } from "./keychain"
import { withRefreshLease } from "./locks"
import { createLogger } from "./logger"
import { loadRegistry, mutateRegistry, reconcileRegistry } from "./storage"
import {
	MAX_SAME_ACCOUNT_RETRIES,
	MAX_TOTAL_ATTEMPTS,
	REFRESH_WINDOW_MS,
	assertCapabilityGate,
	createImportedAuthCandidate,
	hashAuthIdentity,
	loadCapabilityGateEvidence,
	type AccountRegistry,
	type CapabilityGateEvidence,
	type CopilotAccountRecord,
	type PluginLogger,
	type SecretStore,
	type StoredCredentials,
} from "./types"

type RefreshAccount = (account: CopilotAccountRecord, credentials: StoredCredentials) => Promise<StoredCredentials>

type BuildAuthOverrideOptions = {
	client: any
	getAuth: () => Promise<Auth>
	provider: Provider
	baseDir?: string
	secretStore?: SecretStore
	fetchImpl?: typeof fetch
	refreshAccount?: RefreshAccount
	now?: () => number
	log?: PluginLogger
	capabilityGate?: CapabilityGateEvidence
}

const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"

function normalizeDomain(url: string): string {
	return url.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

function getCopilotUrls(domain: string) {
	return {
		deviceCodeUrl: `https://${domain}/login/device/code`,
		accessTokenUrl: `https://${domain}/login/oauth/access_token`,
	}
}

export function createCopilotAuthMethods() {
	return [
		{
			type: "oauth" as const,
			label: "Login with GitHub Copilot",
			prompts: [
				{
					type: "select" as const,
					key: "deploymentType",
					message: "Select GitHub deployment type",
					options: [
						{ label: "GitHub.com", value: "github.com", hint: "Public" },
						{ label: "GitHub Enterprise", value: "enterprise", hint: "Data residency or self-hosted" },
					],
				},
				{
					type: "text" as const,
					key: "enterpriseUrl",
					message: "Enter your GitHub Enterprise URL or domain",
					placeholder: "company.ghe.com or https://company.ghe.com",
					condition: (inputs: Record<string, string>) => inputs.deploymentType === "enterprise",
					validate: (value: string) => {
						if (!value) return "URL or domain is required"
						try {
							const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`)
							if (!url.hostname) return "Please enter a valid URL or domain"
							return undefined
						} catch {
							return "Please enter a valid URL (e.g., company.ghe.com or https://company.ghe.com)"
						}
					},
				},
			],
			async authorize(inputs: Record<string, string> = {}) {
				const deploymentType = inputs.deploymentType || "github.com"
				let domain = "github.com"
				let actualProvider = "github-copilot"

				if (deploymentType === "enterprise") {
					domain = normalizeDomain(inputs.enterpriseUrl)
					actualProvider = "github-copilot-enterprise"
				}

				const urls = getCopilotUrls(domain)
				const deviceResponse = await fetch(urls.deviceCodeUrl, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						"User-Agent": "GitHubCopilotChat/0.35.0",
					},
					body: JSON.stringify({
						client_id: COPILOT_CLIENT_ID,
						scope: "read:user",
					}),
				})

				if (!deviceResponse.ok) throw new Error("Failed to initiate device authorization")

				const deviceData = await deviceResponse.json()

				return {
					url: deviceData.verification_uri,
					instructions: `Enter code: ${deviceData.user_code}`,
					method: "auto" as const,
					callback: async () => {
						while (true) {
							const response = await fetch(urls.accessTokenUrl, {
								method: "POST",
								headers: {
									Accept: "application/json",
									"Content-Type": "application/json",
									"User-Agent": "GitHubCopilotChat/0.35.0",
								},
								body: JSON.stringify({
									client_id: COPILOT_CLIENT_ID,
									device_code: deviceData.device_code,
									grant_type: "urn:ietf:params:oauth:grant-type:device_code",
								}),
							})

							if (!response.ok) return { type: "failed" as const }

							const data = await response.json()
							if (data.access_token) {
								return {
									type: "success" as const,
									refresh: data.access_token,
									access: "",
									expires: 0,
									...(actualProvider === "github-copilot-enterprise"
										? { provider: "github-copilot-enterprise" as const, enterpriseUrl: domain }
										: {}),
								}
							}

							if (data.error === "authorization_pending") {
								await new Promise((resolve) => setTimeout(resolve, deviceData.interval * 1000))
								continue
							}

							if (data.error) return { type: "failed" as const }
							await new Promise((resolve) => setTimeout(resolve, deviceData.interval * 1000))
						}
					},
				}
			},
		},
	]
}

function authToCredentials(auth: Auth & { type: "oauth" }): StoredCredentials {
	return {
		accessToken: auth.access,
		refreshToken: auth.refresh,
		expiresAt: auth.expires ?? null,
	}
}

async function defaultRefreshAccount(
	account: CopilotAccountRecord,
	_credentials: StoredCredentials,
	getAuth: () => Promise<Auth>,
): Promise<StoredCredentials> {
	const current = await getAuth()
	if (current.type !== "oauth") throw new Error("Current GitHub Copilot auth is not OAuth")
	if (hashAuthIdentity(current) !== account.identityKey) {
		throw new Error("Native GitHub Copilot auth does not match the selected account")
	}
	return authToCredentials(current)
}

async function ensureImportedNativeAccount(
	registry: AccountRegistry,
	getAuth: () => Promise<Auth>,
	secretStore: SecretStore,
	baseDir?: string,
): Promise<AccountRegistry> {
	if (registry.importDeclined) return registry
	const auth = await getAuth()
	const candidate = createImportedAuthCandidate(auth)
	if (!candidate) return registry

	const existing = registry.accounts.find((account) => account.identityKey === candidate.identityKey)
	const nextVersion = existing ? existing.credentialVersion + 1 : 1
	await secretStore.upsert(candidate.secretRef, nextVersion, authToCredentials(candidate.auth))

	return mutateRegistry((current) => {
		mergeImportedAccount(current, {
			identityKey: candidate.identityKey,
			label: candidate.label,
			secretRef: candidate.secretRef,
			credentialVersion: nextVersion,
			expiresAt: candidate.auth.expires ?? null,
			preferred: current.accounts.length === 0,
		})
		return current
	}, baseDir)
}

function createRetryResponse(retryAt: number | null, message: string): Response {
	const headers = new Headers({ "content-type": "application/json" })
	if (retryAt !== null) {
		headers.set("x-opencode-earliest-retry", String(retryAt))
		headers.set("retry-after", String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000))))
	}
	return new Response(JSON.stringify({ error: message, retryAt }), { status: 429, headers })
}

async function readAccountCredentials(secretStore: SecretStore, account: CopilotAccountRecord): Promise<StoredCredentials> {
	return secretStore.read(account.secretRef, account.credentialVersion)
}

async function persistRefreshedCredentials(
	secretStore: SecretStore,
	baseDir: string | undefined,
	account: CopilotAccountRecord,
	credentials: StoredCredentials,
): Promise<CopilotAccountRecord> {
	const nextVersion = account.credentialVersion + 1
	await secretStore.upsert(account.secretRef, nextVersion, credentials)
	const updatedRegistry = await mutateRegistry((current) => {
		const target = current.accounts.find((entry) => entry.id === account.id)
		if (!target) return current
		target.credentialVersion = nextVersion
		target.expiresAt = credentials.expiresAt
		target.status = "active"
		target.recoverableError = null
		target.cooldownUntil = null
		return current
	}, baseDir)
	return updatedRegistry.accounts.find((entry) => entry.id === account.id) ?? account
}

async function refreshAccountWithLease(
	account: CopilotAccountRecord,
	secretStore: SecretStore,
	baseDir: string | undefined,
	refreshAccount: RefreshAccount,
	log: PluginLogger,
): Promise<CopilotAccountRecord> {
	const leaseResult = await withRefreshLease({
		baseDir,
		accountId: account.id,
		expectedCredentialVersion: account.credentialVersion,
		reloadCurrentVersion: async () => {
			const registry = await loadRegistry(baseDir)
			return registry.accounts.find((entry) => entry.id === account.id)?.credentialVersion ?? account.credentialVersion
		},
		run: async () => {
			const currentCredentials = await readAccountCredentials(secretStore, account)
			const refreshed = await refreshAccount(account, currentCredentials)
			return persistRefreshedCredentials(secretStore, baseDir, account, refreshed)
		},
	})

	if (leaseResult.type === "acquired") {
		log.count("refresh.success")
		return leaseResult.value
	}
	if (leaseResult.type === "newer_credentials_visible") {
		const registry = await loadRegistry(baseDir)
		return registry.accounts.find((entry) => entry.id === account.id) ?? account
	}
	throw new Error(leaseResult.type === "timed_out" ? "Timed out waiting for refresh lease" : "Refresh retry required")
}

function needsRefresh(account: CopilotAccountRecord, now: number): boolean {
	return account.expiresAt !== null && account.expiresAt <= now + REFRESH_WINDOW_MS
}

export async function buildCopilotAuthOverride(options: BuildAuthOverrideOptions): Promise<Record<string, unknown>> {
	const capabilityGate = options.capabilityGate ?? (await loadCapabilityGateEvidence())
	assertCapabilityGate(capabilityGate)

	const log = options.log ?? createLogger(options.client)
	const secretStore = options.secretStore ?? createSecretStore({ baseDir: options.baseDir })
	const fetchImpl = options.fetchImpl ?? fetch
	const refreshAccount = options.refreshAccount ?? ((account, credentials) => defaultRefreshAccount(account, credentials, options.getAuth))

	let registry = await reconcileRegistry(secretStore, options.baseDir)
	registry = await ensureImportedNativeAccount(registry, options.getAuth, secretStore, options.baseDir)

	if (registry.importDeclined) {
		return {
			fetch: async (input: Request | string | URL, init?: RequestInit) => fetchImpl(input, init),
		}
	}

	return {
		fetch: async (input: Request | string | URL, init?: RequestInit) => {
			let currentRegistry = await reconcileRegistry(secretStore, options.baseDir)
			currentRegistry = await ensureImportedNativeAccount(currentRegistry, options.getAuth, secretStore, options.baseDir)
			const snapshot = await snapshotReplayableRequest(input, init)
			const replayable = canReplayRequest(snapshot)
			const requestUrl = input instanceof Request ? input.url : String(input)

			let currentAccount = pickEligibleAccount(currentRegistry, options.now?.() ?? Date.now())
			if (!currentAccount) {
				const retryAt = earliestRetryAt(currentRegistry)
				log.count("pool.exhausted", 1, { retryAt })
				return createRetryResponse(retryAt, "No eligible GitHub Copilot account is available")
			}

			let totalAttempts = 0
			let sameAccountRetries = 0
			const attemptedAccounts = new Set<string>()

			while (currentAccount && totalAttempts < MAX_TOTAL_ATTEMPTS) {
				totalAttempts += 1
				attemptedAccounts.add(currentAccount.id)

				if (needsRefresh(currentAccount, options.now?.() ?? Date.now())) {
					try {
						currentAccount = await refreshAccountWithLease(currentAccount, secretStore, options.baseDir, refreshAccount, log)
					} catch (error) {
						log.count("refresh.failure", 1, { accountId: currentAccount.id, error: String(error) })
						currentRegistry = await mutateRegistry((registryDraft) => {
							const target = registryDraft.accounts.find((entry) => entry.id === currentAccount!.id)
							if (target) {
								target.status = "reauth_required"
								target.recoverableError = {
									code: "refresh_failed",
									message: String(error),
									detectedAt: Date.now(),
									requiresReauth: true,
								}
							}
							return registryDraft
						}, options.baseDir)
						currentAccount = pickEligibleAccount(currentRegistry, options.now?.() ?? Date.now())
						continue
					}
				}

				const credentials = await readAccountCredentials(secretStore, currentAccount)
				const executeRequest = async () =>
					fetchImpl(
						snapshot?.url ?? requestUrl,
						snapshot ? buildReplayRequestInit(snapshot, credentials.accessToken) : init,
					)

				try {
					const response = await executeRequest()
					const bodyText = response.ok ? "" : await response.clone().text()
					const classification = classifyCopilotResponse(response, bodyText)
					log.count(`classifier.${classification.disposition}`, 1, { reason: classification.reason })

					if (classification.disposition === "success") {
						await mutateRegistry((registryDraft) => markAccountUsed(registryDraft, currentAccount!.id, "success"), options.baseDir)
						return response
					}

					if (classification.disposition === "refresh_and_retry" && replayable && sameAccountRetries < MAX_SAME_ACCOUNT_RETRIES) {
						sameAccountRetries += 1
						currentAccount = await refreshAccountWithLease(currentAccount, secretStore, options.baseDir, refreshAccount, log)
						continue
					}

					if (classification.disposition === "retry_same_account" && replayable && sameAccountRetries < MAX_SAME_ACCOUNT_RETRIES) {
						sameAccountRetries += 1
						continue
					}

					if (classification.disposition === "retry_same_account" && replayable) {
						currentRegistry = await mutateRegistry((registryDraft) => {
							applyAccountCooldown(
								registryDraft,
								currentAccount!.id,
								Date.now() + (classification.retryAfterMs ?? 1_000),
								classification.reason ?? "transient failure",
							)
							return registryDraft
						}, options.baseDir)
						currentAccount = pickEligibleAccount(currentRegistry, options.now?.() ?? Date.now())
						continue
					}

					if (classification.disposition === "rotate_account" && replayable) {
						currentRegistry = await mutateRegistry((registryDraft) => {
							applyAccountCooldown(
								registryDraft,
								currentAccount!.id,
								classification.retryAt ?? Date.now() + 60_000,
								classification.reason ?? "rate limited",
							)
							return registryDraft
						}, options.baseDir)
						const nextAccount = pickEligibleAccount(currentRegistry, options.now?.() ?? Date.now())
						if (!nextAccount || attemptedAccounts.has(nextAccount.id)) {
							return createRetryResponse(earliestRetryAt(currentRegistry), "All accounts are cooling down")
						}
						await mutateRegistry((registryDraft) => setActiveAccount(registryDraft, nextAccount.id), options.baseDir)
						log.count("rotation", 1, { from: currentAccount.id, to: nextAccount.id })
						currentAccount = nextAccount
						sameAccountRetries = 0
						continue
					}

					if (classification.disposition === "fail_with_retry_time") {
						currentRegistry = await mutateRegistry((registryDraft) => {
							applySharedBackoff(
								registryDraft,
								classification.retryAt ?? Date.now() + 30_000,
								classification.reason ?? "shared throttling",
							)
							return registryDraft
						}, options.baseDir)
						log.count("shared_backoff", 1, { retryAt: classification.retryAt })
						return response
					}

					return response
				} catch (error) {
					const classification = classifyCopilotFailure(error)
					log.count(`classifier.${classification.disposition}`, 1, { reason: classification.reason })
					if (classification.disposition === "retry_same_account" && replayable && sameAccountRetries < MAX_SAME_ACCOUNT_RETRIES) {
						sameAccountRetries += 1
						continue
					}
					if (classification.disposition === "retry_same_account" && replayable) {
						currentRegistry = await mutateRegistry((registryDraft) => {
							applyAccountCooldown(registryDraft, currentAccount!.id, Date.now() + 1_000, classification.reason ?? "transport failure")
							return registryDraft
						}, options.baseDir)
						currentAccount = pickEligibleAccount(currentRegistry, options.now?.() ?? Date.now())
						continue
					}
					throw error
				}
			}

			return createRetryResponse(earliestRetryAt(currentRegistry), "GitHub Copilot multi-account retry budget exhausted")
		},
	}
}

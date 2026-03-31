import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import * as path from "node:path"

import type { Auth } from "@opencode-ai/sdk"

import { capabilityGateEvidenceSchema } from "./schema"

export const PLUGIN_ID = "github-copilot-multi-account"
export const KEYCHAIN_SERVICE = "opencode.github-copilot-multi-account"
export const REGISTRY_FILE_NAME = "registry.json"
export const LEASE_DIRECTORY_NAME = "leases"
export const OPAQUE_ACCOUNT_ID_PATTERN = /^copilot-acct-[a-f0-9]+$/i
export const REFRESH_WINDOW_MS = 60_000
export const LEASE_TIMEOUT_MS = 2_000
export const LEASE_POLL_MS = 100
export const LEASE_TTL_MS = 2_500
export const MAX_TOTAL_ATTEMPTS = 5
export const MAX_SAME_ACCOUNT_RETRIES = 1

export interface CapabilityGateEvidence {
	authMethodShape: string
	loaderShape: string
	opencodeVersion: string
	pluginVersion: string
	providerId: "github-copilot"
	authMethodId: string
	validationCommand: string
	probeScript: string
	validationDate: string
	providerContractSummary: string
	refreshContractSummary: string
	requestFixtureHash: string
	responseFixtureHash: string
	replayProof: string
	persistenceProof: string
	transportOverrideProof: string
	canInspectResponse: boolean
	canReplayBufferedRequest: boolean
	canPersistDuringRequest: boolean
	canOverrideTransport: boolean
	goNoGo: "go" | "stop"
}

export interface StoredCredentials {
	accessToken: string
	refreshToken: string
	expiresAt: number | null
}

export interface RecoverableErrorState {
	code: string
	message: string
	detectedAt: number
	requiresReauth: boolean
}

export type AccountStatus = "active" | "cooldown" | "reauth_required" | "disabled" | "removed"

export interface CopilotAccountRecord {
	id: string
	identityKey: string
	label: string
	secretRef: string
	credentialVersion: number
	status: AccountStatus
	expiresAt: number | null
	cooldownUntil: number | null
	modelCooldowns: Record<string, number>
	preferred: boolean
	lastUsedAt: number | null
	lastSwitchReason: string | null
	recentFailureReason: string | null
	recentFailureAt: number | null
	recoverableError: RecoverableErrorState | null
	schemaVersion: 1
}

export interface AccountRegistry {
	version: 1
	revision: number
	importDeclined: boolean
	activeAccountId: string | null
	sharedBackoffUntil: number | null
	sharedBackoffScope: "provider" | "model-family" | null
	sharedBackoffReason: string | null
	accounts: CopilotAccountRecord[]
}

export interface ReplaySnapshot {
	method: string
	headers: Headers
	bodyText?: string
	bodyBytes?: Uint8Array
	url?: string
	streaming: boolean
}

export type ResponseDisposition =
	| "success"
	| "refresh_and_retry"
	| "rotate_account"
	| "retry_same_account"
	| "fail_with_retry_time"
	| "fail_request"
	| "fail_without_rotation"

export interface ClassifierResult {
	disposition: ResponseDisposition
	retryAt?: number
	retryAfterMs?: number
	cooldownScope?: "account" | "provider" | "model-family"
	reason?: string
	accountScoped?: boolean
}

export interface SecretStore {
	upsert(ref: string, version: number, value: StoredCredentials): Promise<void>
	read(ref: string, version: number): Promise<StoredCredentials>
	listVersions(ref: string): Promise<number[]>
	removeVersion(ref: string, version: number): Promise<void>
	removeAll(ref: string): Promise<void>
}

export interface RefreshLease {
	accountId: string
	ownerId: string
	expiresAt: number
	expectedCredentialVersion: number
}

export type RefreshLeaseOutcome<T> =
	| { type: "acquired"; value: T }
	| { type: "newer_credentials_visible"; credentialVersion: number }
	| { type: "retry" }
	| { type: "timed_out" }

export interface PluginLogger {
	debug(message: string, extra?: unknown): void
	info(message: string, extra?: unknown): void
	warn(message: string, extra?: unknown): void
	error(message: string, extra?: unknown): void
	count(metric: string, value?: number, extra?: unknown): void
}

export interface ImportedAuthCandidate {
	auth: Auth & { type: "oauth" }
	identityKey: string
	label: string
	secretRef: string
}

export class UnsupportedSecretStoreError extends Error {
	constructor(message = "GitHub Copilot multi-account requires a supported secret store") {
		super(message)
		this.name = "UnsupportedSecretStoreError"
	}
}

export class SecretStoreUnavailableError extends Error {
	constructor(message = "The secret store is temporarily unavailable or locked") {
		super(message)
		this.name = "SecretStoreUnavailableError"
	}
}

export class SecretStoreCorruptError extends Error {
	constructor(message = "Stored credentials are missing or corrupt") {
		super(message)
		this.name = "SecretStoreCorruptError"
	}
}

export function isOpaqueAccountId(value: string): boolean {
	return OPAQUE_ACCOUNT_ID_PATTERN.test(value)
}

export function createOpaqueAccountId(seed?: string): string {
	const input = seed ?? `${Date.now()}:${Math.random()}`
	return `copilot-acct-${createHash("sha256").update(input).digest("hex").slice(0, 12)}`
}

export function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex")
}

export function hashAuthIdentity(auth: Auth & { type: "oauth" }): string {
	return hashValue(`${auth.refresh}:${auth.access}:${auth.expires}:${auth.enterpriseUrl ?? ""}`)
}

export function createLabelFromIdentity(identityKey: string): string {
	return `GitHub Copilot ${identityKey.slice(0, 8)}`
}

export function createSecretRef(identityKey: string): string {
	return `copilot-secret-${identityKey.slice(0, 16)}`
}

export function createImportedAuthCandidate(auth: Auth): ImportedAuthCandidate | null {
	if (auth.type !== "oauth") return null
	const identityKey = hashAuthIdentity(auth)
	return {
		auth,
		identityKey,
		label: createLabelFromIdentity(identityKey),
		secretRef: createSecretRef(identityKey),
	}
}

export async function loadCapabilityGateEvidence(): Promise<CapabilityGateEvidence> {
	const filePath = path.join(import.meta.dir, "capability-gate.json")
	const raw = await readFile(filePath, "utf8")
	return capabilityGateEvidenceSchema.parse(JSON.parse(raw)) as CapabilityGateEvidence
}

export function assertCapabilityGate(evidence: CapabilityGateEvidence): void {
	if (
		!evidence.authMethodShape ||
		!evidence.loaderShape ||
		!evidence.opencodeVersion ||
		!evidence.pluginVersion ||
		evidence.providerId !== "github-copilot" ||
		!evidence.authMethodId ||
		!evidence.validationCommand ||
		!evidence.probeScript ||
		!evidence.validationDate ||
		!evidence.providerContractSummary ||
		!evidence.refreshContractSummary ||
		!evidence.requestFixtureHash ||
		!evidence.responseFixtureHash ||
		!evidence.replayProof ||
		!evidence.persistenceProof ||
		!evidence.transportOverrideProof ||
		evidence.goNoGo !== "go" ||
		!evidence.canInspectResponse ||
		!evidence.canReplayBufferedRequest ||
		!evidence.canPersistDuringRequest ||
		!evidence.canOverrideTransport
	) {
		throw new Error(
			"github-copilot multi-account requires response-aware auth override support; stop v1 and return to design",
		)
	}
}

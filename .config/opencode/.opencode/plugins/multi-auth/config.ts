/**
 * multi-auth plugin config parsing and validation.
 *
 * Config arrives via the opencode `config` hook (namespaced under
 * plugin["multi-auth"]). Tokens never live here — only priorities and policy.
 *
 * F1: origin allowlist / redirect policy are NOT configurable. Keys such as
 * allowedOrigins, apiOrigins, followRedirects are stripped and never appear
 * on the resolved config type.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotifyMode = "toast" | "log" | "silent"

export type RetryReason = "quota" | "rate_limit"

export interface AccountConfig {
	label: string
	/** Lower number = higher priority. Duplicates allowed (selector tie-breaks). */
	priority: number
	disabled: boolean
}

export interface FailoverConfig {
	maxAttemptsPerRequest: number
	retryOn: RetryReason[]
	/** F2: bodies larger than this are single-attempt (no fallback replay). */
	maxReplayBodyBytes: number
	notify: NotifyMode
}

export interface ProviderConfig {
	enabled: boolean
	accounts: AccountConfig[]
	defaultCooldownSeconds: number
	maxCooldownSeconds: number
	refreshSkewSeconds: number
	/** Prefer the account already serving this session (anti-abuse + cache). */
	stickyWithinSession: boolean
	failover: FailoverConfig
}

export interface ResolvedConfig {
	providers: Record<string, ProviderConfig>
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_COOLDOWN_SECONDS = 300
export const DEFAULT_MAX_COOLDOWN_SECONDS = 18000
export const DEFAULT_REFRESH_SKEW_SECONDS = 120
export const DEFAULT_STICKY_WITHIN_SESSION = true
export const DEFAULT_MAX_ATTEMPTS_PER_REQUEST = 3
export const DEFAULT_MAX_REPLAY_BODY_BYTES = 10_485_760
export const DEFAULT_NOTIFY: NotifyMode = "toast"
export const DEFAULT_RETRY_ON: readonly RetryReason[] = ["quota", "rate_limit"]

/** Priority base for store accounts absent from config: 100 + insertionIndex. */
export const UNKNOWN_ACCOUNT_PRIORITY_BASE = 100

const NOTIFY_MODES = new Set<NotifyMode>(["toast", "log", "silent"])
const RETRY_REASONS = new Set<RetryReason>(["quota", "rate_limit"])

/**
 * F1: keys that must never influence resolved config. Stripped (with warn).
 * Matching is case-sensitive on the raw object keys as provided.
 */
const FORBIDDEN_CONFIG_KEYS = new Set([
	"allowedOrigins",
	"apiOrigins",
	"followRedirects",
	"redirect",
	"redirectPolicy",
	"originAllowlist",
	"allowOrigins",
	"allowed_origins",
	"api_origins",
	"follow_redirects",
])

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
	readonly path: string

	constructor(path: string, message: string) {
		super(path ? `${path}: ${message}` : message)
		this.name = "ConfigError"
		this.path = path
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripForbiddenKeys(obj: Record<string, unknown>, path: string): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(obj)) {
		if (FORBIDDEN_CONFIG_KEYS.has(key)) {
			console.warn(
				`[multi-auth] ignoring non-configurable key "${path ? `${path}.` : ""}${key}" (F1: origin allowlist / redirect policy are hardcoded)`,
			)
			continue
		}
		out[key] = value
	}
	return out
}

function expectBoolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") {
		throw new ConfigError(path, `expected boolean, got ${typeName(value)}`)
	}
	return value
}

function expectNumber(value: unknown, path: string, opts?: { min?: number; integer?: boolean }): number {
	if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
		throw new ConfigError(path, `expected finite number, got ${typeName(value)}`)
	}
	if (opts?.integer && !Number.isInteger(value)) {
		throw new ConfigError(path, `expected integer, got ${value}`)
	}
	if (opts?.min !== undefined && value < opts.min) {
		throw new ConfigError(path, `must be >= ${opts.min}, got ${value}`)
	}
	return value
}

function expectNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new ConfigError(path, `expected string, got ${typeName(value)}`)
	}
	if (value.length === 0) {
		throw new ConfigError(path, "must be a non-empty string")
	}
	return value
}

function typeName(value: unknown): string {
	if (value === null) return "null"
	if (Array.isArray(value)) return "array"
	return typeof value
}

function defaultFailover(): FailoverConfig {
	return {
		maxAttemptsPerRequest: DEFAULT_MAX_ATTEMPTS_PER_REQUEST,
		retryOn: [...DEFAULT_RETRY_ON],
		maxReplayBodyBytes: DEFAULT_MAX_REPLAY_BODY_BYTES,
		notify: DEFAULT_NOTIFY,
	}
}

function defaultProviderConfig(): ProviderConfig {
	return {
		enabled: true,
		accounts: [],
		defaultCooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
		maxCooldownSeconds: DEFAULT_MAX_COOLDOWN_SECONDS,
		refreshSkewSeconds: DEFAULT_REFRESH_SKEW_SECONDS,
		stickyWithinSession: DEFAULT_STICKY_WITHIN_SESSION,
		failover: defaultFailover(),
	}
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseAccount(raw: unknown, path: string): AccountConfig {
	if (!isPlainObject(raw)) {
		throw new ConfigError(path, `expected object, got ${typeName(raw)}`)
	}
	const obj = stripForbiddenKeys(raw, path)

	if (!("label" in obj)) {
		throw new ConfigError(`${path}.label`, "required")
	}
	if (!("priority" in obj)) {
		throw new ConfigError(`${path}.priority`, "required")
	}

	const label = expectNonEmptyString(obj.label, `${path}.label`)
	const priority = expectNumber(obj.priority, `${path}.priority`, { integer: true })
	const disabled =
		"disabled" in obj && obj.disabled !== undefined
			? expectBoolean(obj.disabled, `${path}.disabled`)
			: false

	// Reject unknown keys that look like security overrides at account level too
	return { label, priority, disabled }
}

function parseRetryOn(raw: unknown, path: string): RetryReason[] {
	if (!Array.isArray(raw)) {
		throw new ConfigError(path, `expected array, got ${typeName(raw)}`)
	}
	if (raw.length === 0) {
		throw new ConfigError(path, "must be a non-empty array")
	}
	const out: RetryReason[] = []
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i]
		const itemPath = `${path}[${i}]`
		if (typeof item !== "string" || !RETRY_REASONS.has(item as RetryReason)) {
			throw new ConfigError(
				itemPath,
				`expected one of ${[...RETRY_REASONS].join(" | ")}, got ${JSON.stringify(item)}`,
			)
		}
		out.push(item as RetryReason)
	}
	return out
}

function parseFailover(raw: unknown, path: string): FailoverConfig {
	if (raw === undefined) {
		return defaultFailover()
	}
	if (!isPlainObject(raw)) {
		throw new ConfigError(path, `expected object, got ${typeName(raw)}`)
	}
	const obj = stripForbiddenKeys(raw, path)
	const base = defaultFailover()

	const maxAttemptsPerRequest =
		"maxAttemptsPerRequest" in obj && obj.maxAttemptsPerRequest !== undefined
			? expectNumber(obj.maxAttemptsPerRequest, `${path}.maxAttemptsPerRequest`, {
					min: 1,
					integer: true,
				})
			: base.maxAttemptsPerRequest

	const retryOn =
		"retryOn" in obj && obj.retryOn !== undefined
			? parseRetryOn(obj.retryOn, `${path}.retryOn`)
			: base.retryOn

	const maxReplayBodyBytes =
		"maxReplayBodyBytes" in obj && obj.maxReplayBodyBytes !== undefined
			? expectNumber(obj.maxReplayBodyBytes, `${path}.maxReplayBodyBytes`, {
					min: 0,
					integer: true,
				})
			: base.maxReplayBodyBytes

	let notify = base.notify
	if ("notify" in obj && obj.notify !== undefined) {
		if (typeof obj.notify !== "string" || !NOTIFY_MODES.has(obj.notify as NotifyMode)) {
			throw new ConfigError(
				`${path}.notify`,
				`expected one of ${[...NOTIFY_MODES].join(" | ")}, got ${JSON.stringify(obj.notify)}`,
			)
		}
		notify = obj.notify as NotifyMode
	}

	return { maxAttemptsPerRequest, retryOn, maxReplayBodyBytes, notify }
}

function parseProvider(raw: unknown, path: string): ProviderConfig {
	if (!isPlainObject(raw)) {
		throw new ConfigError(path, `expected object, got ${typeName(raw)}`)
	}
	const obj = stripForbiddenKeys(raw, path)
	const base = defaultProviderConfig()

	const enabled =
		"enabled" in obj && obj.enabled !== undefined
			? expectBoolean(obj.enabled, `${path}.enabled`)
			: base.enabled

	let accounts: AccountConfig[] = base.accounts
	if ("accounts" in obj && obj.accounts !== undefined) {
		if (!Array.isArray(obj.accounts)) {
			throw new ConfigError(`${path}.accounts`, `expected array, got ${typeName(obj.accounts)}`)
		}
		accounts = obj.accounts.map((item, i) => parseAccount(item, `${path}.accounts[${i}]`))
		const seen = new Map<string, number>()
		for (let i = 0; i < accounts.length; i++) {
			const label = accounts[i]!.label
			const prev = seen.get(label)
			if (prev !== undefined) {
				throw new ConfigError(
					`${path}.accounts[${i}].label`,
					`duplicate account label "${label}" (also at ${path}.accounts[${prev}].label)`,
				)
			}
			seen.set(label, i)
		}
	}

	const defaultCooldownSeconds =
		"defaultCooldownSeconds" in obj && obj.defaultCooldownSeconds !== undefined
			? expectNumber(obj.defaultCooldownSeconds, `${path}.defaultCooldownSeconds`, {
					min: 0,
					integer: true,
				})
			: base.defaultCooldownSeconds

	const maxCooldownSeconds =
		"maxCooldownSeconds" in obj && obj.maxCooldownSeconds !== undefined
			? expectNumber(obj.maxCooldownSeconds, `${path}.maxCooldownSeconds`, {
					min: 0,
					integer: true,
				})
			: base.maxCooldownSeconds

	const refreshSkewSeconds =
		"refreshSkewSeconds" in obj && obj.refreshSkewSeconds !== undefined
			? expectNumber(obj.refreshSkewSeconds, `${path}.refreshSkewSeconds`, {
					min: 0,
					integer: true,
				})
			: base.refreshSkewSeconds

	const stickyWithinSession =
		"stickyWithinSession" in obj && obj.stickyWithinSession !== undefined
			? expectBoolean(obj.stickyWithinSession, `${path}.stickyWithinSession`)
			: base.stickyWithinSession

	const failover = parseFailover(obj.failover, `${path}.failover`)

	return {
		enabled,
		accounts,
		defaultCooldownSeconds,
		maxCooldownSeconds,
		refreshSkewSeconds,
		stickyWithinSession,
		failover,
	}
}

/**
 * Parse and validate multi-auth plugin config.
 *
 * Accepts `undefined` / `null` / `{}` → empty providers map (nothing enabled).
 * Applies defaults for every optional field on present providers.
 *
 * @throws {ConfigError} on wrong types, negative numbers, bad notify, duplicate labels
 */
export function parseConfig(raw: unknown): ResolvedConfig {
	if (raw === undefined || raw === null) {
		return { providers: {} }
	}
	if (!isPlainObject(raw)) {
		throw new ConfigError("", `expected object, got ${typeName(raw)}`)
	}

	const root = stripForbiddenKeys(raw, "")

	if (!("providers" in root) || root.providers === undefined) {
		return { providers: {} }
	}

	if (!isPlainObject(root.providers)) {
		throw new ConfigError("providers", `expected object, got ${typeName(root.providers)}`)
	}

	const providersRaw = stripForbiddenKeys(root.providers, "providers")
	const providers: Record<string, ProviderConfig> = {}

	for (const [providerId, providerRaw] of Object.entries(providersRaw)) {
		if (providerId.length === 0) {
			throw new ConfigError("providers", "provider id must be a non-empty string")
		}
		providers[providerId] = parseProvider(providerRaw, `providers.${providerId}`)
	}

	return { providers }
}

/**
 * Resolve effective priority for an account label.
 *
 * Config accounts use their configured priority. Store accounts absent from
 * config get `100 + insertionIndex` (still usable, lowest priority band).
 */
export function effectivePriority(
	label: string,
	providerConfig: ProviderConfig,
	insertionIndex: number,
): number {
	const found = providerConfig.accounts.find((a) => a.label === label)
	if (found) {
		return found.priority
	}
	return UNKNOWN_ACCOUNT_PRIORITY_BASE + insertionIndex
}

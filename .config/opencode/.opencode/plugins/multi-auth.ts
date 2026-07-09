/**
 * multi-auth — opencode plugin entry.
 *
 * Multiplexes N OAuth accounts behind a single provider via a custom fetch
 * returned from the auth loader. Default state (no config / no enabled
 * providers) is fully inert: empty hooks, no store dirs, no auth registration.
 *
 * Note: Hooks.auth is singular per plugin. Last plugin registering the same
 * provider ID wins (undefined behavior if another auth plugin also targets
 * anthropic — not detectable at this API version).
 *
 * @module multi-auth
 */

import type {
	AuthHook,
	AuthOAuthResult,
	Config,
	Hooks,
	Plugin,
	PluginInput,
	PluginOptions,
} from "@opencode-ai/plugin"
import type { Provider } from "@opencode-ai/sdk"
import type { Auth } from "@opencode-ai/sdk/v2"
import {
	anthropicAdapter,
	createAnthropicAdapter,
} from "./multi-auth/adapters/anthropic"
import type {
	AuthorizeDeps,
	ProviderAdapter,
} from "./multi-auth/adapters/types"
import {
	parseConfig,
	type ProviderConfig,
	type ResolvedConfig,
} from "./multi-auth/config"
import {
	createFetchWrapper,
	PLACEHOLDER_API_KEY,
	type Logger,
} from "./multi-auth/fetch-wrapper"
import { MultiAuthStore, type OAuthAccount } from "./multi-auth/store"
import { createStatus, type StatusClient } from "./multi-auth/status"

// =============================================================================
// CONSTANTS
// =============================================================================

const SERVICE = "multi-auth"

/** v1: only anthropic is wired. */
const V1_PROVIDERS = new Set(["anthropic"])

const AUTH_METHOD_LABEL = "Multi-account (add account)"

// =============================================================================
// OPTIONS / TEST HOOKS
// =============================================================================

/**
 * Plugin options (tuple form in opencode.jsonc) plus test-only injection seams.
 *
 * Production config shape:
 * ```jsonc
 * { "providers": { "anthropic": { "enabled": true, ... } } }
 * ```
 */
export type MultiAuthPluginOptions = PluginOptions & {
	providers?: ResolvedConfig["providers"] | Record<string, unknown>
	/** @internal Test: override store base directory. */
	storeBaseDir?: string
	/** @internal Test: override / inject adapter. */
	adapter?: ProviderAdapter
	/** @internal Test: deps forwarded to adapter.authorize (fake OAuth, etc.). */
	authorizeDeps?: AuthorizeDeps
}

// =============================================================================
// HELPERS
// =============================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Extract multi-auth raw config from plugin options and/or full opencode config.
 */
export function extractMultiAuthRaw(
	options?: PluginOptions | MultiAuthPluginOptions | null,
	config?: Config | null,
): unknown {
	// 1. Explicit plugin options (tuple form)
	if (options && isPlainObject(options)) {
		if ("providers" in options) {
			const { storeBaseDir: _s, adapter: _a, authorizeDeps: _d, ...rest } =
				options as MultiAuthPluginOptions
			// If only test hooks were passed with no providers, fall through
			if ("providers" in rest || Object.keys(rest).length > 0) {
				return rest
			}
		}
		// Nested under multi-auth key
		if ("multi-auth" in options) {
			return (options as Record<string, unknown>)["multi-auth"]
		}
	}

	if (config) {
		const cfg = config as Config & Record<string, unknown>

		// 2. Plan-style: plugin: { "multi-auth": { ... } } (non-array)
		if (isPlainObject(cfg.plugin) && !Array.isArray(cfg.plugin)) {
			const nested = (cfg.plugin as Record<string, unknown>)["multi-auth"]
			if (nested !== undefined) return nested
		}

		// 3. Array form: find multi-auth entry with options
		if (Array.isArray(cfg.plugin)) {
			for (const entry of cfg.plugin) {
				if (!Array.isArray(entry)) continue
				const [id, opts] = entry
				if (
					typeof id === "string" &&
					id.includes("multi-auth") &&
					opts &&
					isPlainObject(opts)
				) {
					return opts
				}
			}
		}

		// 4. Top-level multi-auth key (if present on config object)
		if (cfg["multi-auth"] !== undefined) {
			return cfg["multi-auth"]
		}
	}

	return options ?? undefined
}

function hasEnabledV1Provider(resolved: ResolvedConfig): boolean {
	for (const [id, provider] of Object.entries(resolved.providers)) {
		if (V1_PROVIDERS.has(id) && provider.enabled) return true
	}
	return false
}

function createPluginLogger(
	client: PluginInput["client"] | undefined,
): Logger {
	const log = (level: "debug" | "info" | "warn" | "error", message: string) => {
		if (client?.app?.log) {
			void client.app
				.log({ body: { service: SERVICE, level, message } })
				.catch(() => {
					console[level]?.(`[${SERVICE}] ${message}`)
				})
			return
		}
		;(console[level] ?? console.log)?.(`[${SERVICE}] ${message}`)
	}
	return {
		debug: (msg: string) => log("debug", String(msg)),
		info: (msg: string) => log("info", String(msg)),
		warn: (msg: string) => log("warn", String(msg)),
		error: (msg: string) => log("error", String(msg)),
		log: (msg: string) => log("info", String(msg)),
	}
}

function parsePriorityInput(raw: string | undefined): number | undefined {
	if (raw === undefined || raw === null || raw === "") return undefined
	const n = Number(raw)
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined
	return n
}

async function nextGeneratedLabel(store: MultiAuthStore): Promise<string> {
	const existing = await store.listAccounts()
	const labels = new Set(existing.map((a) => a.label))
	let n = 1
	while (labels.has(`account-${n}`)) n += 1
	return `account-${n}`
}

async function resolveLabel(
	inputs: Record<string, string> | undefined,
	store: MultiAuthStore,
): Promise<string> {
	const fromPrompt = inputs?.label?.trim()
	if (fromPrompt) return fromPrompt
	return nextGeneratedLabel(store)
}

function buildOAuthAccount(
	tokens: { access: string; refresh: string; expires: number },
	meta?: Record<string, unknown>,
): OAuthAccount {
	return {
		type: "oauth",
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
		state: "available",
		resetAt: null,
		addedAt: Date.now(),
		lastUsedAt: null,
		lastExhaustedAt: null,
		meta,
	}
}

// =============================================================================
// AUTH HOOK BUILDER
// =============================================================================

export type BuildAuthHookOptions = {
	providerId: "anthropic"
	configRef: { current: ResolvedConfig }
	storeBaseDir?: string
	adapter?: ProviderAdapter
	authorizeDeps?: AuthorizeDeps
	client?: StatusClient | null
	logger: Logger
}

/**
 * Build the auth hook for one enabled provider.
 * Exported for unit tests that want the hook without the full Plugin lifecycle.
 */
export function buildAuthHook(opts: BuildAuthHookOptions): AuthHook {
	const {
		providerId,
		configRef,
		storeBaseDir,
		adapter: adapterOverride,
		authorizeDeps,
		client,
		logger,
	} = opts

	const adapter: ProviderAdapter = adapterOverride ?? anthropicAdapter

	const store = new MultiAuthStore(providerId, {
		baseDir: storeBaseDir,
	})

	const getProviderConfig = (): ProviderConfig => {
		const cfg = configRef.current.providers[providerId]
		if (!cfg) {
			// Should not happen when hook is registered; safe fallback
			return parseConfig({
				providers: { [providerId]: { enabled: true } },
			}).providers[providerId]!
		}
		return cfg
	}

	const statusFor = () => {
		const mode = getProviderConfig().failover.notify
		return createStatus({ client, mode, logger, service: SERVICE })
	}

	return {
		provider: providerId,
		// Prompts supported on AuthHook oauth methods at 1.17.x
		methods: [
			{
				type: "oauth",
				label: AUTH_METHOD_LABEL,
				prompts: [
					{
						type: "text",
						key: "label",
						message: "Account label",
						placeholder: "work-max",
						validate: (value: string) => {
							if (value !== undefined && value !== null && value.trim() === "") {
								return "Label must be non-empty when provided"
							}
							return undefined
						},
					},
					{
						type: "text",
						key: "priority",
						message: "Priority (lower = higher priority; optional)",
						placeholder: "1",
						validate: (value: string) => {
							if (value === undefined || value === null || value === "") {
								return undefined
							}
							if (!/^\d+$/.test(value.trim())) {
								return "Priority must be a non-negative integer"
							}
							return undefined
						},
					},
				],
				async authorize(
					inputs?: Record<string, string>,
				): Promise<AuthOAuthResult> {
					const label = await resolveLabel(inputs, store)
					const priority = parsePriorityInput(inputs?.priority)

					type ReadyInfo = {
						authorizeUrl: string
						redirectUri: string
						state: string
					}

					let resolveReady!: (info: ReadyInfo) => void
					const readyPromise = new Promise<ReadyInfo>((resolve) => {
						resolveReady = resolve
					})

					const deps: AuthorizeDeps = {
						...authorizeDeps,
						onReady: async (info) => {
							resolveReady({
								authorizeUrl: info.authorizeUrl,
								redirectUri: info.redirectUri,
								state: info.state,
							})
							await authorizeDeps?.onReady?.(info)
						},
						// Opencode opens the URL from AuthOAuthResult.url; avoid double-open
						// unless a test injects openUrl.
						openUrl: authorizeDeps?.openUrl,
					}

					const resultPromise = adapter.authorize({ label }, deps)

					const ready = await readyPromise

					return {
						url: ready.authorizeUrl,
						instructions:
							"Complete Claude OAuth in the browser. If the page does not open, paste the URL above. For manual code paste, use the code entry flow when prompted.",
						method: "auto",
						callback: async () => {
							const result = await resultPromise
							if (result.type === "failed") {
								logger.warn?.(
									`authorize failed for label=${label}: ${result.reason}`,
								)
								return { type: "failed" as const }
							}

							const meta: Record<string, unknown> = {
								...(result.meta ?? {}),
							}
							if (priority !== undefined) {
								meta.priority = priority
							}

							await store.upsertAccount(
								result.label || label,
								buildOAuthAccount(
									{
										access: result.access,
										refresh: result.refresh,
										expires: result.expires,
									},
									Object.keys(meta).length > 0 ? meta : undefined,
								),
							)

							statusFor().accountAdded(result.label || label)
							logger.info?.(
								`account added: ${result.label || label} (provider=${providerId})`,
							)

							// Sentinel for auth.json single slot (overwritten each login).
							// Real multi-account tokens live only in the plugin store.
							return {
								type: "success" as const,
								refresh: result.refresh,
								access: result.access,
								expires: result.expires,
							}
						},
					}
				},
			},
		],
		async loader(
			_getAuth: () => Promise<Auth>,
			_provider: Provider,
		): Promise<Record<string, unknown>> {
			const providerConfig = getProviderConfig()
			if (!providerConfig.enabled) {
				return {}
			}

			const status = statusFor()
			const wrappedFetch = createFetchWrapper({
				store,
				adapter,
				providerConfig,
				notify: status.notify,
				logger,
			})

			return {
				apiKey: PLACEHOLDER_API_KEY,
				fetch: wrappedFetch,
			}
		},
	}
}

// =============================================================================
// PLUGIN
// =============================================================================

/**
 * multi-auth plugin.
 *
 * Inert unless options (or extractable config) enable at least one v1 provider.
 * Auto-loaded from `.opencode/plugins/` without options → empty hooks.
 */
export const MultiAuthPlugin: Plugin = async (
	input: PluginInput,
	options?: PluginOptions,
): Promise<Hooks> => {
	const logger = createPluginLogger(input.client)
	const pluginOpts = options as MultiAuthPluginOptions | undefined

	let resolved: ResolvedConfig
	try {
		resolved = parseConfig(extractMultiAuthRaw(pluginOpts))
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		logger.warn?.(`invalid multi-auth options at load; staying inert: ${msg}`)
		return {}
	}

	if (!hasEnabledV1Provider(resolved)) {
		// Fully inert: no store dirs, no auth hook.
		// Still accept a config hook so a later config push can be observed in logs,
		// but do not register auth (cannot add hooks retroactively).
		return {}
	}

	// Mutable snapshot — config hook + loader/authorize read this.
	const configRef = { current: resolved }

	// Duplicate-hook note: another plugin registering auth for the same provider
	// is undefined behavior (last hook wins). Not detectable via PluginInput at
	// 1.17.x — log a best-effort advisory when we take over anthropic.
	logger.info?.(
		"registering multi-auth for anthropic (if another plugin also provides anthropic auth, last hook wins — undefined behavior)",
	)

	const auth = buildAuthHook({
		providerId: "anthropic",
		configRef,
		storeBaseDir: pluginOpts?.storeBaseDir,
		adapter: pluginOpts?.adapter,
		authorizeDeps: pluginOpts?.authorizeDeps,
		client: input.client as StatusClient,
		logger,
	})

	return {
		/**
		 * Snapshot multi-auth config from the live opencode config.
		 * Priorities / policy updates apply to subsequent loader/fetch reads
		 * via configRef (loader itself is not re-run).
		 */
		config: async (cfg: Config) => {
			try {
				const raw = extractMultiAuthRaw(pluginOpts, cfg)
				configRef.current = parseConfig(raw)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				logger.warn?.(`multi-auth config update ignored: ${msg}`)
			}
		},
		auth,
	}
}

export default MultiAuthPlugin

// Re-exports useful for tests / composition
export { PLACEHOLDER_API_KEY } from "./multi-auth/fetch-wrapper"
export { createStatus } from "./multi-auth/status"
export { createAnthropicAdapter, anthropicAdapter }

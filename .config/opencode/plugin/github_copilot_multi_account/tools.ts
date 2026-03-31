import { tool } from "@opencode-ai/plugin"

import { disableAccount, earliestRetryAt, enableAccount, setActiveAccount } from "./accounts"
import { createLogger } from "./logger"
import { loadRegistry, mutateRegistry, tombstoneAccount } from "./storage"

type ToolOptions = {
	client: any
	baseDir?: string
}

function summarizeAccount(account: any) {
	return {
		id: account.id,
		status: account.status,
		preferred: account.preferred,
		expiresAt: account.expiresAt,
		cooldownUntil: account.cooldownUntil,
		recoverableError: account.recoverableError,
	}
}

export function createManagementTools(options: ToolOptions) {
	const log = createLogger(options.client)

	return {
		list_accounts: tool({
			description: "List the registered GitHub Copilot account pool state.",
			args: {},
			async execute() {
				const registry = await loadRegistry(options.baseDir)
				return JSON.stringify(registry.accounts.map(summarizeAccount), null, 2)
			},
		}),
		show_pool_status: tool({
			description: "Show the current multi-account pool summary.",
			args: {},
			async execute() {
				const registry = await loadRegistry(options.baseDir)
				return JSON.stringify(
					{
						activeAccountId: registry.activeAccountId,
						accountCount: registry.accounts.length,
						earliestRetryAt: earliestRetryAt(registry),
						sharedBackoffUntil: registry.sharedBackoffUntil,
					},
					null,
					2,
				)
			},
		}),
		set_active_account: tool({
			description: "Prefer one GitHub Copilot account until it fails or is changed manually.",
			args: {
				accountId: tool.schema.string().describe("Opaque account id like copilot-acct-abc123"),
			},
			async execute(args) {
				await mutateRegistry((registry) => setActiveAccount(registry, args.accountId), options.baseDir)
				log.count("manual.set_active_account", 1, { accountId: args.accountId })
				return `Active account set to ${args.accountId}`
			},
		}),
		remove_account: tool({
			description: "Tombstone an account immediately for new requests.",
			args: {
				accountId: tool.schema.string().describe("Opaque account id like copilot-acct-abc123"),
			},
			async execute(args) {
				await tombstoneAccount(args.accountId, options.baseDir)
				log.count("manual.remove_account", 1, { accountId: args.accountId })
				return `Account ${args.accountId} tombstoned. Secret cleanup remains deferred.`
			},
		}),
		disable_account: tool({
			description: "Disable an account for new selections without deleting it.",
			args: {
				accountId: tool.schema.string().describe("Opaque account id like copilot-acct-abc123"),
			},
			async execute(args) {
				await mutateRegistry((registry) => disableAccount(registry, args.accountId), options.baseDir)
				log.count("manual.disable_account", 1, { accountId: args.accountId })
				return `Account ${args.accountId} disabled.`
			},
		}),
		enable_account: tool({
			description: "Re-enable a previously disabled account.",
			args: {
				accountId: tool.schema.string().describe("Opaque account id like copilot-acct-abc123"),
			},
			async execute(args) {
				await mutateRegistry((registry) => enableAccount(registry, args.accountId), options.baseDir)
				log.count("manual.enable_account", 1, { accountId: args.accountId })
				return `Account ${args.accountId} enabled.`
			},
		}),
	}
}

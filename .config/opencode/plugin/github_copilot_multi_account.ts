import type { Plugin } from "@opencode-ai/plugin"

import { buildCopilotAuthOverride, createCopilotAuthMethods } from "./github_copilot_multi_account/auth"
import { createLogger } from "./github_copilot_multi_account/logger"
import { assertCapabilityGate, loadCapabilityGateEvidence } from "./github_copilot_multi_account/types"
import { createManagementTools } from "./github_copilot_multi_account/tools"

export const GithubCopilotMultiAccountPlugin: Plugin = async ({ client }) => {
	const log = createLogger(client)

	return {
		auth: {
			provider: "github-copilot",
			methods: createCopilotAuthMethods(),
			async loader(getAuth, provider) {
				const evidence = await loadCapabilityGateEvidence()
				assertCapabilityGate(evidence)
				log.info("capability gate passed", {
					probeScript: evidence.probeScript,
					validationDate: evidence.validationDate,
				})

				return buildCopilotAuthOverride({
					client,
					getAuth,
					provider,
					log,
					capabilityGate: evidence,
				})
			},
		},
		tool: createManagementTools({ client }),
	}
}

export default GithubCopilotMultiAccountPlugin

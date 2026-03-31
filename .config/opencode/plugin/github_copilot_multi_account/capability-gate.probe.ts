import { readFile } from "node:fs/promises"

import { loadCapabilityGateEvidence } from "./types"
import GithubCopilotMultiAccountPlugin from "../github_copilot_multi_account"

const pluginPackagePath = new URL("../../node_modules/@opencode-ai/plugin/dist/index.d.ts", import.meta.url)

async function main() {
	const evidence = await loadCapabilityGateEvidence()
	const pluginTypeSource = await readFile(pluginPackagePath, "utf8")
	const plugin = await GithubCopilotMultiAccountPlugin({
		client: {
			app: {
				log: async () => ({ data: true }),
			},
		} as any,
		project: {} as any,
		directory: process.cwd(),
		worktree: process.cwd(),
		serverUrl: new URL("http://localhost"),
		$: {} as any,
	})

	if (!plugin.auth) throw new Error("Plugin did not expose an auth hook")
	if (plugin.auth.provider !== "github-copilot") throw new Error("Auth hook does not target github-copilot")
	if (typeof plugin.auth.loader !== "function") throw new Error("Auth hook loader is missing")
	if (!pluginTypeSource.includes("loader?: (auth: () => Promise<Auth>, provider: Provider)")) {
		throw new Error("Installed @opencode-ai/plugin package no longer matches expected loader contract")
	}

	const report = {
		provider: plugin.auth.provider,
		methodCount: plugin.auth.methods.length,
		probeScript: evidence.probeScript,
		validationCommand: evidence.validationCommand,
		goNoGo: evidence.goNoGo,
		checked: [
			"plugin exposes github-copilot auth hook",
			"loader is present",
			"installed plugin package exposes auth loader signature",
		],
	}

	console.log(JSON.stringify(report, null, 2))
}

await main()

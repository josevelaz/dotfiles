import { expect, test } from "bun:test"

import GithubCopilotMultiAccountPlugin from "../github_copilot_multi_account"
import { assertCapabilityGate, loadCapabilityGateEvidence } from "./types"

test("capability gate fails closed", () => {
	expect(() =>
		assertCapabilityGate({
			authMethodShape: "unknown",
			loaderShape: "unknown",
			opencodeVersion: "unknown",
			pluginVersion: "local",
			providerId: "github-copilot",
			authMethodId: "unknown",
			validationCommand: "manual",
			probeScript: "plugin/github_copilot_multi_account/capability-gate.probe.ts",
			validationDate: "2026-03-28",
			providerContractSummary: "missing",
			refreshContractSummary: "missing",
			requestFixtureHash: "missing",
			responseFixtureHash: "missing",
			replayProof: "missing",
			persistenceProof: "missing",
			transportOverrideProof: "missing",
			canInspectResponse: false,
			canReplayBufferedRequest: false,
			canPersistDuringRequest: false,
			canOverrideTransport: false,
			goNoGo: "stop",
		}),
	).toThrow("stop v1 and return to design")
})

test("loads the checked-in capability artifact", async () => {
	const evidence = await loadCapabilityGateEvidence()
	expect(evidence.providerId).toBe("github-copilot")
	expect(evidence.goNoGo).toBe("go")
	expect(() => assertCapabilityGate(evidence)).not.toThrow()
})

test("fails when provider id is wrong", () => {
	expect(() =>
		assertCapabilityGate({
			authMethodShape: "shape",
			loaderShape: "shape",
			opencodeVersion: "1",
			pluginVersion: "local",
			providerId: "github-copilot",
			authMethodId: "id",
			validationCommand: "bun probe.ts",
			probeScript: "probe.ts",
			validationDate: "2026-03-28",
			providerContractSummary: "summary",
			refreshContractSummary: "summary",
			requestFixtureHash: "hash",
			responseFixtureHash: "hash",
			replayProof: "proof",
			persistenceProof: "proof",
			transportOverrideProof: "proof",
			canInspectResponse: true,
			canReplayBufferedRequest: true,
			canPersistDuringRequest: true,
			canOverrideTransport: true,
			goNoGo: "go",
			// @ts-expect-error test invalid provider
			providerId: "openai",
		}),
	).toThrow("stop v1 and return to design")
})

test("plugin shell exposes github-copilot auth loader", async () => {
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

	expect(plugin.auth?.provider).toBe("github-copilot")
	expect(typeof plugin.auth?.loader).toBe("function")
	expect(plugin.auth?.methods).toHaveLength(1)
	expect(plugin.auth?.methods[0]?.label).toBe("Login with GitHub Copilot")
})

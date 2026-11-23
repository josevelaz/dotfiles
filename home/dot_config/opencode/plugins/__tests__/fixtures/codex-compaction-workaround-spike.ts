// Compatibility probe only. Files under __tests__ are not auto-loaded.
import { LanguageModel, LLMRequest, Message, ToolDefinition } from "@opencode-ai/ai"
import { OpenAIResponses } from "@opencode-ai/ai/protocols/openai-responses"
import { Plugin } from "@opencode-ai/plugin"
import { Effect } from "effect"

type JsonObject = Record<string, unknown>

type Snapshot = {
	system: any[]
	tools: Record<string, { description: string; input: Record<string, unknown> }>
}

type Diagnostic = {
	requestCount: number
	durableBoundaryMatch?: boolean
	actualTypes?: string[]
	encodedTypes?: string[]
	compactionEncodedTypes?: string[]
	error?: string
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function metadata(state: unknown) {
	return isObject(state) ? { openai: state } : undefined
}

function itemTypes(items: unknown[]): string[] {
	return items.map((item) => isObject(item) && typeof item.type === "string"
		? item.type
		: isObject(item) && typeof item.role === "string" ? item.role : "unknown")
}

function toMessages(items: readonly any[]): Message[] {
	const messages: Message[] = []
	for (const item of items) {
		if (item.type === "user") {
			const content: any[] = [{ type: "text", text: item.text }]
			for (const file of item.files ?? []) {
				const data = file.data?.type === "base64" ? file.data.data : file.data?.uri
				if (typeof data === "string") content.push({ type: "media", mediaType: file.mime, data, filename: file.name })
			}
			messages.push(Message.user(content))
			continue
		}
		if (item.type === "system") {
			messages.push(Message.system(item.text))
			continue
		}
		if (item.type !== "assistant") continue

		const assistant: any[] = []
		const results: any[] = []
		for (const part of item.content) {
			if (part.type === "reasoning") {
				assistant.push({ type: "reasoning", text: part.text, providerMetadata: metadata(part.state) })
				continue
			}
			if (part.type === "text") {
				assistant.push({ type: "text", text: part.text, providerMetadata: metadata(part.state) })
				continue
			}
			if (part.type !== "tool") continue
			assistant.push({
				type: "tool-call",
				id: part.id,
				name: part.name,
				input: part.state.input,
				providerMetadata: metadata(part.providerState),
			})
			if (part.state.status === "completed") {
				results.push({
					type: "tool-result",
					id: part.id,
					name: part.name,
					result: { type: "content", value: part.state.content },
					providerMetadata: metadata(part.providerResultState),
				})
			} else if (part.state.status === "error") {
				results.push({
					type: "tool-result",
					id: part.id,
					name: part.name,
					result: { type: "error", value: part.state.error },
					providerMetadata: metadata(part.providerResultState),
				})
			}
		}
		if (assistant.length) messages.push(Message.assistant(assistant))
		if (results.length) messages.push(Message.make({ role: "tool", content: results }))
	}
	return messages
}

async function encodeInput(ctx: any, event: any, snapshot: Snapshot): Promise<unknown[]> {
	const durable = await ctx.session.context({ sessionID: event.sessionID })
	const model = LanguageModel.make({ id: event.model.id, provider: "openai", route: OpenAIResponses.route })
	const request = new LLMRequest({
		model,
		system: snapshot.system,
		messages: toMessages(durable),
		tools: Object.entries(snapshot.tools).map(([name, tool]) => ToolDefinition.make({
			name,
			description: tool.description,
			inputSchema: tool.input,
		})),
	})
	const body = await Effect.runPromise(OpenAIResponses.protocol.body.from(request))
	return [...body.input]
}

export default Plugin.define({
	id: "local.codex-compaction-workaround-spike",
	async setup(ctx) {
		const armed = new Set<string>()
		const snapshots = new Map<string, Snapshot>()
		const diagnostics = new Map<string, Diagnostic>()

		await ctx.command.transform((draft) => {
			draft.add({
				name: "codex-compaction-workaround-arm",
				description: "Arm the durable-context Responses encoder probe",
				async execute({ sessionID }) {
					armed.add(sessionID)
					diagnostics.set(sessionID, { requestCount: 0 })
				},
			})
			draft.add({
				name: "codex-compaction-workaround-status",
				description: "Write redacted workaround probe diagnostics",
				async execute({ sessionID }) {
					await ctx.session.synthetic({
						sessionID,
						text: JSON.stringify(diagnostics.get(sessionID) ?? { error: "not armed" }),
					})
				},
			})
		})

		await ctx.session.hook("context", (event) => {
			if (!armed.has(event.sessionID) || event.model.providerID !== "openai") return
			snapshots.set(event.sessionID, {
				system: structuredClone(event.system),
				tools: structuredClone(event.tools),
			})
		})

		await ctx.session.hook("http.request", async (event) => {
			if (!armed.has(event.sessionID) || event.model.providerID !== "openai") return
			if (event.agent === "compaction") {
				const diagnostic = diagnostics.get(event.sessionID) ?? { requestCount: 0 }
				const snapshot = snapshots.get(event.sessionID)
				if (!snapshot) diagnostic.error = "missing context snapshot during compaction"
				else {
					try {
						const encoded = await encodeInput(ctx, event, snapshot)
						diagnostic.compactionEncodedTypes = itemTypes(encoded)
					} catch (error) {
						diagnostic.error = error instanceof Error ? error.message : String(error)
					}
				}
				diagnostics.set(event.sessionID, diagnostic)
				return
			}
			let body: unknown
			try {
				body = await event.request.clone().json()
			} catch {
				return
			}
			if (!isObject(body) || !Array.isArray(body.input)) return
			const diagnostic = diagnostics.get(event.sessionID) ?? { requestCount: 0 }
			diagnostic.requestCount++
			diagnostic.actualTypes = itemTypes(body.input)
			if (body.input.some((item) => isObject(item) && item.type === "function_call_output")) {
				const snapshot = snapshots.get(event.sessionID)
				if (!snapshot) diagnostic.error = "missing context snapshot"
				else {
					try {
						const encoded = await encodeInput(ctx, event, snapshot)
						diagnostic.encodedTypes = itemTypes(encoded)
						diagnostic.durableBoundaryMatch = JSON.stringify(encoded) === JSON.stringify(body.input)
					} catch (error) {
						diagnostic.error = error instanceof Error ? error.message : String(error)
					}
				}
			}
			diagnostics.set(event.sessionID, diagnostic)
		})
	},
})

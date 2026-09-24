import { Plugin } from "@opencode/plugin"
import { z } from "zod"

const API_ORIGIN = "https://api.tavily.com"
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_SCHEMA_BYTES = 256 * 1024
const MAX_SCHEMA_DEPTH = 4
const MAX_SCHEMA_NODES = 1_000
const MAX_SCHEMA_PROPERTIES = 500
const MAX_SCHEMA_STRING_LENGTH = 16_384
const STATUS_TIMEOUT_MS = 60_000

const text = z.string().trim().min(1).max(20_000)
const url = z.string().trim().min(1).max(4_096).superRefine((value, issue) => {
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      issue.addIssue({ code: "custom", message: "Must be an absolute HTTP or HTTPS URL" })
    }
    if (parsed.username || parsed.password) {
      issue.addIssue({ code: "custom", message: "URL credentials are not allowed" })
    }
  } catch {
    issue.addIssue({ code: "custom", message: "Must be an absolute HTTP or HTTPS URL" })
  }
})
const patterns = z.array(z.string().min(1).max(1_000)).min(1).max(100)
const requestId = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const extractInput = z.object({
  urls: z.array(url).min(1).max(20),
  query: text.optional(),
  chunks_per_source: z.number().int().min(1).max(5).optional(),
  extract_depth: z.enum(["basic", "advanced"]).optional(),
  format: z.enum(["markdown", "text"]).optional(),
  include_images: z.boolean().optional(),
  timeout: z.number().min(1).max(60).optional(),
}).strict().superRefine((input, issue) => {
  if (input.chunks_per_source !== undefined && input.query === undefined) {
    issue.addIssue({ code: "custom", path: ["chunks_per_source"], message: "Requires query" })
  }
})

const mapShape = {
  url,
  max_depth: z.number().int().min(1).max(5).optional(),
  max_breadth: z.number().int().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(1_000).optional(),
  instructions: text.optional(),
  select_paths: patterns.optional(),
  exclude_paths: patterns.optional(),
  select_domains: patterns.optional(),
  exclude_domains: patterns.optional(),
  allow_external: z.boolean().optional(),
  timeout: z.number().min(10).max(150).optional(),
}
const mapInput = z.object(mapShape).strict()
const crawlInput = z.object({
  ...mapShape,
  chunks_per_source: z.number().int().min(1).max(5).optional(),
  extract_depth: z.enum(["basic", "advanced"]).optional(),
  format: z.enum(["markdown", "text"]).optional(),
  include_images: z.boolean().optional(),
}).strict().superRefine((input, issue) => {
  if (input.chunks_per_source !== undefined && input.instructions === undefined) {
    issue.addIssue({ code: "custom", path: ["chunks_per_source"], message: "Requires instructions" })
  }
})

type SchemaNode = {
  type: "object" | "string" | "integer" | "number" | "array"
  description: string
  properties?: Record<string, SchemaNode>
  required?: string[]
  items?: SchemaNode
}

function makeSchemaNode(depth: number): z.ZodType<SchemaNode> {
  const type = depth === 0
    ? z.enum(["string", "integer", "number"])
    : z.enum(["object", "string", "integer", "number", "array"])
  const nested = depth > 0 ? makeSchemaNode(depth - 1) : undefined
  return z.object({
    type,
    description: z.string().min(1).max(4_096),
    ...(nested === undefined ? {} : {
      properties: z.record(z.string().min(1).max(1_024), nested).optional(),
      required: z.array(z.string().min(1).max(1_024)).min(1).max(500).optional(),
      items: nested.optional(),
    }),
  }).strict() as z.ZodType<SchemaNode>
}

const outputSchema = z.object({
  properties: z.record(z.string().min(1).max(1_024), makeSchemaNode(MAX_SCHEMA_DEPTH))
    .refine((value) => Object.keys(value).length > 0, "Must define at least one property"),
  required: z.array(z.string().min(1).max(1_024)).min(1).max(500).optional(),
}).strict().describe("A bounded inline Tavily output schema. Filesystem paths are not accepted.")

const researchInput = z.object({
  query: text,
  model: z.enum(["mini", "pro", "auto"]).optional(),
  no_wait: z.boolean().optional(),
  output_schema: outputSchema.optional(),
  citation_format: z.enum(["numbered", "mla", "apa", "chicago"]).optional(),
  poll_interval: z.number().int().min(1).max(600).optional(),
  timeout: z.number().int().min(1).max(600).optional(),
}).strict()
const researchStatusInput = z.object({ request_id: requestId }).strict()
const researchPollInput = z.object({
  request_id: requestId,
  poll_interval: z.number().int().min(1).max(600).optional(),
  timeout: z.number().int().min(1).max(600).optional(),
}).strict()

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type JsonObject = Record<string, unknown>

function sanitizeDiagnostic(value: string, apiKey?: string): string {
  const redacted = apiKey ? value.replaceAll(apiKey, "[REDACTED]") : value
  return redacted
    .replace(/tvly-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/((?:TAVILY_API_KEY|api[_ -]?key|access[_ -]?token|oauth[_ -]?token)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api_key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 2_000)
}

function validateOutputSchema(schema: z.infer<typeof outputSchema>): void {
  let nodes = 0
  let properties = 0
  const visit = (node: SchemaNode): void => {
    if (++nodes > MAX_SCHEMA_NODES) throw new Error(`output_schema exceeds maximum node count ${MAX_SCHEMA_NODES}`)
    if (node.description.length > MAX_SCHEMA_STRING_LENGTH) {
      throw new Error(`output_schema string exceeds ${MAX_SCHEMA_STRING_LENGTH} characters`)
    }
    if (node.type === "object") {
      if (node.properties === undefined || Object.keys(node.properties).length === 0) {
        throw new Error("Every object in output_schema must define properties")
      }
      if (node.items !== undefined) throw new Error("Only array nodes may define items")
      validateRequired(node.properties, node.required)
      properties += Object.keys(node.properties).length
      for (const child of Object.values(node.properties)) visit(child)
      return
    }
    if (node.type === "array") {
      if (node.items === undefined) throw new Error("Every array in output_schema must define items")
      if (node.properties !== undefined || node.required !== undefined) {
        throw new Error("Only object nodes may define properties or required")
      }
      visit(node.items)
      return
    }
    if (node.properties !== undefined || node.required !== undefined || node.items !== undefined) {
      throw new Error("Primitive output_schema nodes cannot define properties, required, or items")
    }
  }

  validateRequired(schema.properties, schema.required)
  properties += Object.keys(schema.properties).length
  for (const node of Object.values(schema.properties)) visit(node)
  if (properties > MAX_SCHEMA_PROPERTIES) {
    throw new Error(`output_schema exceeds maximum property count ${MAX_SCHEMA_PROPERTIES}`)
  }
  const serialized = JSON.stringify(schema)
  if (new TextEncoder().encode(serialized).byteLength > MAX_SCHEMA_BYTES) {
    throw new Error(`output_schema exceeds ${MAX_SCHEMA_BYTES} serialized bytes`)
  }
}

function validateRequired(properties: Record<string, unknown>, required: string[] | undefined): void {
  if (required === undefined) return
  if (new Set(required).size !== required.length || required.some((name) => !Object.hasOwn(properties, name))) {
    throw new Error("output_schema required entries must be unique names defined in properties")
  }
}

async function resolveApiKey(ctx: PluginContext): Promise<string> {
  try {
    const connection = await ctx.integration.connection.active("tavily")
    if (connection !== undefined) {
      const credential = await ctx.integration.connection.resolve(connection)
      if (credential?.type === "key" && credential.key.trim() !== "") return credential.key.trim()
    }
  } catch {
    // An environment key remains a supported fallback when integration lookup is unavailable.
  }
  const environmentKey = process.env.TAVILY_API_KEY?.trim()
  if (environmentKey) return environmentKey
  throw new Error("Tavily API key not found. Connect the Tavily integration in OpenCode or set TAVILY_API_KEY, then retry.")
}

async function readBounded(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Tavily response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`)
  }
  if (response.body === null) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`Tavily response exceeded the ${MAX_RESPONSE_BYTES}-byte limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const combined = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined)
}

function apiError(status: number, response: Response, body: string, apiKey: string): Error {
  let detail = ""
  try {
    const parsed = JSON.parse(body) as { detail?: { error?: unknown } | unknown; error?: unknown }
    const candidate = typeof parsed.detail === "object" && parsed.detail !== null && "error" in parsed.detail
      ? parsed.detail.error
      : parsed.error ?? parsed.detail
    if (typeof candidate === "string") detail = sanitizeDiagnostic(candidate, apiKey)
  } catch {
    detail = sanitizeDiagnostic(body, apiKey)
  }
  if (status === 401) return new Error("Tavily authentication failed (HTTP 401). Reconnect the Tavily integration or check TAVILY_API_KEY.")
  if (status === 403) return new Error(`Tavily denied the request (HTTP 403). Check API-key access and the requested URL.${detail ? ` ${detail}` : ""}`)
  if (status === 404) return new Error(`Tavily research request was not found (HTTP 404). Check the request_id.${detail ? ` ${detail}` : ""}`)
  if (status === 429) {
    const retryAfter = response.headers.get("retry-after")
    return new Error(`Tavily rate limit exceeded (HTTP 429).${retryAfter ? ` Retry-After: ${sanitizeDiagnostic(retryAfter, apiKey)}.` : " Retry later."}${detail ? ` ${detail}` : ""}`)
  }
  if (status === 432 || status === 433) {
    return new Error(`Tavily account usage limit exceeded (HTTP ${status}). Check the Tavily plan and usage limits.${detail ? ` ${detail}` : ""}`)
  }
  return new Error(`Tavily API request failed (HTTP ${status}).${detail ? ` ${detail}` : ""}`)
}

async function tavilyRequest(
  ctx: PluginContext,
  method: "GET" | "POST",
  path: string,
  body: JsonObject | undefined,
  timeoutMs: number,
): Promise<JsonObject> {
  const key = await resolveApiKey(ctx)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  let raw: string
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    raw = await readBounded(response)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Tavily API request timed out after ${timeoutMs}ms`)
    const message = error instanceof Error ? sanitizeDiagnostic(error.message, key) : "unknown network error"
    throw new Error(`Tavily API request or response failed: ${message}`)
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
  if (!response.ok) throw new Error(sanitizeDiagnostic(apiError(response.status, response, raw, key).message, key))
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Tavily API returned malformed JSON (HTTP ${response.status})`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Tavily API returned an unexpected JSON value (HTTP ${response.status})`)
  }
  return parsed as JsonObject
}

function result(value: JsonObject): { content: string } {
  return { content: JSON.stringify(value) }
}

function postTimeout(seconds: number | undefined, fallbackMs: number): number {
  return seconds === undefined ? fallbackMs : seconds * 1_000 + 30_000
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function researchStatus(ctx: PluginContext, id: string, timeoutMs = STATUS_TIMEOUT_MS): Promise<JsonObject> {
  const response = await tavilyRequest(ctx, "GET", `/research/${encodeURIComponent(id)}`, undefined, timeoutMs)
  return { ...response, request_id: id }
}

async function pollResearch(ctx: PluginContext, id: string, pollSeconds: number, timeoutSeconds: number): Promise<JsonObject> {
  const deadline = Date.now() + timeoutSeconds * 1_000
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const response = await researchStatus(ctx, id, Math.max(1, Math.min(STATUS_TIMEOUT_MS, remaining)))
    const status = response.status
    if (status !== "pending" && status !== "in_progress") return response
    const wait = Math.min(pollSeconds * 1_000, deadline - Date.now())
    if (wait > 0) await sleep(wait)
  }
  throw new Error(`Polling timed out after ${timeoutSeconds}s; use tavily_research_status or tavily_research_poll with this request_id.`)
}

export default Plugin.define({
  id: "local.tavily-tools",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "tavily", description: "Tavily extraction, site discovery, crawling, and deep research tools." })
      const options = { namespace: "tavily", permission: "tavily", codemode: true } as const

      editor.add({
        name: "extract",
        description: "Extract focused content from one to twenty known HTTP(S) URLs. Returns Tavily JSON.",
        input: extractInput,
        options,
        execute: async (raw) => {
          const input = extractInput.parse(raw)
          return result(await tavilyRequest(ctx, "POST", "/extract", input, postTimeout(input.timeout, 120_000)))
        },
      })

      editor.add({
        name: "map",
        description: "Discover URLs and site structure without extracting content. Returns Tavily JSON.",
        input: mapInput,
        options,
        execute: async (raw) => {
          const input = mapInput.parse(raw)
          return result(await tavilyRequest(ctx, "POST", "/map", input, postTimeout(input.timeout, 180_000)))
        },
      })

      editor.add({
        name: "crawl",
        description: "Crawl a site and extract content from discovered pages. Returns Tavily JSON.",
        input: crawlInput,
        options,
        execute: async (raw) => {
          const input = crawlInput.parse(raw)
          return result(await tavilyRequest(ctx, "POST", "/crawl", input, postTimeout(input.timeout, 180_000)))
        },
      })

      editor.add({
        name: "research",
        description: "Start Tavily deep research asynchronously by default. Set no_wait:false to wait for completion; always retain request_id.",
        input: researchInput,
        options,
        execute: async (raw) => {
          const input = researchInput.parse(raw)
          if (input.output_schema !== undefined) validateOutputSchema(input.output_schema)
          const started = await tavilyRequest(ctx, "POST", "/research", {
            input: input.query,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.output_schema === undefined ? {} : { output_schema: input.output_schema }),
            ...(input.citation_format === undefined ? {} : { citation_format: input.citation_format }),
          }, STATUS_TIMEOUT_MS)
          const id = requestId.safeParse(started.request_id)
          if (!id.success) throw new Error("Tavily created a research task but returned no valid request_id; do not resubmit automatically.")
          if (input.no_wait !== false) return result({ ...started, request_id: id.data })
          try {
            return result(await pollResearch(ctx, id.data, input.poll_interval ?? 5, input.timeout ?? 600))
          } catch (error) {
            const message = error instanceof Error ? sanitizeDiagnostic(error.message) : "unknown polling failure"
            throw new Error(`Tavily research request_id ${id.data} was created, but polling failed: ${message}`)
          }
        },
      })

      editor.add({
        name: "research_status",
        description: "Check a Tavily research request once without waiting. Returns Tavily JSON.",
        input: researchStatusInput,
        options,
        execute: async (raw) => {
          const input = researchStatusInput.parse(raw)
          return result(await researchStatus(ctx, input.request_id))
        },
      })

      editor.add({
        name: "research_poll",
        description: "Poll a Tavily research request until completion or a bounded timeout. Returns Tavily JSON.",
        input: researchPollInput,
        options,
        execute: async (raw) => {
          const input = researchPollInput.parse(raw)
          try {
            return result(await pollResearch(ctx, input.request_id, input.poll_interval ?? 5, input.timeout ?? 600))
          } catch (error) {
            const message = error instanceof Error ? sanitizeDiagnostic(error.message) : "unknown polling failure"
            throw new Error(`Tavily research request_id ${input.request_id} polling failed: ${message}`)
          }
        },
      })
    })
  },
})

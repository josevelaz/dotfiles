import type { Rpc } from "@opencode/plugin/rpc"

const text = { type: "string" } as const

const file = {
  type: "object",
  properties: { path: text, content: text },
  required: ["path", "content"],
  additionalProperties: false,
} as const

const commit = {
  type: "object",
  properties: { hash: text, date: text, subject: text, files: { type: "array", items: text } },
  required: ["hash", "date", "subject", "files"],
  additionalProperties: false,
} as const

const repo = {
  type: "object",
  properties: {
    name: text,
    root: text,
    error: text,
    files: { type: "array", items: file },
    commits: { type: "array", items: commit },
  },
  required: ["name", "root", "files", "commits"],
  additionalProperties: false,
} as const

export const AgentMemory = {
  id: "agent-memory",
  methods: {
    snapshot: {
      input: { type: "object", additionalProperties: false },
      output: {
        type: "object",
        properties: { repos: { type: "array", items: repo } },
        required: ["repos"],
        additionalProperties: false,
      },
    },
    diff: {
      input: {
        type: "object",
        properties: { repo: text, hash: text, path: text },
        required: ["repo", "hash"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text },
        required: ["text"],
        additionalProperties: false,
      },
      errors: {
        invalid_request: { type: "object", properties: { message: text }, required: ["message"], additionalProperties: false },
      },
    },
  },
  events: {},
} as const satisfies Rpc.PortableDefinition

export type MemoryFile = { readonly path: string; readonly content: string }
export type MemoryCommit = { readonly hash: string; readonly date: string; readonly subject: string; readonly files: readonly string[] }
export type MemoryRepo = {
  readonly name: string
  readonly root: string
  readonly error?: string
  readonly files: readonly MemoryFile[]
  readonly commits: readonly MemoryCommit[]
}
export type MemorySnapshot = { readonly repos: readonly MemoryRepo[] }

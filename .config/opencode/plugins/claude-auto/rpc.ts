import { Rpc } from "@opencode/plugin/rpc"

// One routing decision for a user message, as shown by the TUI.
export type RouteRecord = {
  sessionID: string
  rootSessionID: string
  agent: string
  model: string
  label: string
  effort: string
  reason: string
  time: number
}

const routeRecord = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    rootSessionID: { type: "string" },
    agent: { type: "string" },
    model: { type: "string" },
    label: { type: "string" },
    effort: { type: "string" },
    reason: { type: "string" },
    time: { type: "number" },
  },
  required: ["sessionID", "rootSessionID", "agent", "model", "label", "effort", "reason", "time"],
  additionalProperties: false,
} as const

export const ClaudeAuto = Rpc.define({
  id: "claude-auto",
  methods: {
    get: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { route: { anyOf: [routeRecord, { type: "null" }] } },
        required: ["route"],
        additionalProperties: false,
      },
    },
    // The latest decision of every session in the family of `sessionID` (its root and all subagents).
    family: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { rootSessionID: { type: "string" }, routes: { type: "array", items: routeRecord } },
        required: ["rootSessionID", "routes"],
        additionalProperties: false,
      },
    },
  },
  events: {
    routed: { schema: routeRecord },
  },
})

export function isRouteRecord(value: unknown): value is RouteRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    ["sessionID", "rootSessionID", "agent", "model", "label", "effort", "reason"].every((k) => typeof v[k] === "string") &&
    typeof v.time === "number"
  )
}

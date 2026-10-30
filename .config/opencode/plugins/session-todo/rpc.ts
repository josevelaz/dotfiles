import type { Rpc } from "@opencode/plugin/rpc"
import { planSchema, sessionID } from "./plan"

export const SessionTodo = {
  id: "session-todo",
  methods: {
    get: {
      // V2's JSON Schema decoder strips extra properties. Use Standard Schema
      // here so a malformed request is rejected rather than silently changed.
      input: {
        "~standard": {
          version: 1, vendor: "local.session-todo",
          validate(value: unknown) {
            try {
              if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "sessionID")) throw new Error("Expected only sessionID")
              return { value: { sessionID: sessionID((value as { sessionID: unknown }).sessionID) } }
            } catch (error) {
              return { issues: [{ message: error instanceof Error ? error.message : "Invalid sessionID" }] }
            }
          },
        },
      },
      output: {
        type: "object",
        properties: { plan: { anyOf: [planSchema, { type: "null" }] } },
        required: ["plan"], additionalProperties: false,
      },
      errors: {
        invalid_session: { type: "object", properties: { sessionID: { type: "string" } }, required: ["sessionID"], additionalProperties: false },
      },
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: { sessionID: planSchema.properties.sessionID, revision: planSchema.properties.revision },
        required: ["sessionID", "revision"], additionalProperties: false,
      },
    },
  },
} as const satisfies Rpc.PortableDefinition

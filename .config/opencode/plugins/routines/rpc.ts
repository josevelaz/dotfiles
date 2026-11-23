import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

const runRecord = z.object({
  firedAt: z.number(),
  trigger: z.enum(["schedule", "manual"]),
  sessionID: z.string().optional(),
  error: z.string().optional(),
})

const routineView = z.object({
  id: z.string(),
  name: z.string(),
  schedule: z.string(),
  timezone: z.string().optional(),
  prompt: z.string(),
  directory: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  enabled: z.boolean(),
  createdAt: z.number(),
  nextRuns: z.array(z.number()),
  lastError: z.string().optional(),
  history: z.array(runRecord),
})

export type RoutineView = z.infer<typeof routineView>
export type RunRecordView = z.infer<typeof runRecord>

const idInput = z.object({ id: z.string() })
const errors = { failed: z.object({ reason: z.string() }) }

export const Routines = Rpc.define({
  id: "local.routines",
  methods: {
    list: { input: z.object({}), output: z.object({ routines: z.array(routineView), stateDir: z.string() }), errors },
    setEnabled: { input: z.object({ id: z.string(), enabled: z.boolean() }), output: routineView, errors },
    run: { input: idInput, output: z.object({ sessionID: z.string() }), errors },
    remove: { input: idInput, output: z.object({ removed: z.string() }), errors },
  },
  events: {},
})

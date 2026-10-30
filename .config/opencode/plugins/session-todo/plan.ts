import { randomUUID } from "node:crypto"

export type Task = { id: string; title: string; status: "pending" | "done" | "blocked" }
export type Plan = {
  version: 1
  sessionID: string
  goal: string
  tasks: Task[]
  currentTaskID: string | null
  revision: number
}

export const limits = { goal: 1000, title: 240, tasks: 50 } as const
const idSchema = { type: "string", minLength: 1, maxLength: 128 } as const
const titleSchema = { type: "string", minLength: 1, maxLength: limits.title } as const
const statusSchema = { type: "string", enum: ["pending", "done", "blocked"] } as const

export const planSchema = {
  type: "object",
  properties: {
    version: { const: 1 },
    sessionID: idSchema,
    goal: { type: "string", minLength: 1, maxLength: limits.goal },
    tasks: {
      type: "array", maxItems: limits.tasks,
      items: {
        type: "object",
        properties: { id: idSchema, title: titleSchema, status: statusSchema },
        required: ["id", "title", "status"], additionalProperties: false,
      },
    },
    currentTaskID: { anyOf: [idSchema, { type: "null" }] },
    revision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
  required: ["version", "sessionID", "goal", "tasks", "currentTaskID", "revision"],
  additionalProperties: false,
} as const

type Action =
  | { action: "read" }
  | { action: "set_goal"; goal: string }
  | { action: "add_task"; title: string; status?: Task["status"] }
  | { action: "update_task"; taskID: string; title?: string; status?: Task["status"] }
  | { action: "remove_task"; taskID: string }
  | { action: "reorder_tasks"; taskIDs: string[] }
  | { action: "set_current"; taskID: string | null }

// Keep the model-facing object simple. parseAction enforces each action's fields.
export const actionSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["read", "set_goal", "add_task", "update_task", "remove_task", "reorder_tasks", "set_current"] },
    goal: { type: "string", minLength: 1, maxLength: limits.goal },
    title: titleSchema,
    status: statusSchema,
    taskID: { anyOf: [idSchema, { type: "null" }] },
    taskIDs: { type: "array", items: idSchema, maxItems: limits.tasks, uniqueItems: true },
  },
  required: ["action"], additionalProperties: false,
} as const

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, allowed: string[], required: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected field")
  if (required.some((key) => !Object.hasOwn(value, key))) throw new Error(`Required fields: ${required.join(", ")}`)
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Expected nonempty text of at most ${max} characters`)
  return value
}

export function sessionID(value: unknown): string {
  const id = text(value, 128)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid ID")
  return id
}

function status(value: unknown): Task["status"] {
  if (value !== "pending" && value !== "done" && value !== "blocked") throw new Error("Invalid task status")
  return value
}

export function parseAction(value: unknown): Action {
  const input = object(value)
  switch (input.action) {
    case "read":
      fields(input, ["action"], ["action"])
      return { action: "read" }
    case "set_goal":
      fields(input, ["action", "goal"], ["action", "goal"])
      return { action: "set_goal", goal: text(input.goal, limits.goal) }
    case "add_task":
      fields(input, ["action", "title", "status"], ["action", "title"])
      return { action: "add_task", title: text(input.title, limits.title), ...(Object.hasOwn(input, "status") ? { status: status(input.status) } : {}) }
    case "update_task":
      fields(input, ["action", "taskID", "title", "status"], ["action", "taskID"])
      if (!Object.hasOwn(input, "title") && !Object.hasOwn(input, "status")) throw new Error("update_task requires title or status")
      return {
        action: "update_task", taskID: sessionID(input.taskID),
        ...(Object.hasOwn(input, "title") ? { title: text(input.title, limits.title) } : {}),
        ...(Object.hasOwn(input, "status") ? { status: status(input.status) } : {}),
      }
    case "remove_task":
      fields(input, ["action", "taskID"], ["action", "taskID"])
      return { action: "remove_task", taskID: sessionID(input.taskID) }
    case "set_current":
      fields(input, ["action", "taskID"], ["action", "taskID"])
      return { action: "set_current", taskID: input.taskID === null ? null : sessionID(input.taskID) }
    case "reorder_tasks": {
      fields(input, ["action", "taskIDs"], ["action", "taskIDs"])
      if (!Array.isArray(input.taskIDs) || input.taskIDs.length > limits.tasks) throw new Error("Invalid taskIDs")
      const taskIDs = input.taskIDs.map(sessionID)
      if (new Set(taskIDs).size !== taskIDs.length) throw new Error("Duplicate task IDs")
      return { action: "reorder_tasks", taskIDs }
    }
    default: throw new Error("Unknown todo action")
  }
}

export function parsePlan(value: unknown, expectedSessionID: string): Plan {
  const input = object(value)
  fields(input, ["version", "sessionID", "goal", "tasks", "currentTaskID", "revision"], ["version", "sessionID", "goal", "tasks", "currentTaskID", "revision"])
  if (input.version !== 1) throw new Error("Unsupported todo plan version")
  if (sessionID(input.sessionID) !== expectedSessionID) throw new Error("Todo plan session mismatch")
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) throw new Error("Invalid plan revision")
  if (!Array.isArray(input.tasks) || input.tasks.length > limits.tasks) throw new Error("Invalid tasks")
  const tasks = input.tasks.map((value) => {
    const task = object(value)
    fields(task, ["id", "title", "status"], ["id", "title", "status"])
    return { id: sessionID(task.id), title: text(task.title, limits.title), status: status(task.status) }
  })
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Duplicate task IDs")
  const currentTaskID = input.currentTaskID === null ? null : sessionID(input.currentTaskID)
  if (currentTaskID !== null && !tasks.some((task) => task.id === currentTaskID && task.status !== "done")) throw new Error("Current task must exist and be unfinished")
  return { version: 1, sessionID: expectedSessionID, goal: text(input.goal, limits.goal), tasks, currentTaskID, revision: Number(input.revision) }
}

export function updatePlan(previous: Plan | null, id: string, action: Exclude<Action, { action: "read" }>): Plan {
  if (!previous && action.action !== "set_goal") throw new Error("Set a goal before editing tasks")
  const plan: Plan = previous ? structuredClone(previous) : { version: 1, sessionID: id, goal: "", tasks: [], currentTaskID: null, revision: 0 }
  const findTask = (taskID: string) => {
    const task = plan.tasks.find((task) => task.id === taskID)
    if (!task) throw new Error("Task not found")
    return task
  }
  switch (action.action) {
    case "set_goal": plan.goal = action.goal; break
    case "add_task":
      if (plan.tasks.length >= limits.tasks) throw new Error(`At most ${limits.tasks} tasks are allowed`)
      plan.tasks.push({ id: `task_${randomUUID()}`, title: action.title, status: action.status ?? "pending" })
      break
    case "update_task": {
      const task = findTask(action.taskID)
      if (action.title !== undefined) task.title = action.title
      if (action.status !== undefined) task.status = action.status
      if (task.status === "done" && plan.currentTaskID === task.id) plan.currentTaskID = null
      break
    }
    case "remove_task":
      findTask(action.taskID)
      plan.tasks = plan.tasks.filter((task) => task.id !== action.taskID)
      if (plan.currentTaskID === action.taskID) plan.currentTaskID = null
      break
    case "reorder_tasks":
      if (action.taskIDs.length !== plan.tasks.length) throw new Error("Provide every task ID exactly once")
      plan.tasks = action.taskIDs.map(findTask)
      break
    case "set_current":
      if (action.taskID !== null && findTask(action.taskID).status === "done") throw new Error("A done task cannot be current")
      plan.currentTaskID = action.taskID
      break
  }
  // No-op requests do not produce a new revision or event.
  if (previous && JSON.stringify(previous) === JSON.stringify(plan)) return previous
  plan.revision += 1
  return parsePlan(plan, id)
}

export function compactPlan(plan: Plan): string {
  const current = plan.tasks.find((task) => task.id === plan.currentTaskID)
  const tasks = plan.tasks.filter((task) => task.id !== current?.id && task.status !== "done").slice(0, 19)
  if (current) tasks.unshift(current)
  return JSON.stringify({
    revision: plan.revision, goal: plan.goal.slice(0, 600), currentTaskID: plan.currentTaskID,
    tasks: tasks.map((task) => ({ ...task, title: task.title.slice(0, 120) })),
    totals: { tasks: plan.tasks.length, done: plan.tasks.filter((task) => task.status === "done").length },
    truncated: tasks.length < plan.tasks.filter((task) => task.status !== "done").length || plan.goal.length > 600 || tasks.some((task) => task.title.length > 120),
  })
}

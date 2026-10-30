import type { Plan, Task } from "./plan.js"

export interface TaskRow {
  task: Task
  number: number
  current: boolean
}

/** Keep the saved order and numbering, including done tasks around the current task. */
export function taskWindow(plan: Plan, expanded = false) {
  const explicit = plan.tasks.findIndex((task) => task.id === plan.currentTaskID && task.status !== "done")
  const current = explicit >= 0 ? explicit : plan.tasks.findIndex((task) => task.status !== "done")
  const start = expanded ? 0 : current < 0 ? Math.max(0, plan.tasks.length - 2) : Math.max(0, current - 2)
  const end = expanded ? plan.tasks.length : current < 0 ? plan.tasks.length : Math.min(plan.tasks.length, current + 3)

  return {
    rows: plan.tasks.slice(start, end).map((task, index): TaskRow => ({
      task,
      number: start + index + 1,
      current: start + index === current,
    })),
    hidden: plan.tasks.length - (end - start),
    completed: plan.tasks.filter((task) => task.status === "done").length,
    complete: plan.tasks.length > 0 && current < 0,
  }
}

/** Titles are plain terminal text, not escape sequences or extra layout rows. */
export function displayText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
}

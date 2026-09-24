import {
  GOAL_STATE_VERSION,
  GOAL_TOOL_NAME,
  parseGoalState,
  statusHeading,
  type GoalSnapshot,
  type GoalState,
  type GoalStatus,
} from "./state"

export { GOAL_STATE_VERSION } from "./state"
export type { GoalSnapshot, GoalState, GoalStatus } from "./state"

export const DEFAULT_MAX_CONTINUATIONS = 100

export interface GoalBudgets {
  maxContinuations: number
}

type Clock = () => number

export class GoalController {
  private state: GoalState | undefined

  constructor(
    private readonly now: Clock = Date.now,
    private readonly budgets: GoalBudgets = {
      maxContinuations: DEFAULT_MAX_CONTINUATIONS,
    },
  ) {}

  get current(): Readonly<GoalState> | undefined {
    return this.state
  }

  get isActive(): boolean {
    return this.state?.status === "active"
  }

  start(objective: string, tokenBaseline = 0): Readonly<GoalState> {
    const timestamp = this.now()
    this.state = {
      version: GOAL_STATE_VERSION,
      objective: objective.trim(),
      status: "active",
      startedAt: timestamp,
      elapsedMs: 0,
      activeSince: timestamp,
      turns: 0,
      tokens: 0,
      continuations: 0,
      tokenBaseline: Math.max(0, Math.floor(tokenBaseline)),
      revision: 1,
    }
    return this.state
  }

  restore(state: GoalState | null): void {
    if (state === null) {
      this.state = undefined
      return
    }
    const parsed = parseGoalState(state)
    this.state = parsed === undefined ? undefined : { ...parsed }
    if (this.state?.status === "active" && this.state.activeSince === undefined) {
      this.state.activeSince = this.now()
    }
  }

  pause(reason?: string): boolean {
    if (!this.isActive || this.state === undefined) return false
    this.finishActivePeriod()
    this.state.status = "paused"
    this.state.reason = reason
    this.state.revision = (this.state.revision ?? 0) + 1
    return true
  }

  resume(): boolean {
    if (this.state === undefined) return false
    if (!["paused", "blocked", "budget-limited"].includes(this.state.status)) return false
    this.state.status = "active"
    this.state.reason = undefined
    this.state.activeSince = this.now()
    this.state.revision = (this.state.revision ?? 0) + 1
    return true
  }

  achieve(evidence: string): boolean {
    if (!this.isActive || this.state === undefined) return false
    this.finishActivePeriod()
    this.state.status = "achieved"
    this.state.evidence = evidence.trim()
    this.state.reason = undefined
    this.state.revision = (this.state.revision ?? 0) + 1
    return true
  }

  block(reason: string): boolean {
    if (!this.isActive || this.state === undefined) return false
    this.finishActivePeriod()
    this.state.status = "blocked"
    this.state.reason = reason.trim()
    this.state.revision = (this.state.revision ?? 0) + 1
    return true
  }

  limitBudget(reason: string): boolean {
    if (!this.isActive || this.state === undefined) return false
    this.finishActivePeriod()
    this.state.status = "budget-limited"
    this.state.reason = reason
    this.state.revision = (this.state.revision ?? 0) + 1
    return true
  }

  clear(): boolean {
    if (this.state === undefined) return false
    if (this.isActive) this.finishActivePeriod()
    this.state = undefined
    return true
  }

  recordEvaluation(sessionTokens: number): void {
    if (this.state === undefined) return
    this.state.turns += 1
    this.state.tokens = Math.max(0, Math.floor(sessionTokens) - this.state.tokenBaseline)
    this.state.revision = (this.state.revision ?? 0) + 1
  }

  recordContinuation(): void {
    if (!this.isActive || this.state === undefined) return
    this.state.continuations += 1
    this.state.revision = (this.state.revision ?? 0) + 1
  }

  budgetReason(): string | undefined {
    if (this.state === undefined) return undefined
    if (this.state.continuations >= this.budgets.maxContinuations) {
      return `Automatic continuation budget reached (${this.budgets.maxContinuations}).`
    }
    return undefined
  }

  elapsedMs(now = this.now()): number {
    if (this.state === undefined) return 0
    return displayElapsedMs(this.state, now)
  }

  serialize(): GoalSnapshot {
    if (this.state === undefined) {
      return { version: GOAL_STATE_VERSION, state: null }
    }
    return {
      version: GOAL_STATE_VERSION,
      state: { ...this.state },
    }
  }

  private finishActivePeriod(): void {
    if (this.state === undefined || this.state.activeSince === undefined) return
    this.state.elapsedMs += Math.max(0, this.now() - this.state.activeSince)
    this.state.activeSince = undefined
  }
}

export function displayElapsedMs(state: GoalState, now: number): number {
  if (state.status !== "active" || state.activeSince === undefined) return state.elapsedMs
  return state.elapsedMs + Math.max(0, now - state.activeSince)
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`
}

export const GOAL_PROMPT_HEADING = "## Active Goal"

export function promptForGoal(objective: string): string {
  return [
    GOAL_PROMPT_HEADING,
    "",
    "You are pursuing this session-level completion condition:",
    "",
    "<goal>",
    objective,
    "</goal>",
    "",
    `Work autonomously toward this outcome across turns. Keep the goal in force even when the user gives tactical guidance. Before declaring success, perform a completion audit against concrete evidence such as changed files, command output, tests, benchmarks, generated artifacts, or research evidence. When the condition is fully met, call ${GOAL_TOOL_NAME} with status "achieved" and concise evidence. If progress requires information, credentials, or a decision that you cannot obtain, call ${GOAL_TOOL_NAME} with status "blocked" and explain the blocker. Do not claim completion merely because you described a plan or made partial progress.`,
  ].join("\n")
}

export function continuationMessage(direction?: string): string {
  const extra =
    direction === undefined ? "" : `\n\nUser direction for this continuation:\n\n${direction}`
  return `[GOAL CONTINUATION]
Take the next substantive action toward the active goal in the system prompt. Do not restate progress or describe future steps.${extra}`
}

export function statusMessage(state: Readonly<GoalState>, elapsed: number): string {
  const lines = [
    `Goal: ${statusHeading(state.status)}`,
    `Objective: ${state.objective}`,
    `Elapsed: ${formatDuration(elapsed)} · Turns: ${state.turns} · Tokens: ${formatTokenCount(state.tokens)}`,
  ]
  if (state.evidence) lines.push(`Evidence: ${state.evidence}`)
  if (state.reason) lines.push(`Reason: ${state.reason}`)
  return lines.join("\n")
}

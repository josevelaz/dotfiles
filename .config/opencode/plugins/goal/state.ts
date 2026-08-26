export const GOAL_SNAPSHOT_KEY = "opencode.goal"
export const GOAL_STATE_VERSION = 1
export const GOAL_TOOL_NAME = "goal_report"

export type GoalStatus = "active" | "paused" | "blocked" | "achieved" | "budget-limited"

export interface GoalState {
  version: typeof GOAL_STATE_VERSION
  objective: string
  status: GoalStatus
  startedAt: number
  elapsedMs: number
  activeSince?: number
  turns: number
  tokens: number
  continuations: number
  tokenBaseline: number
  evidence?: string
  reason?: string
}

export interface GoalSnapshot {
  version: typeof GOAL_STATE_VERSION
  state: GoalState | null
}

export interface GoalContinuationMark {
  version: typeof GOAL_STATE_VERSION
  kind: "continuation"
}

export interface SnapshotSource {
  readonly type?: string
  readonly metadata?: Record<string, unknown>
  readonly time?: { readonly created?: unknown }
}

export interface InboxItemSource {
  readonly type?: string
  readonly payload?: {
    readonly metadata?: Record<string, unknown>
  }
}

const GOAL_STATUSES = new Set<GoalStatus>([
  "active",
  "paused",
  "blocked",
  "achieved",
  "budget-limited",
])

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function createdAt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (value instanceof Date) return value.getTime()
  return undefined
}

export function parseGoalState(value: unknown): GoalState | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const candidate = value as Partial<GoalState>
  if (candidate.version !== GOAL_STATE_VERSION) return undefined
  if (typeof candidate.objective !== "string" || candidate.objective.trim() === "") return undefined
  if (typeof candidate.status !== "string" || !GOAL_STATUSES.has(candidate.status as GoalStatus)) {
    return undefined
  }
  if (!isFiniteNonNegative(candidate.startedAt)) return undefined
  if (!isFiniteNonNegative(candidate.elapsedMs)) return undefined
  if (!isFiniteNonNegative(candidate.turns)) return undefined
  if (!isFiniteNonNegative(candidate.tokens)) return undefined
  if (!isFiniteNonNegative(candidate.continuations)) return undefined
  if (!isFiniteNonNegative(candidate.tokenBaseline)) return undefined
  if (candidate.activeSince !== undefined && !isFiniteNonNegative(candidate.activeSince)) return undefined
  if (candidate.evidence !== undefined && typeof candidate.evidence !== "string") return undefined
  if (candidate.reason !== undefined && typeof candidate.reason !== "string") return undefined

  return {
    version: GOAL_STATE_VERSION,
    objective: candidate.objective.trim(),
    status: candidate.status as GoalStatus,
    startedAt: candidate.startedAt,
    elapsedMs: candidate.elapsedMs,
    activeSince: candidate.activeSince,
    turns: Math.floor(candidate.turns),
    tokens: Math.floor(candidate.tokens),
    continuations: Math.floor(candidate.continuations),
    tokenBaseline: Math.floor(candidate.tokenBaseline),
    evidence: candidate.evidence,
    reason: candidate.reason,
  }
}

export function parseGoalSnapshot(value: unknown): GoalState | null | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const snapshot = value as Partial<GoalSnapshot> & { kind?: unknown }
  if (snapshot.version !== GOAL_STATE_VERSION) return undefined
  if (snapshot.kind === "continuation") return undefined
  if (snapshot.state === null) return null
  return parseGoalState(snapshot.state)
}

export function isGoalContinuation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const mark = value as Partial<GoalContinuationMark>
  return mark.version === GOAL_STATE_VERSION && mark.kind === "continuation"
}

export function snapshotFromMessage(message: SnapshotSource): GoalState | null | undefined {
  if (message.type !== "synthetic") return undefined
  return parseGoalSnapshot(message.metadata?.[GOAL_SNAPSHOT_KEY])
}

export function latestGoalSnapshot(messages: readonly SnapshotSource[]): GoalState | null | undefined {
  return latestGoalSnapshotRecord(messages)?.state
}

export function latestGoalSnapshotRecord(
  messages: readonly SnapshotSource[],
): { state: GoalState | null; createdAt?: number } | undefined {
  let latest: { state: GoalState | null; createdAt?: number } | undefined
  for (const message of messages) {
    const state = snapshotFromMessage(message)
    if (state === undefined) continue
    latest = { state, createdAt: createdAt(message.time?.created) }
  }
  return latest
}

export function isUserInboxItem(item: InboxItemSource): boolean {
  if (item.type !== "user") return false
  return !isGoalContinuation(item.payload?.metadata?.[GOAL_SNAPSHOT_KEY])
}

export function continuationMetadata(): GoalContinuationMark {
  return { version: GOAL_STATE_VERSION, kind: "continuation" }
}

export function snapshotMetadata(state: GoalState | null): GoalSnapshot {
  return { version: GOAL_STATE_VERSION, state }
}

export function transcriptText(status: GoalStatus | "cleared" | "resumed" | "progress"): string {
  switch (status) {
    case "active":
      return "Goal started"
    case "resumed":
      return "Goal resumed"
    case "paused":
      return "Goal paused"
    case "blocked":
      return "Goal blocked"
    case "achieved":
      return "Goal achieved"
    case "budget-limited":
      return "Goal budget limited"
    case "cleared":
      return "Goal cleared"
    case "progress":
      return "Goal"
  }
}

export function statusLabel(status: GoalStatus): string {
  switch (status) {
    case "active":
      return "active"
    case "paused":
      return "paused"
    case "blocked":
      return "blocked"
    case "achieved":
      return "achieved"
    case "budget-limited":
      return "budget limited"
  }
}

export function statusHeading(status: GoalStatus): string {
  switch (status) {
    case "active":
      return "Active"
    case "paused":
      return "Paused"
    case "blocked":
      return "Blocked"
    case "achieved":
      return "Achieved"
    case "budget-limited":
      return "Budget limited"
  }
}

export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: {
    readonly read: number
    readonly write: number
  }
}

export function totalTokens(usage: TokenUsage | undefined): number {
  if (usage === undefined) return 0
  return (
    Math.max(0, usage.input) +
    Math.max(0, usage.output) +
    Math.max(0, usage.reasoning) +
    Math.max(0, usage.cache.read) +
    Math.max(0, usage.cache.write)
  )
}

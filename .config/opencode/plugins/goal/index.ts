import { Plugin, type Plugin as PluginContract } from "@opencode-ai/plugin"
import {
  GOAL_PROMPT_HEADING,
  GoalController,
  continuationMessage,
  promptForGoal,
  statusMessage,
  type GoalBudgets,
} from "./controller"
import {
  GOAL_SNAPSHOT_KEY,
  GOAL_TOOL_NAME,
  continuationMetadata,
  isUserInboxItem,
  latestGoalSnapshot,
  parseGoalSnapshot,
  totalTokens,
  transcriptText,
  type GoalState,
  type SnapshotSource,
  type TokenUsage,
} from "./state"

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"])
const STATUS_ALIASES = new Set(["check", "status"])

const GOAL_TOOL_DESCRIPTION =
  "Finish or block the active session goal after auditing concrete evidence. Only use achieved when the entire completion condition is met."

interface PromptLike {
  readonly text: string
  readonly files?: ReadonlyArray<unknown>
  readonly agents?: ReadonlyArray<unknown>
  readonly skills?: ReadonlyArray<unknown>
}

interface CommandInvocation {
  readonly sessionID: string
  readonly prompt: PromptLike
  readonly delivery: "steer" | "queue"
}

interface ToolExecuteContext {
  readonly sessionID: string
}

interface SessionTokens {
  readonly tokens?: TokenUsage
}

interface InboxCancel {
  cancel(input: { sessionID: string; inboxID: string }): Promise<void>
}

interface SessionApi {
  get(input: { sessionID: string }): Promise<SessionTokens>
  context(input: { sessionID: string }): Promise<readonly SnapshotSource[]>
  prompt(input: {
    id?: string
    sessionID: string
    text: string
    files?: ReadonlyArray<unknown>
    agents?: ReadonlyArray<unknown>
    skills?: ReadonlyArray<unknown>
    metadata?: Record<string, unknown>
    delivery?: "steer" | "queue"
    resume?: boolean
  }): Promise<{ id: string }>
  synthetic(input: {
    id?: string
    sessionID: string
    text: string
    metadata?: Record<string, unknown>
    delivery?: "steer" | "queue"
    resume?: boolean
  }): Promise<{ id: string }>
  hook(
    name: "context",
    callback: (event: SessionContextEvent) => Promise<void> | void,
  ): Promise<{ dispose(): Promise<void> } | void> | { dispose(): Promise<void> } | void
  inbox?: InboxCancel
}

interface StorageApi {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

interface SessionContextEvent {
  readonly sessionID: string
  system: Array<{ type: string; text: string }>
  tools: Record<string, unknown>
}

interface CommandDraft {
  add(definition: {
    name: string
    description?: string
    execute: (input: CommandInvocation) => Promise<void>
  }): void
}

interface ToolDraft {
  add(tool: {
    name: string
    description: string
    input: Record<string, unknown>
    execute: (input: unknown, context: ToolExecuteContext) => Promise<{ content: string }>
  }): void
}

export interface GoalPluginContext {
  command: {
    transform(callback: (draft: CommandDraft) => void): Promise<unknown>
  }
  tool: {
    transform(callback: (draft: ToolDraft) => void): Promise<unknown>
  }
  session: SessionApi
  storage?: StorageApi
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<{ type: string; data?: Record<string, unknown> }>
  }
}

interface GoalRuntimeOptions {
  clock?: () => number
  budgets?: GoalBudgets
}

interface SessionRun {
  hadToolCall: boolean
  isContinuation: boolean
  wasActive: boolean
  handledSuccess: boolean
  pendingContinuationID?: string
  userInboxIDs: Set<string>
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function eventSessionID(event: { data?: Record<string, unknown> }): string | undefined {
  const sessionID = event.data?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function shortHash(input: string): string {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

function continuationID(sessionID: string, controller: GoalController, direction?: string): string {
  const current = controller.current
  const continuations = current?.continuations ?? 0
  const turns = current?.turns ?? 0
  const startedAt = current?.startedAt ?? 0
  const revision = current?.revision ?? 0
  const objectiveHash = current === undefined ? "none" : shortHash(current.objective)
  const dirHash = direction === undefined ? "auto" : shortHash(direction)
  return `msg_goal-continuation-${sessionID}-s${startedAt}-r${revision}-t${turns}-c${continuations}-o${objectiveHash}-${dirHash}`
}

function snapshotID(sessionID: string, text: string, controller: GoalController): string {
  const current = controller.current
  if (current === undefined) {
    return `msg_goal-snapshot-${sessionID}-cleared-${shortHash(text)}-${Date.now().toString(36)}`
  }
  const stable = JSON.stringify({
    objective: current.objective,
    startedAt: current.startedAt,
    status: current.status,
    turns: current.turns,
    tokens: current.tokens,
    continuations: current.continuations,
    tokenBaseline: current.tokenBaseline,
    revision: current.revision ?? 0,
    reason: current.reason ?? null,
    evidence: current.evidence ?? null,
    text,
  })
  return `msg_goal-snapshot-${sessionID}-${current.turns}-${current.continuations}-${current.status}-${shortHash(stable)}`
}

function isConflictError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false
  const candidate = error as {
    _tag?: unknown
    name?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
  }
  if (candidate._tag === "ConflictError" || candidate.name === "ConflictError") return true
  if (candidate.code === 409 || candidate.status === 409 || candidate.statusCode === 409) return true
  const message = typeof candidate.message === "string" ? candidate.message : ""
  return message.toLowerCase().includes("conflict")
}

// Module-level single-flight for the event subscription. If the host runs
// plugin setup more than once in this process without disposing (command and
// context-hook registrations cannot be unregistered), every live listener
// would handle every event and queue duplicate continuations. Only the newest
// runtime owns the event flow; each runtime keeps its own state maps.
let liveListenerAbort: AbortController | undefined

export class GoalRuntime {
  private readonly controllers = new Map<string, GoalController>()
  private readonly runs = new Map<string, SessionRun>()
  private readonly chains = new Map<string, Promise<void>>()
  private readonly clock: () => number
  private readonly budgets?: GoalBudgets
  private readonly inflight = new Map<string, Promise<GoalController>>()

  constructor(
    private readonly ctx: GoalPluginContext,
    options: GoalRuntimeOptions = {},
  ) {
    this.clock = options.clock ?? Date.now
    this.budgets = options.budgets
  }

  async start(): Promise<() => void> {
    await this.ctx.command.transform((draft) => {
      draft.add({
        name: "goal",
        description: "Set or manage an autonomous session goal",
        execute: async (input) => {
          await this.enqueue(input.sessionID, () => this.handleCommand(input))
        },
      })
    })

    await this.ctx.tool.transform((draft) => {
      draft.add({
        name: GOAL_TOOL_NAME,
        description: GOAL_TOOL_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["achieved", "blocked"],
            },
            evidence: {
              type: "string",
              minLength: 1,
              description:
                "For achieved: concrete verification evidence. For blocked: the exact blocker and useful next step.",
            },
          },
          required: ["status", "evidence"],
          additionalProperties: false,
        },
        execute: async (input, tool) =>
          this.enqueue(tool.sessionID, () => this.handleReport(tool.sessionID, input)),
      })
    })

    await this.ctx.session.hook("context", async (event) => {
      let controller: GoalController | undefined
      try {
        // Restore from the durable transcript snapshot (with storage fallback)
        // so the goal survives server restarts. The in-memory cache alone is
        // empty after boot, which previously hid the goal and goal_report.
        // session.context reads persisted messages and does not re-enter this hook.
        controller = await this.controllerOf(event.sessionID)
      } catch {
        controller = this.controllers.get(event.sessionID)
      }
      const objective = controller?.current?.objective
      if (controller?.isActive === true && objective !== undefined) {
        // The goal block must be the last part of the system prompt: later
        // hooks and built-ins append after earlier entries, and the tail of
        // the system prompt is what survives compaction pressure. Strip any
        // stale goal block already present, then append fresh so exactly one
        // goal block exists and it is final.
        for (let index = event.system.length - 1; index >= 0; index -= 1) {
          const part = event.system[index]
          if (part !== undefined && isGoalPromptPart(part)) event.system.splice(index, 1)
        }
        event.system.push({ type: "text", text: promptForGoal(objective) })
        return
      }
      delete event.tools[GOAL_TOOL_NAME]
    })

    const abort = new AbortController()
    liveListenerAbort?.abort()
    liveListenerAbort = abort
    void this.listen(abort.signal)
    return () => {
      abort.abort()
      if (liveListenerAbort === abort) liveListenerAbort = undefined
      this.controllers.clear()
      this.runs.clear()
      this.chains.clear()
      this.inflight.clear()
    }
  }

  async handleEvent(event: { type: string; data?: Record<string, unknown> }): Promise<void> {
    const sessionID = eventSessionID(event)
    if (event.type === "session.deleted") {
      if (sessionID !== undefined) this.forget(sessionID)
      return
    }
    if (event.type === "session.forked") {
      if (sessionID !== undefined) await this.enqueue(sessionID, () => this.handleFork(event.data ?? {}))
      return
    }
    if (sessionID === undefined) return
    await this.enqueue(sessionID, () => this.handleSessionEvent(sessionID, event))
  }

  private async listen(signal: AbortSignal): Promise<void> {
    try {
      for await (const event of this.ctx.event.subscribe({ signal })) {
        if (signal.aborted) return
        try {
          await this.handleEvent(event)
        } catch {
          if (signal.aborted) return
          // One bad event must not silently kill the subscription for every
          // later event. Per-session serialization is preserved by enqueue.
        }
        if (signal.aborted) return
      }
    } catch {
      if (signal.aborted) return
    }
  }

  private enqueue<T>(sessionID: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(sessionID) ?? Promise.resolve()).then(operation, operation)
    this.chains.set(
      sessionID,
      next.then(
        () => {},
        () => {},
      ),
    )
    return next
  }

  private forget(sessionID: string): void {
    this.controllers.delete(sessionID)
    this.runs.delete(sessionID)
    this.chains.delete(sessionID)
    void this.ctx.storage?.remove(goalStorageKey(sessionID)).catch(() => {})
  }

  private runOf(sessionID: string): SessionRun {
    const existing = this.runs.get(sessionID)
    if (existing !== undefined) return existing
    const created: SessionRun = {
      hadToolCall: false,
      isContinuation: false,
      wasActive: false,
      handledSuccess: false,
      userInboxIDs: new Set(),
    }
    this.runs.set(sessionID, created)
    return created
  }

  private async controllerOf(sessionID: string): Promise<GoalController> {
    const cached = this.controllers.get(sessionID)
    if (cached !== undefined) return cached
    // Deduplicate concurrent cold-cache restores (e.g. the context hook and a
    // /goal command racing after a restart) so one instance wins and later
    // mutations cannot be clobbered by a stale loser. Deliberately outside
    // enqueue: the hook must never block on the session queue.
    const ongoing = this.inflight.get(sessionID)
    if (ongoing !== undefined) return ongoing
    const restore = (async () => {
      const controller = new GoalController(this.clock, this.budgets)
      const messages = await this.ctx.session.context({ sessionID })
      const transcript = latestGoalSnapshot(messages)
      if (transcript !== undefined) {
        // Either a GoalState or an explicit null (cleared goal). A deliberate
        // clear must win over any stored snapshot.
        controller.restore(transcript)
      } else {
        // No snapshot message in the transcript window (e.g. evicted by
        // compaction or truncation). Fall back to plugin storage. Transcript
        // snapshots always win when present, so a clear is never resurrected
        // while its tombstone remains in context; storage writes are
        // best-effort, so a failed write followed by tombstone eviction
        // remains a known residual risk.
        const stored = await this.readStoredSnapshot(sessionID)
        controller.restore(stored ?? null)
      }
      this.controllers.set(sessionID, controller)
      return controller
    })()
    this.inflight.set(sessionID, restore)
    try {
      return await restore
    } finally {
      if (this.inflight.get(sessionID) === restore) this.inflight.delete(sessionID)
    }
  }

  private async readStoredSnapshot(sessionID: string): Promise<GoalState | null | undefined> {
    try {
      const stored = await this.ctx.storage?.get(goalStorageKey(sessionID))
      if (stored === undefined) return undefined
      return parseGoalSnapshot(stored)
    } catch {
      return undefined
    }
  }

  private async writeStorage(sessionID: string, controller: GoalController): Promise<void> {
    try {
      await this.ctx.storage?.set(goalStorageKey(sessionID), controller.serialize())
    } catch {
      // Storage is a best-effort fallback; the synthetic transcript snapshot
      // remains the primary durable record.
    }
  }

  private async persist(
    sessionID: string,
    text: string,
    controller: GoalController,
  ): Promise<void> {
    const id = snapshotID(sessionID, text, controller)
    try {
      await this.ctx.session.synthetic({
        id,
        sessionID,
        text,
        metadata: { [GOAL_SNAPSHOT_KEY]: controller.serialize() },
        resume: false,
      })
    } catch (error) {
      if (!isConflictError(error)) throw error
    }
    await this.writeStorage(sessionID, controller)
  }

  private async statusOnly(sessionID: string, text: string): Promise<void> {
    await this.ctx.session.synthetic({ sessionID, text, resume: false })
  }

  private async cancelContinuation(sessionID: string): Promise<boolean> {
    const run = this.runs.get(sessionID)
    const inboxID = run?.pendingContinuationID
    if (run === undefined || inboxID === undefined) return true
    const inbox = this.ctx.session.inbox
    if (inbox === undefined) {
      // No inbox cancel API is exposed to plugins, so the queued item is
      // still live server-side. Keep tracking it so the single-flight guards
      // hold; its delivery or cancellation event will resolve tracking.
      // Clearing here would let the next turn queue a duplicate.
      return false
    }
    try {
      await inbox.cancel({ sessionID, inboxID })
    } catch {
      return false
    }
    run.pendingContinuationID = undefined
    return true
  }

  private async handleCommand(input: CommandInvocation): Promise<void> {
    const raw = input.prompt.text.trim()
    const control = raw.toLowerCase()
    const controller = await this.controllerOf(input.sessionID)

    if (raw === "" || STATUS_ALIASES.has(control)) {
      const current = controller.current
      if (current === undefined) {
        await this.statusOnly(input.sessionID, "No goal is set. Use /goal <completion condition>.")
        return
      }
      await this.statusOnly(input.sessionID, statusMessage(current, controller.elapsedMs()))
      return
    }

    if (CLEAR_ALIASES.has(control)) {
      if (!controller.clear()) {
        await this.statusOnly(input.sessionID, "No goal is set.")
        return
      }
      await this.cancelContinuation(input.sessionID)
      await this.persist(input.sessionID, transcriptText("cleared"), controller)
      return
    }

    if (control === "pause") {
      if (!controller.pause("Paused by the user.")) {
        await this.statusOnly(input.sessionID, "No active goal to pause.")
        return
      }
      await this.cancelContinuation(input.sessionID)
      await this.persist(input.sessionID, transcriptText("paused"), controller)
      return
    }

    const resumeMatch = raw.match(/^resume(?:\s+([\s\S]*))?$/i)
    if (resumeMatch !== null) {
      if (!controller.resume()) {
        await this.statusOnly(
          input.sessionID,
          "No paused, blocked, or budget-limited goal to resume.",
        )
        return
      }
      const direction = resumeMatch[1]?.trim() || undefined
      await this.persist(input.sessionID, transcriptText("resumed"), controller)
      await this.queueContinuation(input.sessionID, controller, direction)
      return
    }

    const session = await this.ctx.session.get({ sessionID: input.sessionID })
    controller.start(raw, totalTokens(session.tokens))
    const run = this.runOf(input.sessionID)
    run.isContinuation = false
    run.wasActive = true
    run.handledSuccess = false
    run.hadToolCall = false
    await this.cancelContinuation(input.sessionID)
    await this.persist(input.sessionID, transcriptText("active"), controller)
    await this.ctx.session.prompt({
      sessionID: input.sessionID,
      text: raw,
      delivery: input.delivery,
      ...promptAttachments(input.prompt),
    })
  }

  private async handleReport(sessionID: string, input: unknown): Promise<{ content: string }> {
    const body = input as { status?: unknown; evidence?: unknown }
    const evidence = typeof body.evidence === "string" ? body.evidence.trim() : ""
    const controller = await this.controllerOf(sessionID)
    if (!controller.isActive || controller.current === undefined) {
      return { content: "No active goal can be reported." }
    }
    if (evidence === "") {
      return { content: "Evidence is required." }
    }

    if (body.status === "achieved") {
      controller.achieve(evidence)
      await this.cancelContinuation(sessionID)
      await this.persist(sessionID, transcriptText("achieved"), controller)
      return { content: "Goal achieved. The evidence was reported to the user." }
    }

    if (body.status === "blocked") {
      controller.block(evidence)
      await this.cancelContinuation(sessionID)
      await this.persist(sessionID, transcriptText("blocked"), controller)
      return { content: "Goal blocked and paused. The blocker was reported to the user." }
    }

    return { content: "Status must be achieved or blocked." }
  }

  private async handleFork(data: Record<string, unknown>): Promise<void> {
    const sessionID = textOf(data.sessionID)
    const parentID = textOf(data.parentID)
    if (sessionID === "") return

    const childMessages = await this.ctx.session.context({ sessionID })
    const inherited = latestGoalSnapshot(childMessages)
    if (inherited !== undefined) {
      const controller = new GoalController(this.clock, this.budgets)
      controller.restore(inherited)
      this.controllers.set(sessionID, controller)
      await this.writeStorage(sessionID, controller)
      return
    }

    if (parentID === "") return
    const parent = await this.controllerOf(parentID)
    const snapshot = parent.serialize().state
    const controller = new GoalController(this.clock, this.budgets)
    controller.restore(snapshot)
    this.controllers.set(sessionID, controller)
    if (snapshot !== null) {
      await this.persist(sessionID, transcriptText(snapshot.status === "active" ? "active" : snapshot.status), controller)
    }
  }

  private async handleSessionEvent(
    sessionID: string,
    event: { type: string; data?: Record<string, unknown> },
  ): Promise<void> {
    switch (event.type) {
      case "session.inbox.enqueued":
        this.onInboxEnqueued(sessionID, event.data)
        return
      case "session.inbox.delivered":
        this.onInboxSettled(sessionID, textOf(event.data?.inboxID), true)
        return
      case "session.inbox.cancelled":
        this.onInboxSettled(sessionID, textOf(event.data?.inboxID), false)
        return
      case "session.execution.started":
        await this.onExecutionStarted(sessionID)
        return
      case "session.tool.called":
        this.runOf(sessionID).hadToolCall = true
        return
      case "session.execution.succeeded":
        await this.onExecutionSucceeded(sessionID)
        return
      case "session.execution.failed":
        await this.onExecutionStopped(sessionID, failureReason(event.data))
        return
      case "session.execution.interrupted":
        if (event.data?.reason === "superseded") return
        await this.onExecutionStopped(sessionID, interruptReason(event.data?.reason))
        return
    }
  }

  private onInboxEnqueued(sessionID: string, data: Record<string, unknown> | undefined): void {
    const inboxID = textOf(data?.inboxID)
    const item = data?.item as { type?: string; payload?: { metadata?: Record<string, unknown> } } | undefined
    if (inboxID === "" || item === undefined) return
    const run = this.runOf(sessionID)
    if (isUserInboxItem(item)) {
      run.userInboxIDs.add(inboxID)
      return
    }
    if (item.type === "user" && item.payload?.metadata?.[GOAL_SNAPSHOT_KEY] !== undefined) {
      run.pendingContinuationID = inboxID
    }
  }

  private onInboxSettled(sessionID: string, inboxID: string, delivered: boolean): void {
    if (inboxID === "") return
    const run = this.runOf(sessionID)
    run.userInboxIDs.delete(inboxID)
    if (run.pendingContinuationID !== inboxID) return
    run.pendingContinuationID = undefined
    if (delivered) run.isContinuation = true
  }

  private async onExecutionStarted(sessionID: string): Promise<void> {
    const run = this.runOf(sessionID)
    let active = this.controllers.get(sessionID)?.isActive === true
    if (!active) {
      // After a server restart the in-memory cache is empty; restore from the
      // durable snapshot so wasActive reflects the real goal state.
      try {
        active = (await this.controllerOf(sessionID)).isActive
      } catch {
        active = false
      }
    }
    run.hadToolCall = false
    run.wasActive = active
    run.handledSuccess = false
    if (run.pendingContinuationID === undefined) return
    run.isContinuation = true
  }

  private async onExecutionSucceeded(sessionID: string): Promise<void> {
    const run = this.runOf(sessionID)
    if (run.handledSuccess) return
    run.handledSuccess = true

    const controller = await this.controllerOf(sessionID)
    if (run.wasActive || controller.current !== undefined) {
      const session = await this.ctx.session.get({ sessionID })
      controller.recordEvaluation(totalTokens(session.tokens))
    }

    const persisted = await this.continueIfNeeded(sessionID, controller, run)
    if (!persisted && controller.current !== undefined && run.wasActive) {
      await this.persist(sessionID, transcriptText("progress"), controller)
    }
    run.isContinuation = false
    run.wasActive = false
  }

  private async onExecutionStopped(sessionID: string, reason: string): Promise<void> {
    const controller = await this.controllerOf(sessionID)
    if (!controller.pause(reason)) return
    await this.cancelContinuation(sessionID)
    await this.persist(sessionID, transcriptText("paused"), controller)
    const run = this.runs.get(sessionID)
    if (run !== undefined) {
      run.isContinuation = false
      run.wasActive = false
    }
  }

  private async continueIfNeeded(
    sessionID: string,
    controller: GoalController,
    run: SessionRun,
  ): Promise<boolean> {
    if (!controller.isActive) return false
    if (run.userInboxIDs.size > 0) return false
    if (run.pendingContinuationID !== undefined) return false

    if (run.isContinuation && !run.hadToolCall) {
      controller.pause("Automatic continuation stopped because the last continuation made no tool call.")
      await this.persist(sessionID, transcriptText("paused"), controller)
      return true
    }

    const budgetReason = controller.budgetReason()
    if (budgetReason !== undefined) {
      controller.limitBudget(budgetReason)
      await this.persist(sessionID, transcriptText("budget-limited"), controller)
      return true
    }

    controller.recordContinuation()
    await this.persist(sessionID, transcriptText("progress"), controller)
    await this.queueContinuation(sessionID, controller)
    return true
  }

  private async queueContinuation(
    sessionID: string,
    controller: GoalController,
    direction?: string,
  ): Promise<void> {
    if (!controller.isActive) return
    if (this.runOf(sessionID).userInboxIDs.size > 0) return
    if (this.runOf(sessionID).pendingContinuationID !== undefined) return

    const id = continuationID(sessionID, controller, direction)
    let queued: { id?: string } | undefined
    try {
      queued = await this.ctx.session.prompt({
        id,
        sessionID,
        text: continuationMessage(direction),
        metadata: { [GOAL_SNAPSHOT_KEY]: continuationMetadata() },
        delivery: "queue",
      })
    } catch (error) {
      if (isConflictError(error)) {
        this.runOf(sessionID).pendingContinuationID = id
        return
      }
      throw error
    }
    this.runOf(sessionID).pendingContinuationID = queued?.id || id
  }
}

function goalStorageKey(sessionID: string): string {
  return `goal/${sessionID}`
}

function isGoalPromptPart(part: { type: string; text: string }): boolean {
  return part.type === "text" && part.text.startsWith(`${GOAL_PROMPT_HEADING}\n`)
}

function promptAttachments(prompt: PromptLike): {
  files?: ReadonlyArray<unknown>
  agents?: ReadonlyArray<unknown>
  skills?: ReadonlyArray<unknown>
} {
  return {
    ...(Array.isArray(prompt.files) ? { files: prompt.files } : {}),
    ...(Array.isArray(prompt.agents) ? { agents: prompt.agents } : {}),
    ...(Array.isArray(prompt.skills) ? { skills: prompt.skills } : {}),
  }
}

function failureReason(data: Record<string, unknown> | undefined): string {
  const error = data?.error as { message?: unknown } | undefined
  const message = typeof error?.message === "string" && error.message.trim() !== "" ? error.message.trim() : undefined
  return message === undefined ? "Execution failed." : `Execution failed: ${message}`
}

function interruptReason(reason: unknown): string {
  if (reason === "shutdown") return "Interrupted by shutdown."
  return "Interrupted by the user."
}

export async function setupGoalPlugin(
  ctx: GoalPluginContext,
  options?: GoalRuntimeOptions,
): Promise<() => void> {
  return new GoalRuntime(ctx, options).start()
}

export default Plugin.define({
  id: "local.goal",
  async setup(ctx: PluginContract.Context) {
    return setupGoalPlugin(ctx as unknown as GoalPluginContext)
  },
})

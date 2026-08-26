import { Plugin, type Plugin as PluginContract } from "@opencode-ai/plugin"
import {
  GoalController,
  continuationMessage,
  promptForGoal,
  statusMessage,
  type GoalBudgets,
} from "./controller.ts"
import {
  GOAL_SNAPSHOT_KEY,
  GOAL_TOOL_NAME,
  continuationMetadata,
  isUserInboxItem,
  latestGoalSnapshot,
  snapshotMetadata,
  totalTokens,
  transcriptText,
  type SnapshotSource,
  type TokenUsage,
} from "./state.ts"

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
    sessionID: string
    text: string
    files?: ReadonlyArray<unknown>
    agents?: ReadonlyArray<unknown>
    skills?: ReadonlyArray<unknown>
    metadata?: Record<string, unknown>
    delivery?: "steer" | "queue"
  }): Promise<{ id: string }>
  synthetic(input: {
    sessionID: string
    text: string
    metadata?: Record<string, unknown>
  }): Promise<{ id: string }>
  hook(
    name: "context",
    callback: (event: SessionContextEvent) => Promise<void> | void,
  ): Promise<{ dispose(): Promise<void> } | void> | { dispose(): Promise<void> } | void
  inbox?: InboxCancel
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

function inboxOf(session: SessionApi): InboxCancel | undefined {
  return session.inbox
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function eventSessionID(event: { data?: Record<string, unknown> }): string | undefined {
  const sessionID = event.data?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

export class GoalRuntime {
  private readonly controllers = new Map<string, GoalController>()
  private readonly runs = new Map<string, SessionRun>()
  private readonly chains = new Map<string, Promise<void>>()
  private readonly clock: () => number
  private readonly budgets?: GoalBudgets

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

    await this.ctx.session.hook("context", (event) => {
      const controller = this.controllers.get(event.sessionID)
      const objective = controller?.current?.objective
      if (controller?.isActive && objective !== undefined) {
        event.system.push({ type: "text", text: promptForGoal(objective) })
        return
      }
      delete event.tools[GOAL_TOOL_NAME]
    })

    const abort = new AbortController()
    void this.listen(abort.signal)
    return () => {
      abort.abort()
      this.controllers.clear()
      this.runs.clear()
      this.chains.clear()
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
        await this.handleEvent(event)
      }
    } catch {
      if (signal.aborted) return
    }
  }

  private enqueue(sessionID: string, operation: () => Promise<unknown>): Promise<void> {
    const run = async () => {
      await operation()
    }
    const next = (this.chains.get(sessionID) ?? Promise.resolve()).then(run, run)
    this.chains.set(
      sessionID,
      next.catch(() => {}),
    )
    return next
  }

  private forget(sessionID: string): void {
    this.controllers.delete(sessionID)
    this.runs.delete(sessionID)
    this.chains.delete(sessionID)
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
    const controller = new GoalController(this.clock, this.budgets)
    const messages = await this.ctx.session.context({ sessionID })
    controller.restore(latestGoalSnapshot(messages) ?? null)
    this.controllers.set(sessionID, controller)
    return controller
  }

  private async persist(
    sessionID: string,
    text: string,
    controller: GoalController,
  ): Promise<void> {
    await this.ctx.session.synthetic({
      sessionID,
      text,
      metadata: { [GOAL_SNAPSHOT_KEY]: controller.serialize() },
    })
  }

  private async statusOnly(sessionID: string, text: string): Promise<void> {
    await this.ctx.session.synthetic({ sessionID, text })
  }

  private async cancelContinuation(sessionID: string): Promise<void> {
    const run = this.runs.get(sessionID)
    const inboxID = run?.pendingContinuationID
    if (inboxID === undefined) return
    run.pendingContinuationID = undefined
    await inboxOf(this.ctx.session)?.cancel({ sessionID, inboxID })
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
      files: input.prompt.files,
      agents: input.prompt.agents,
      skills: input.prompt.skills,
      delivery: input.delivery,
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
        this.onExecutionStarted(sessionID)
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

  private onExecutionStarted(sessionID: string): void {
    const run = this.runOf(sessionID)
    const controller = this.controllers.get(sessionID)
    run.hadToolCall = false
    run.wasActive = controller?.isActive === true
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
    const objective = controller.current?.objective
    if (!controller.isActive || objective === undefined) return
    if (this.runOf(sessionID).userInboxIDs.size > 0) return
    if (this.runOf(sessionID).pendingContinuationID !== undefined) return

    const queued = await this.ctx.session.prompt({
      sessionID,
      text: continuationMessage(objective, direction),
      metadata: { [GOAL_SNAPSHOT_KEY]: continuationMetadata() },
      delivery: "queue",
    })
    this.runOf(sessionID).pendingContinuationID = queued.id
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

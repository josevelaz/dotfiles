import { describe, expect, test } from "bun:test"
import { GoalRuntime, type GoalPluginContext } from "./index.ts"
import {
  GOAL_SNAPSHOT_KEY,
  GOAL_STATE_VERSION,
  continuationMetadata,
  parseGoalSnapshot,
  type GoalState,
  type SnapshotSource,
  type TokenUsage,
} from "./state.ts"

type Command = {
  execute: (input: {
    sessionID: string
    prompt: { text: string; files?: ReadonlyArray<unknown> }
    delivery: "steer" | "queue"
  }) => Promise<void>
}

type Tool = {
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content: string }>
}

type ContextHook = (event: {
  sessionID: string
  system: Array<{ type: string; text: string }>
  tools: Record<string, unknown>
}) => Promise<void> | void

const SESSION = "ses_goal"

function usage(total: number): TokenUsage {
  return { input: total, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

class GoalHarness {
  readonly commands = new Map<string, Command>()
  readonly tools = new Map<string, Tool>()
  readonly synthetics: Array<{ text: string; metadata?: Record<string, unknown> }> = []
  readonly prompts: Array<{
    text: string
    delivery?: "steer" | "queue"
    metadata?: Record<string, unknown>
    files?: ReadonlyArray<unknown>
  }> = []
  readonly cancelled: string[] = []
  readonly messages: SnapshotSource[] = []
  tokens = usage(0)
  contextHook: ContextHook | undefined
  inboxSeq = 0
  lastPromptID = ""

  readonly userInbox = new Set<string>()

  readonly ctx = {
    command: {
      transform: async (callback: (draft: { add: (definition: Command & { name: string }) => void }) => void) => {
        callback({
          add: (definition) => this.commands.set(definition.name, definition),
        })
      },
    },
    tool: {
      transform: async (callback: (draft: { add: (tool: Tool & { name: string }) => void }) => void) => {
        callback({
          add: (tool) => this.tools.set(tool.name, tool),
        })
      },
    },
    session: {
      get: async () => ({ tokens: this.tokens }),
      context: async () => this.messages,
      prompt: async (input: {
        text: string
        delivery?: "steer" | "queue"
        metadata?: Record<string, unknown>
        files?: ReadonlyArray<unknown>
      }) => {
        this.prompts.push(input)
        this.inboxSeq += 1
        this.lastPromptID = `inbox_${this.inboxSeq}`
        return { id: this.lastPromptID }
      },
      synthetic: async (input: { text: string; metadata?: Record<string, unknown> }) => {
        this.synthetics.push(input)
        this.messages.push({
          type: "synthetic",
          metadata: input.metadata,
          time: { created: this.synthetics.length },
        })
        this.inboxSeq += 1
        return { id: `syn_${this.inboxSeq}` }
      },
      hook: async (name: string, callback: ContextHook) => {
        if (name === "context") this.contextHook = callback
      },
      inbox: {
        cancel: async (input: { inboxID: string }) => {
          this.cancelled.push(input.inboxID)
        },
      },
    },
    event: {
      subscribe: async function* () {},
    },
  }

  readonly runtime: GoalRuntime

  constructor(options?: { budgets?: { maxContinuations: number } }) {
    this.runtime = new GoalRuntime(this.ctx as unknown as GoalPluginContext, options)
  }

  async start(): Promise<void> {
    await this.runtime.start()
  }

  async command(text: string, delivery: "steer" | "queue" = "queue"): Promise<void> {
    await this.commands.get("goal")?.execute({
      sessionID: SESSION,
      prompt: { text },
      delivery,
    })
  }

  async report(status: "achieved" | "blocked", evidence: string): Promise<{ content: string } | undefined> {
    return this.tools.get("goal_report")?.execute({ status, evidence }, { sessionID: SESSION })
  }

  async emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.runtime.handleEvent({ type, data: { sessionID: SESSION, ...data } })
  }

  latestState(): GoalState | null | undefined {
    return parseGoalSnapshot(this.synthetics.at(-1)?.metadata?.[GOAL_SNAPSHOT_KEY])
  }
}

describe("GoalRuntime commands", () => {
  test("starts a goal, persists a snapshot, and submits the first turn", async () => {
    const app = new GoalHarness()
    await app.start()
    app.tokens = usage(40)
    await app.command("All tests pass without warnings", "steer")

    expect(app.latestState()).toMatchObject({
      objective: "All tests pass without warnings",
      status: "active",
      tokenBaseline: 40,
    })
    expect(app.synthetics.at(-1)?.text).toBe("Goal started")
    expect(app.prompts.at(-1)).toMatchObject({
      text: "All tests pass without warnings",
      delivery: "steer",
    })
  })

  test("preserves prompt attachments when starting a goal", async () => {
    const app = new GoalHarness()
    await app.start()
    const files = [{ uri: "file:///tmp/note.md" }]
    await app.commands.get("goal")?.execute({
      sessionID: SESSION,
      prompt: { text: "Use the attached note", files },
      delivery: "queue",
    })
    expect(app.prompts.at(-1)?.files).toEqual(files)
  })

  test("supports status, pause, resume with direction, clear, and aliases", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Migrate the API")
    await app.command("pause")
    expect(app.latestState()).toMatchObject({ status: "paused", reason: "Paused by the user." })
    expect(app.synthetics.at(-1)?.text).toBe("Goal paused")

    await app.command("resume Deploy to staging first")
    expect(app.latestState()).toMatchObject({
      objective: "Migrate the API",
      status: "active",
    })
    expect(app.prompts.at(-1)?.text).toContain("User direction for this continuation")
    expect(app.prompts.at(-1)?.text).toContain("Deploy to staging first")
    expect(app.prompts.at(-1)?.delivery).toBe("queue")
    expect(app.prompts.at(-1)?.metadata?.[GOAL_SNAPSHOT_KEY]).toEqual(continuationMetadata())

    await app.command("")
    expect(app.synthetics.at(-1)?.text).toContain("Objective: Migrate the API")
    expect(app.synthetics.at(-1)?.metadata).toBeUndefined()

    await app.command("cancel")
    expect(app.latestState()).toBeNull()
    expect(app.synthetics.at(-1)?.text).toBe("Goal cleared")
  })

  test("returns a clear status message for invalid lifecycle actions", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("pause")
    expect(app.synthetics.at(-1)?.text).toBe("No active goal to pause.")
    await app.command("resume")
    expect(app.synthetics.at(-1)?.text).toBe("No paused, blocked, or budget-limited goal to resume.")
    await app.command("clear")
    expect(app.synthetics.at(-1)?.text).toBe("No goal is set.")
    await app.command("check")
    expect(app.synthetics.at(-1)?.text).toContain("No goal is set")
  })
})

describe("GoalRuntime model context and reports", () => {
  test("injects the active objective and hides goal_report otherwise", async () => {
    const app = new GoalHarness()
    await app.start()
    const idle = {
      sessionID: SESSION,
      system: [] as Array<{ type: string; text: string }>,
      tools: { goal_report: { description: "x" }, read: { description: "y" } },
    }
    await app.contextHook?.(idle)
    expect(idle.tools.goal_report).toBeUndefined()
    expect(idle.tools.read).toBeDefined()

    await app.command("Reach 90% coverage")
    const active = {
      sessionID: SESSION,
      system: [] as Array<{ type: string; text: string }>,
      tools: { goal_report: { description: "x" } },
    }
    await app.contextHook?.(active)
    expect(active.system[0]?.text).toContain("Reach 90% coverage")
    expect(active.system[0]?.text).toContain("completion audit")
    expect(active.tools.goal_report).toBeDefined()
  })

  test("achieved and blocked reports require evidence and stop continuation", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Make tests green")
    const missing = await app.report("achieved", "   ")
    expect(missing?.content).toContain("Evidence is required")

    const stale = await app.tools.get("goal_report")?.execute(
      { status: "achieved", evidence: "done" },
      { sessionID: "ses_other" },
    )
    expect(stale?.content).toBe("No active goal can be reported.")

    const achieved = await app.report("achieved", "bun test: 42 passed")
    expect(achieved?.content).toContain("Goal achieved")
    expect(app.latestState()).toMatchObject({
      status: "achieved",
      evidence: "bun test: 42 passed",
    })
    expect(app.synthetics.at(-1)?.text).toBe("Goal achieved")

    const app2 = new GoalHarness()
    await app2.start()
    await app2.command("Deploy the release")
    const blocked = await app2.report("blocked", "Need the target environment.")
    expect(blocked?.content).toContain("Goal blocked")
    expect(app2.latestState()).toMatchObject({
      status: "blocked",
      reason: "Need the target environment.",
    })
  })
})

describe("GoalRuntime continuation", () => {
  test("queues one continuation after a substantive turn", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Fix the suite")
    app.tokens = usage(250)
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    await app.emit("session.execution.succeeded")

    expect(app.latestState()).toMatchObject({
      turns: 1,
      tokens: 250,
      continuations: 1,
      status: "active",
    })
    expect(app.prompts.at(-1)?.text).toContain("[GOAL CONTINUATION]")
    expect(app.prompts.filter((prompt) => prompt.metadata !== undefined)).toHaveLength(1)
  })

  test("pauses a no-tool automatic continuation", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Fix the suite")
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    await app.emit("session.execution.succeeded")

    const continuationID = app.lastPromptID
    await app.emit("session.inbox.enqueued", {
      inboxID: continuationID,
      item: {
        type: "user",
        payload: { metadata: { [GOAL_SNAPSHOT_KEY]: continuationMetadata() } },
      },
    })
    await app.emit("session.inbox.delivered", { inboxID: continuationID })
    app.tokens = usage(350)
    await app.emit("session.execution.started")
    const promptCount = app.prompts.length
    await app.emit("session.execution.succeeded")

    expect(app.prompts.length).toBe(promptCount)
    expect(app.latestState()).toMatchObject({
      status: "paused",
      turns: 2,
      tokens: 350,
    })
    expect(app.latestState()?.reason).toContain("made no tool call")
  })

  test("does not continue while user input is queued", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Finish the migration")
    await app.emit("session.inbox.enqueued", {
      inboxID: "user_1",
      item: { type: "user", payload: { metadata: {} } },
    })
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    const promptCount = app.prompts.length
    await app.emit("session.execution.succeeded")
    expect(app.prompts.length).toBe(promptCount)
  })

  test("pauses on user interruption and execution failure", async () => {
    const interrupted = new GoalHarness()
    await interrupted.start()
    await interrupted.command("Long-running refactor")
    await interrupted.emit("session.execution.started")
    await interrupted.emit("session.execution.interrupted", { reason: "user" })
    expect(interrupted.latestState()).toMatchObject({
      status: "paused",
      reason: "Interrupted by the user.",
    })

    const failed = new GoalHarness()
    await failed.start()
    await failed.command("Keep going")
    await failed.emit("session.execution.started")
    await failed.emit("session.execution.failed", {
      error: { type: "provider", message: "rate limited" },
    })
    expect(failed.latestState()).toMatchObject({
      status: "paused",
      reason: "Execution failed: rate limited",
    })
  })

  test("stops after the continuation budget and ignores duplicate success events", async () => {
    const app = new GoalHarness({ budgets: { maxContinuations: 1 } })
    await app.start()
    await app.command("Bounded work")
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    await app.emit("session.execution.succeeded")
    expect(app.latestState()).toMatchObject({ continuations: 1, status: "active" })

    await app.emit("session.inbox.enqueued", {
      inboxID: app.lastPromptID,
      item: {
        type: "user",
        payload: { metadata: { [GOAL_SNAPSHOT_KEY]: continuationMetadata() } },
      },
    })
    await app.emit("session.inbox.delivered", { inboxID: app.lastPromptID })
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    const promptCount = app.prompts.length
    await app.emit("session.execution.succeeded")
    await app.emit("session.execution.succeeded")
    expect(app.prompts.length).toBe(promptCount)
    expect(app.latestState()).toMatchObject({ status: "budget-limited" })
  })

  test("cancels a pending continuation when the goal is cleared", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Keep going")
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    await app.emit("session.execution.succeeded")
    expect(app.cancelled).toEqual([])
    await app.command("clear")
    expect(app.cancelled.length).toBe(1)
  })
})

describe("GoalRuntime restore and fork", () => {
  test("rebuilds cache from the latest synthetic snapshot", async () => {
    const app = new GoalHarness()
    await app.start()
    const restored: GoalState = {
      version: GOAL_STATE_VERSION,
      objective: "Restore me",
      status: "paused",
      startedAt: 1,
      elapsedMs: 2_000,
      turns: 3,
      tokens: 4_000,
      continuations: 2,
      tokenBaseline: 10,
    }
    app.messages.push({
      type: "synthetic",
      metadata: { [GOAL_SNAPSHOT_KEY]: { version: GOAL_STATE_VERSION, state: restored } },
    })
    await app.command("check")
    expect(app.synthetics.at(-1)?.text).toContain("Goal: Paused")
    expect(app.synthetics.at(-1)?.text).toContain("Tokens: 4.0k")
  })

  test("copies an inherited snapshot into a forked session when needed", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Parent goal")
    const parentState = app.latestState()
    expect(parentState?.objective).toBe("Parent goal")

    const childID = "ses_child"
    const originalContext = app.ctx.session.context
    app.ctx.session.context = async (input: { sessionID: string }) => {
      if (input.sessionID === childID) return []
      return originalContext(input)
    }
    await app.runtime.handleEvent({
      type: "session.forked",
      data: { sessionID: childID, parentID: SESSION },
    })
    expect(app.synthetics.at(-1)?.text).toBe("Goal started")
    expect(parseGoalSnapshot(app.synthetics.at(-1)?.metadata?.[GOAL_SNAPSHOT_KEY])).toMatchObject({
      objective: "Parent goal",
    })
  })
})

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
  readonly store = new Map<string, unknown>()
  tokens = usage(0)
  contextHook: ContextHook | undefined
  inboxSeq = 0
  lastPromptID = ""

  readonly userInbox = new Set<string>()

  readonly storage = {
    get: async (key: string) => this.store.get(key) as never,
    set: async (key: string, value: unknown) => {
      this.store.set(key, value)
    },
    remove: async (key: string) => {
      this.store.delete(key)
    },
  }

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
    storage: undefined as unknown as GoalHarness["storage"],
  }

  readonly runtime: GoalRuntime

  constructor(options?: { budgets?: { maxContinuations: number } }) {
    this.ctx.storage = this.storage
    this.runtime = new GoalRuntime(this.ctx as unknown as GoalPluginContext, options)
  }

  async start(): Promise<void> {
    await this.runtime.start()
  }

  disableInbox(): void {
    // Simulate the production plugin host, which does not expose
    // session.inbox to plugins, so remote cancel is unavailable.
    const session = this.ctx.session as unknown as { inbox?: unknown }
    session.inbox = undefined
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
    expect(app.prompts.at(-1)?.skills).toBeUndefined()
  })

  test("omits non-array prompt attachments when starting a goal", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.commands.get("goal")?.execute({
      sessionID: SESSION,
      prompt: { text: "Keep going", files: undefined, skills: {} as never },
      delivery: "queue",
    })
    expect(app.prompts.at(-1)).toMatchObject({ text: "Keep going", delivery: "queue" })
    expect("skills" in (app.prompts.at(-1) ?? {})).toBe(false)
    expect("files" in (app.prompts.at(-1) ?? {})).toBe(false)
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

  test("keeps exactly one goal block as the last system entry", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Stay last")
    const event = {
      sessionID: SESSION,
      system: [
        { type: "text", text: "Built-in instructions" },
        { type: "text", text: "## Active Goal\n\nstale block" },
        { type: "text", text: "Another plugin's addition" },
      ] as Array<{ type: string; text: string }>,
      tools: { goal_report: { description: "x" } },
    }
    await app.contextHook?.(event)
    const goalBlocks = event.system.filter((part) => part.text.startsWith("## Active Goal"))
    expect(goalBlocks).toHaveLength(1)
    expect(goalBlocks[0]?.text).toContain("Stay last")
    expect(event.system.at(-1)?.text).toContain("Stay last")
    expect(event.system[0]?.text).toBe("Built-in instructions")
  })

  test("achieved and blocked reports require evidence and stop continuation", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Make tests green")
    const missing = await app.report("achieved", "   ")
    expect(missing?.content).toContain("Evidence is required")

    const idle = new GoalHarness()
    await idle.start()
    const stale = await idle.report("achieved", "done")
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

  test("restores the goal in the context hook after a restart", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Survive restarts")

    // Simulate a server restart: a fresh runtime with empty in-memory caches
    // but the same durable transcript and storage.
    const rebooted = new GoalHarness()
    rebooted.messages.push(...app.messages)
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    const event = {
      sessionID: SESSION,
      system: [] as Array<{ type: string; text: string }>,
      tools: { goal_report: { description: "x" } },
    }
    await rebooted.contextHook?.(event)
    expect(event.system[0]?.text).toContain("Survive restarts")
    expect(event.tools.goal_report).toBeDefined()
  })

  test("falls back to storage when the transcript window has no snapshot", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Stored goal survives compaction")

    // Simulate compaction evicting the snapshot messages from the context window.
    const rebooted = new GoalHarness()
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    await rebooted.command("check")
    expect(rebooted.synthetics.at(-1)?.text).toContain("Objective: Stored goal survives compaction")
  })

  test("a cleared goal stays cleared and never resurrects from storage", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Temporary goal")
    await app.command("clear")
    expect(app.latestState()).toBeNull()

    const rebooted = new GoalHarness()
    rebooted.messages.push(...app.messages)
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    await rebooted.command("check")
    expect(rebooted.synthetics.at(-1)?.text).toContain("No goal is set")
  })

  test("concurrent cold-cache restores share one controller", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Shared restore")

    const rebooted = new GoalHarness()
    rebooted.messages.push(...app.messages)
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    // Race the context hook against a status command on a cold cache.
    const event = {
      sessionID: SESSION,
      system: [] as Array<{ type: string; text: string }>,
      tools: { goal_report: { description: "x" } },
    }
    await Promise.all([rebooted.contextHook?.(event), rebooted.command("check")])
    expect(event.system[0]?.text).toContain("Shared restore")
    expect(rebooted.synthetics.at(-1)?.text).toContain("Objective: Shared restore")
  })

  test("resume works after a restart from the transcript snapshot", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Restarted resume")
    await app.command("pause")

    const rebooted = new GoalHarness()
    rebooted.messages.push(...app.messages)
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    await rebooted.command("resume keep going")
    expect(rebooted.synthetics.at(-1)?.text).toBe("Goal resumed")
    expect(rebooted.prompts.at(-1)?.text).toContain("[GOAL CONTINUATION]")
    expect(rebooted.prompts.at(-1)?.text).toContain("keep going")
  })

  test("resume works after a restart from storage when the transcript is evicted", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Evicted resume")
    await app.command("pause")

    // Simulate restart plus compaction evicting every snapshot message.
    const rebooted = new GoalHarness()
    for (const [key, value] of app.store) rebooted.store.set(key, value)
    await rebooted.start()

    await rebooted.command("resume")
    expect(rebooted.synthetics.at(-1)?.text).toBe("Goal resumed")
    expect(rebooted.prompts.at(-1)?.text).toContain("[GOAL CONTINUATION]")
  })

  test("continuation prompt stays lean and carries user direction", async () => {
    const app = new GoalHarness()
    await app.start()
    await app.command("Ship the lean nudge")
    await app.command("pause")
    await app.command("resume focus on tests")

    const queued = app.prompts.at(-1)
    expect(queued?.text).toContain("[GOAL CONTINUATION]")
    expect(queued?.text).toContain("focus on tests")
    expect(queued?.text).not.toContain("Ship the lean nudge")
  })

  test("resume does not queue a duplicate while a previous continuation is still live", async () => {
    const app = new GoalHarness()
    app.disableInbox()
    await app.start()
    await app.command("Single flight")
    await app.emit("session.execution.started")
    await app.emit("session.tool.called")
    await app.emit("session.execution.succeeded")
    const continuations = () =>
      app.prompts.filter((prompt) => prompt.text.includes("[GOAL CONTINUATION]"))
    expect(continuations()).toHaveLength(1)

    // Remote cancel is unavailable, so the queued continuation is still live
    // server-side. Pause and resume must not queue a second one on top.
    await app.command("pause")
    await app.command("resume")
    expect(continuations()).toHaveLength(1)
    expect(app.synthetics.at(-1)?.text).toBe("Goal resumed")
  })
})

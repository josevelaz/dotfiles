import { describe, expect, test } from "bun:test"
import {
  GoalController,
  GOAL_STATE_VERSION,
  displayElapsedMs,
  formatDuration,
  formatTokenCount,
} from "./controller.ts"
import { parseGoalSnapshot } from "./state.ts"

describe("GoalController", () => {
  test("tracks active time without counting paused time", () => {
    let now = 1_000
    const controller = new GoalController(() => now)
    controller.start("Ship the feature")
    now = 6_000
    expect(controller.elapsedMs()).toBe(5_000)
    expect(controller.pause()).toBe(true)
    now = 20_000
    expect(controller.elapsedMs()).toBe(5_000)
    expect(controller.resume()).toBe(true)
    now = 23_000
    expect(controller.elapsedMs()).toBe(8_000)
  })

  test("records token spend as a non-negative delta from the start baseline", () => {
    const controller = new GoalController(() => 1_000)
    controller.start("Pass all tests", 400)
    controller.recordEvaluation(1_650)
    expect(controller.current).toMatchObject({ turns: 1, tokens: 1_250, tokenBaseline: 400 })
    controller.recordEvaluation(200)
    expect(controller.current?.tokens).toBe(0)
  })

  test("restores valid snapshots and rejects malformed state", () => {
    const controller = new GoalController(() => 10_000)
    controller.start("Pass all tests", 0)
    controller.recordEvaluation(1_250)
    const snapshot = controller.serialize()
    expect(parseGoalSnapshot(snapshot)?.tokens).toBe(1_250)

    const restored = new GoalController(() => 10_000)
    restored.restore(parseGoalSnapshot(snapshot) ?? null)
    expect(restored.current).toMatchObject({ objective: "Pass all tests", tokens: 1_250 })

    expect(parseGoalSnapshot({ version: 99, state: null })).toBeUndefined()
    expect(
      parseGoalSnapshot({
        version: GOAL_STATE_VERSION,
        state: { objective: "" },
      }),
    ).toBeUndefined()
  })

  test("enforces only the continuation limit", () => {
    const controller = new GoalController(Date.now, { maxContinuations: 1 })
    controller.start("Bounded work")
    controller.recordEvaluation(2_000_000)
    expect(controller.budgetReason()).toBeUndefined()

    controller.recordContinuation()
    expect(controller.budgetReason()).toContain("continuation budget")
  })

  test("formats status metrics compactly at boundary values", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(999)).toBe("0s")
    expect(formatDuration(1_000)).toBe("1s")
    expect(formatDuration(65_000)).toBe("1m 5s")
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(3_900_000)).toBe("1h 5m")
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(999)).toBe("999")
    expect(formatTokenCount(1_000)).toBe("1.0k")
    expect(formatTokenCount(1_250)).toBe("1.3k")
    expect(formatTokenCount(25_000)).toBe("25k")
    expect(formatTokenCount(1_000_000)).toBe("1.0m")
    expect(formatTokenCount(12_000_000)).toBe("12m")
  })

  test("keeps display elapsed time aligned with persisted activeSince", () => {
    const snapshot = {
      version: GOAL_STATE_VERSION,
      objective: "Keep time",
      status: "active" as const,
      startedAt: 1_000,
      elapsedMs: 4_000,
      activeSince: 5_000,
      turns: 1,
      tokens: 10,
      continuations: 0,
      tokenBaseline: 0,
    }
    expect(displayElapsedMs(snapshot, 8_000)).toBe(7_000)
    expect(displayElapsedMs({ ...snapshot, status: "paused", activeSince: undefined }, 8_000)).toBe(4_000)
  })
})

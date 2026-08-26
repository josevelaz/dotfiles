import { describe, expect, test } from "bun:test"
import {
  GOAL_SNAPSHOT_KEY,
  GOAL_STATE_VERSION,
  continuationMetadata,
  isGoalContinuation,
  isUserInboxItem,
  latestGoalSnapshot,
  parseGoalSnapshot,
  snapshotFromMessage,
  snapshotMetadata,
  totalTokens,
  type GoalState,
} from "./state.ts"

function state(overrides: Partial<GoalState> = {}): GoalState {
  return {
    version: GOAL_STATE_VERSION,
    objective: "Ship the feature",
    status: "active",
    startedAt: 1_000,
    elapsedMs: 2_000,
    activeSince: 3_000,
    turns: 4,
    tokens: 5_000,
    continuations: 1,
    tokenBaseline: 100,
    ...overrides,
  }
}

describe("parseGoalSnapshot", () => {
  test("accepts a valid snapshot and a cleared snapshot", () => {
    expect(parseGoalSnapshot(snapshotMetadata(state()))).toMatchObject({
      objective: "Ship the feature",
      tokens: 5_000,
      tokenBaseline: 100,
    })
    expect(parseGoalSnapshot(snapshotMetadata(null))).toBeNull()
  })

  test("rejects malformed and future-version data", () => {
    expect(parseGoalSnapshot(null)).toBeUndefined()
    expect(parseGoalSnapshot({ version: 99, state: null })).toBeUndefined()
    expect(parseGoalSnapshot({ version: GOAL_STATE_VERSION, state: { objective: "" } })).toBeUndefined()
    expect(
      parseGoalSnapshot({
        version: GOAL_STATE_VERSION,
        state: { ...state(), status: "pursuing" },
      }),
    ).toBeUndefined()
    expect(
      parseGoalSnapshot({
        version: GOAL_STATE_VERSION,
        state: { ...state(), tokenBaseline: -1 },
      }),
    ).toBeUndefined()
    expect(parseGoalSnapshot(continuationMetadata())).toBeUndefined()
  })
})

describe("latestGoalSnapshot", () => {
  test("selects the latest valid synthetic snapshot", () => {
    const messages = [
      {
        type: "synthetic",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state({ status: "active" })) },
      },
      {
        type: "user",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state({ status: "paused" })) },
      },
      {
        type: "synthetic",
        metadata: { [GOAL_SNAPSHOT_KEY]: { version: 99, state: null } },
      },
      {
        type: "synthetic",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state({ status: "achieved" })) },
      },
    ]
    expect(latestGoalSnapshot(messages)).toMatchObject({ status: "achieved" })
  })

  test("treats a cleared snapshot as the current state", () => {
    const messages = [
      {
        type: "synthetic",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state()) },
      },
      {
        type: "synthetic",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(null) },
      },
    ]
    expect(latestGoalSnapshot(messages)).toBeNull()
  })

  test("ignores malformed snapshots in a forked history", () => {
    const inherited = {
      type: "synthetic",
      metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state({ objective: "Parent goal" })) },
    }
    const malformed = {
      type: "synthetic",
      metadata: { [GOAL_SNAPSHOT_KEY]: { version: GOAL_STATE_VERSION, state: { objective: "" } } },
    }
    const child = {
      type: "synthetic",
      metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state({ objective: "Child goal", status: "paused" })) },
    }
    expect(latestGoalSnapshot([inherited, malformed, child])).toMatchObject({
      objective: "Child goal",
      status: "paused",
    })
  })

  test("reads snapshot metadata only from synthetic messages", () => {
    expect(
      snapshotFromMessage({
        type: "user",
        metadata: { [GOAL_SNAPSHOT_KEY]: snapshotMetadata(state()) },
      }),
    ).toBeUndefined()
  })
})

describe("continuation and inbox helpers", () => {
  test("identifies continuation metadata and user inbox items", () => {
    expect(isGoalContinuation(continuationMetadata())).toBe(true)
    expect(isGoalContinuation(snapshotMetadata(state()))).toBe(false)
    expect(isUserInboxItem({ type: "user", payload: { metadata: {} } })).toBe(true)
    expect(
      isUserInboxItem({
        type: "user",
        payload: { metadata: { [GOAL_SNAPSHOT_KEY]: continuationMetadata() } },
      }),
    ).toBe(false)
    expect(isUserInboxItem({ type: "synthetic", payload: { metadata: {} } })).toBe(false)
  })
})

describe("totalTokens", () => {
  test("sums aggregate usage fields", () => {
    expect(
      totalTokens({
        input: 10,
        output: 20,
        reasoning: 5,
        cache: { read: 3, write: 2 },
      }),
    ).toBe(40)
    expect(totalTokens(undefined)).toBe(0)
  })
})

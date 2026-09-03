import { describe, expect, test } from "bun:test"
import {
  cacheHitPercentage,
  formatCacheHitPercentage,
  formatCost,
  formatTimestamp,
  warmingLogFilename,
  warmingLogEvent,
} from "./metrics"

describe("session metrics", () => {
  test("calculates the whole-session prompt cache percentage", () => {
    const tokens = { input: 100, cache: { read: 300, write: 100 } }

    expect(cacheHitPercentage(tokens)).toBe(60)
    expect(formatCacheHitPercentage(tokens)).toBe("60.0%")
  })

  test("handles an empty session", () => {
    expect(formatCacheHitPercentage({ input: 0, cache: { read: 0, write: 0 } })).toBe("0.0%")
  })

  test("formats costs", () => {
    expect(formatCost(0)).toBe("$0.0000")
    expect(formatCost(0.004321)).toBe("$0.0043")
    expect(formatCost(1.234)).toBe("$1.23")
  })

  test("extracts only warming-session log entries", () => {
    expect(
      warmingLogEvent(
        'timestamp=2026-08-31T16:13:46.461Z message="warming session" sessionID=ses_example last=123 role=server',
      ),
    ).toEqual({ sessionID: "ses_example", sentAt: new Date("2026-08-31T16:13:46.461Z") })
    expect(
      warmingLogEvent(
        'timestamp=now message="scheduled session warming" sessionID=ses_example role=server',
      ),
    ).toBeUndefined()
  })

  test("formats warming timestamps and channel-aware log names", () => {
    expect(formatTimestamp(new Date(2026, 7, 31, 6, 7, 8))).toBe("06:07:08")
    expect(warmingLogFilename("beta")).toBe("opencode.log")
    expect(warmingLogFilename("local")).toBe("opencode-local.log")
  })
})

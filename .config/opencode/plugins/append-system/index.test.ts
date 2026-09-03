import { describe, expect, test } from "bun:test"

import { appendSystemPrompt } from "./index"

describe("appendSystemPrompt", () => {
  test("appends non-empty text without changing it", () => {
    const system = [{ type: "text" as const, text: "base" }]

    appendSystemPrompt(system, "extra instructions\n")

    expect(system).toEqual([
      { type: "text", text: "base" },
      { type: "text", text: "extra instructions\n" },
    ])
  })

  test("does not append whitespace-only text", () => {
    const system = [{ type: "text" as const, text: "base" }]

    appendSystemPrompt(system, " \n")

    expect(system).toEqual([{ type: "text", text: "base" }])
  })
})

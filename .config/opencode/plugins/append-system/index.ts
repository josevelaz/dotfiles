import { readFile } from "node:fs/promises"

import { Plugin } from "@opencode/plugin"

const promptPath = new URL("../../APPEND_SYSTEM.md", import.meta.url)
const buildPromptPath = new URL("../../APPEND_BUILD.md", import.meta.url)
const claudeAgentInstructionsKey = "claudeCodeInstructions"

export function appendSystemPrompt(
  system: Array<{ type: "text"; text: string }>,
  text: string,
): void {
  if (text.trim().length === 0) return
  system.push({ type: "text", text })
}

function appendClaudeAgentInstructions(options: Record<string, unknown>, texts: Array<string>): void {
  const current = options[claudeAgentInstructionsKey]
  if (typeof current !== "string") return
  const additions = texts.filter((text) => text.trim().length > 0 && !current.includes(text))
  if (additions.length === 0) return
  options[claudeAgentInstructionsKey] = [current, ...additions].filter((text) => text.length > 0).join("\n")
}

async function readOptional(path: URL): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw error
  }
}

export default Plugin.define({
  id: "local.append-system",
  async setup(ctx) {
    await ctx.session.hook("context", async (event) => {
      const texts = [await readFile(promptPath, "utf8")]
      if (event.agent === "build") texts.push(await readOptional(buildPromptPath))
      for (const text of texts) appendSystemPrompt(event.system, text)
      appendClaudeAgentInstructions(event.options, texts)
    })
  },
})

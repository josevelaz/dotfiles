import { readFile } from "node:fs/promises"

import { Plugin } from "@opencode-ai/plugin"

const promptPath = new URL("../../APPEND_SYSTEM.md", import.meta.url)
const buildPromptPath = new URL("../../APPEND_BUILD.md", import.meta.url)

export function appendSystemPrompt(
  system: Array<{ type: "text"; text: string }>,
  text: string,
): void {
  if (text.trim().length === 0) return
  system.push({ type: "text", text })
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
      appendSystemPrompt(event.system, await readFile(promptPath, "utf8"))
      if (event.agent === "build") {
        appendSystemPrompt(event.system, await readOptional(buildPromptPath))
      }
    })
  },
})

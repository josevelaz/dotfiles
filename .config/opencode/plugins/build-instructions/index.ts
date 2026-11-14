import { readFile } from "node:fs/promises"

import { Plugin } from "@opencode/plugin"

const RULES_PATH = new URL("../../BUILD.md", import.meta.url)
const RULES_AGENT = "build"
const DEFAULT_AGENT = "build"
const ENTRY_KEY = "build-instructions"

async function readRules(): Promise<string> {
  try {
    return (await readFile(RULES_PATH, "utf8")).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw error
  }
}

export default Plugin.define({
  id: "local.build-instructions",
  async setup(ctx) {
    const entries = ctx.session.instructions.entry

    const sync = async (sessionID: string, agent: string): Promise<void> => {
      const rules = agent === RULES_AGENT ? await readRules() : ""
      const current = (await entries.list({ sessionID })).find((entry) => entry.key === ENTRY_KEY)
      if (rules) {
        if (current?.value !== rules) await entries.put({ sessionID, key: ENTRY_KEY, value: rules })
        return
      }
      if (current) await entries.remove({ sessionID, key: ENTRY_KEY })
    }

    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      await sync(event.sessionID, session.agent ?? DEFAULT_AGENT)
    })

    await ctx.session.hook("context", (event) => sync(event.sessionID, event.agent))
  },
})

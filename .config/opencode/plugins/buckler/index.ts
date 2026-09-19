import { Plugin } from "@opencode/plugin"
import { gateBucklerState } from "./gate"
import { loadBucklerState } from "./loader"

export default Plugin.define({
  id: "buckler",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", async (event) => {
      if (ctx.options.enabled === false) return
      if (event.tool !== "write" && event.tool !== "edit") return
      const state = await loadBucklerState({
        sessionDirectory: ctx.location.directory,
        projectCanonical: ctx.location.project.canonical,
        guideOption: ctx.options.guide,
        tool: event.tool,
        input: event.input,
      })
      if (!state) return
      await gateBucklerState(state)
    })
  },
})

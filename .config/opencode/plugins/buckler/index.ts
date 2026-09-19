import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "buckler",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", async (event) => {
      if (ctx.options.enabled === false) return
      if (event.tool !== "write" && event.tool !== "edit") return
    })
  },
})

import { Plugin } from "@opencode-ai/plugin";

export default Plugin.define({
  id: "local.codex-identity",
  setup: async (ctx) => {
    await ctx.session.hook("model.request", (request) => {
      request.headers.originator = "codex_cli_rs";
      request.headers["User-Agent"] = "codex_cli_rs/0.0.0 (OpenCode)";
    }, { providerID: "openai" });
  },
});

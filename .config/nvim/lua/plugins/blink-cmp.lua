return {
  {
    "saghen/blink.cmp",
    lazy = false,
    build = 'cargo build --release',
    version = "1.*",
    ---@module 'blink.cmp'
    ---@type blink.cmp.Config
    opts = {
      sources = {
        default = { "path", "buffer" },
      },
      keymap = {
        preset = "enter",

        ["<C-u>"] = { "scroll_documentation_up", "fallback" },
        ["<C-d>"] = { "scroll_documentation_down", "fallback" },
      },

      signature = { enabled = false },
      completion = {
        list = {
          selection = { preselect = false, auto_insert = false },
        },
        accept = {
          auto_brackets = { enabled = true },
        },
        documentation = {
          auto_show = true,
          window = { border = "solid" },
        },
        menu = {
          border = "solid",
          draw = {
            columns = { { "kind_icon" }, { "label", "label_description", gap = 1 }, { "kind" } },
            components = {
              kind_icon = {
                ellipsis = false,
                text = function(ctx)
                  local kind_icon, _, _ = require("mini.icons").get("lsp", ctx.kind)
                  return kind_icon
                end,
              },
            },
          },
        },
      },
    },
  },
}

return {
	{ "rafamadriz/friendly-snippets" },
	{
		"saghen/blink.cmp",
		lazy = false,
		version = "1.*",
		---@module 'blink.cmp'
		---@type blink.cmp.Config
		opts = {
			sources = {
				default = { "lsp", "snippets", "path", "buffer" },
				per_filetype = { lua = { "lazydev" } },
				providers = {
					-- dont show LuaLS require statements when lazydev has items
					lazydev = { name = "LazyDev", module = "lazydev.integrations.blink", fallbacks = { "lsp" } },
					snippets = { opts = { extended_filetypes = { typescript = { "javascript" } } } },
				},
			},
			keymap = {
				preset = "enter",

				["<C-l>"] = { "snippet_forward" },
				["<C-h>"] = { "snippet_backward" },

				["<C-u>"] = { "scroll_documentation_up", "fallback" },
				["<C-d>"] = { "scroll_documentation_down", "fallback" },
			},

			signature = { enabled = true },
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

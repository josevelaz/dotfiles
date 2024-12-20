return {
	"saghen/blink.cmp",
	lazy = false,
	dependencies = {
		{
			"L3MON4D3/LuaSnip",
			version = "v2.*",
			dependencies = {
				"rafamadriz/friendly-snippets",
				config = function()
					require("luasnip.loaders.from_vscode").lazy_load()
				end,
			},
		},
	},
	version = "v0.*",
	---@module 'blink.cmp'
	---@type blink.cmp.Config
	opts = {
		snippets = {
			expand = function(snippet)
				require("luasnip").lsp_expand(snippet)
			end,
			active = function(filter)
				if filter and filter.direction then
					return require("luasnip").jumpable(filter.direction)
				end
				return require("luasnip").in_snippet()
			end,
			jump = function(direction)
				require("luasnip").jump(direction)
			end,
		},
		sources = {
			completion = {
				enabled_providers = { "lsp", "path", "luasnip", "buffer", "lazydev" },
			},
			providers = {
				-- dont show LuaLS require statements when lazydev has items
				lsp = { score_offset = 3, fallback_for = { "lazydev" } },
				lazydev = { name = "LazyDev", module = "lazydev.integrations.blink" },
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
				selection = "manual",
			},
			accept = {
				auto_brackets = { enabled = true },
			},
			documentation = {
				auto_show = true,
			},
			menu = {
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
}

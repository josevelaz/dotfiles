return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 999,
		init = function()
			vim.cmd.colorscheme("catppuccin-mocha")
		end,
		opts = {
			custom_highlights = function(colors)
				return {
					LineNr = { fg = colors.blue },
					CursorLineNr = { fg = colors.green },

					DiagnosticUnderlineError = { undercurl = true, sp = colors.red }, -- Used to underline "Error" diagnostics
					DiagnosticUnderlineWarn = { undercurl = true, sp = colors.yellow }, -- Used to underline "Warning" diagnostics
					DiagnosticUnderlineInfo = { undercurl = true, sp = colors.teal }, -- Used to underline "Information" diagnostics
					DiagnosticUnderlineHint = { undercurl = true, sp = colors.hint }, -- Used to underline "Hint" diagnostics

					SpellBad = { sp = colors.red, undercurl = true },
					SpellCap = { sp = colors.yellow, undercurl = true },
					SpellLocal = { sp = colors.teal, undercurl = true },
					SpellRare = { sp = colors.hint, undercurl = true },
				}
			end,
			transparent_background = true,
			integrations = {
				cmp = true,
				gitsigns = true,
				fidget = true,
				treesitter = true,
				harpoon = true,
				indent_blankline = {
					enabled = true,
				},
				mason = true,
			},
		},
	},
}

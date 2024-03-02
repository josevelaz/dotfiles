return {
	{
		"zaldih/themery.nvim",
		opts = {
			themes = { "tokyonight-night", "catppuccin-mocha" },
			themeConfigFile = "~/.config/nvim/lua/plugins/theming.lua",
		},
		init = function()
			-- Themery block
			-- This block will be replaced by Themery.
			vim.cmd("colorscheme catppuccin-mocha")
			vim.g.theme_id = 2
			-- end themery block
		end,
	},
	{ "folke/tokyonight.nvim", priority = 1000 },
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		opts = {
			custom_highlights = function(colors)
				return {
					LineNr = { fg = colors.blue },
				}
			end,
			integrations = {
				cmp = true,
				gitsigns = true,
				fidget = true,
				treesitter = true,
				harpoon = true,
				indent_blankline = {
					enabled = true,
					scope_color = "lavender",
				},
				mason = true,
			},
		},
	},
}

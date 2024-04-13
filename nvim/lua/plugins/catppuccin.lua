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

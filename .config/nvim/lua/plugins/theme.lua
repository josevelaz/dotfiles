return {
	"rose-pine/neovim",
	name = "rose-pine",
	opts = {
		dim_inactive_windows = true,
	},
	config = function()
		vim.cmd("colorscheme rose-pine")
	end,

	-- "scottmckendry/cyberdream.nvim",
	-- lazy = false,
	-- priority = 1000,
	-- init = function()
	-- 	vim.cmd("colorscheme cyberdream")
	-- end,
	-- opts = {
	-- 	variant = "dark",
	-- 	italic_comments = true,
	-- 	cache = true,
	-- },

	-- {
	-- 	"folke/tokyonight.nvim",
	-- 	lazy = false,
	-- 	priority = 1000,
	-- 	opts = {
	-- 		on_highlights = function(hl, colors)
	-- 			hl.DapBreakpointHl = { fg = colors.red }
	-- 			hl.DapBreakpointLogHl = { fg = colors.red }
	-- 			hl.DapBreakpointConditionHl = { fg = colors.red }
	-- 			hl.DapBreakpointRejectedHl = { fg = colors.red }
	-- 			hl.DapStoppedHl = { fg = colors.yellow }
	-- 		end,
	-- 	},
	-- 	-- init = function()
	-- 	-- 	vim.cmd([[colorscheme tokyonight-night]])
	-- 	-- end,
	-- },
}

return {

	"scottmckendry/cyberdream.nvim",
	lazy = false,
	priority = 1000,
	init = function()
		vim.cmd("colorscheme cyberdream")
	end,
	opts = {
		variant = "dark",
		italic_comments = true,
		cache = true,
	},

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

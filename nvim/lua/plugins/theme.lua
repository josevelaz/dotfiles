return {
	-- "scottmckendry/cyberdream.nvim",
	-- lazy = false,
	-- priority = 1000,
	-- init = function ()
	--   vim.cmd("colorscheme cyberdream")
	-- end,
	-- opts = {
	-- 	borderless_telescope = false,
	--    italic_comments = true,
	--    cache = true
	-- },
	"folke/tokyonight.nvim",
	lazy = false,
	priority = 1000,
	opts = {},
	init = function()
		vim.cmd([[colorscheme tokyonight-night]])
	end,
}

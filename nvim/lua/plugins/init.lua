return {
	"christoomey/vim-tmux-navigator",

	"cohama/lexima.vim",

	{
		"andythigpen/nvim-coverage",
		dependencies = "nvim-lua/plenary.nvim",
		-- Optional: needed for PHP when using the cobertura parser
		rocks = { "lua-xmlreader" },
	},
	-- Lua
	"folke/neodev.nvim",
	"m4xshen/autoclose.nvim",
	"nvim-tree/nvim-web-devicons",
	{
		"glepnir/nerdicons.nvim",
		cmd = "NerdIcons",
		config = function()
			require("nerdicons").setup({})
		end,
	},
	{
		"mbbill/undotree",
		lazy = true,
		init = function()
			vim.keymap.set("n", "<leader>u", vim.cmd.UndotreeToggle)
		end,
	},
	"RRethy/vim-illuminate",
	{
		"FeiyouG/commander.nvim",
		lazy = true,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
}

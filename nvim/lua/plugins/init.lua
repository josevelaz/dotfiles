return {
	"christoomey/vim-tmux-navigator",

	"cohama/lexima.vim",

	{
		"folke/trouble.nvim",
		dependencies = "nvim-tree/nvim-web-devicons",
	},

	{
		"andythigpen/nvim-coverage",
		dependencies = "nvim-lua/plenary.nvim",
		-- Optional: needed for PHP when using the cobertura parser
		rocks = { "lua-xmlreader" },
	},
	-- Lua
	"folke/neodev.nvim",
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		init = function()
			vim.o.timeout = true
			vim.o.timeoutlen = 300
		end,
	},
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
		"FeiyouG/command_center.nvim",
		lazy = true,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
}

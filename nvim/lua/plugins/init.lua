return {
	--	{
	--		"braxtons12/blame_line.nvim",
	--		opts = {
	--			prefix = "\t ",
	--			delay = 200,
	--		},
	--	},
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
		opts = {
			-- your configuration comes here
			-- or leave it empty to use the default settings
			-- refer to the configuration section below
		},
	},
	"m4xshen/autoclose.nvim",
	"nvim-tree/nvim-web-devicons",
	"Exafunction/codeium.vim",
	"weilbith/nvim-code-action-menu",

	{
		"folke/tokyonight.nvim",
		lazy = false,
		priority = 1000,
		opts = {},
		config = function()
			vim.cmd([[colorscheme tokyonight-night]])
		end,
	},
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
		config = function()
			vim.keymap.set("n", "<leader>u", vim.cmd.UndotreeToggle)
		end,
	},
	"ray-x/go.nvim",
	"RRethy/vim-illuminate",
	{
		"FeiyouG/command_center.nvim",
		lazy = true,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
	{ "Pocco81/auto-save.nvim", opts = { trigger_events = { "InsertLeave", "TextChanged" } } },
}

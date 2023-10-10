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
		"nvim-telescope/telescope.nvim",
		tag = "0.1.1",
		-- or                            , branch = "0.1.x",
		dependencies = { { "nvim-lua/plenary.nvim" } },
	},

	"tpope/vim-fugitive",
	{
		"oxfist/night-owl.nvim",
		lazy = false, -- make sure we load this during startup if it is your main colorscheme
		priority = 1000, -- make sure to load this before all the other start plugins
		config = function()
			-- load the colorscheme here
			vim.cmd.colorscheme("night-owl")
		end,
	},
	{
		"glepnir/nerdicons.nvim",
		cmd = "NerdIcons",
		config = function()
			require("nerdicons").setup({})
		end,
	},
	"theprimeagen/harpoon",
	{
		"mbbill/undotree",
		lazy = true,
	},
	"ray-x/go.nvim",
	{
		"VonHeikemen/lsp-zero.nvim",
		branch = "v2.x",
		dependencies = {
			-- LSP Support
			{ "neovim/nvim-lspconfig" }, -- Required
			{
				-- Optional
				"williamboman/mason.nvim",
				run = function()
					pcall(vim.cmd, "MasonUpdate")
				end,
			},
			{ "williamboman/mason-lspconfig.nvim" }, -- Optional

			-- Autocompletion
			{ "hrsh7th/nvim-cmp" }, -- Required
			{ "hrsh7th/cmp-nvim-lsp" }, -- Required
			{ "L3MON4D3/LuaSnip" }, -- Required
		},
	},
	"RRethy/vim-illuminate",
	{
		"FeiyouG/command_center.nvim",
		lazy = true,
		dependencies = { "nvim-telescope/telescope.nvim" },
	},
	{ "Pocco81/auto-save.nvim", opts = { trigger_events = { "InsertLeave", "TextChanged" } } },
}

return {
	{
		"nvim-treesitter/nvim-treesitter-context",
		opts = {
			multiline_threshold = 2,
		},
	},
	{
		"windwp/nvim-ts-autotag",
		lazy = true,
		opts = {
			filetypes = {
				"html",
				"tsx",
				"jsx",
				"vue",
				"svelte",
				"typescriptreact",
				"javascriptreact",
			},
		},
	},
	{
		"nvim-treesitter/nvim-treesitter",
		lazy = false,
		build = ":TSUpdate",
		version = false,
		config = function(_, opts)
			require("nvim-treesitter.configs").setup(opts)
		end,
		opts = {
			-- A list of parser names, or "all" (the five listed parsers should always be installed)
			ensure_installed = {
				"typescript",
				"javascript",
				"svelte",
				"tsx",
				"yaml",
				"sql",
				"json",
				"css",
				"lua",
				"vim",
				"vimdoc",
				"query",
				"markdown",
				"markdown_inline",
			},

			autotag = {
				enable = true,
			},
			-- Install parsers synchronously (only applied to `ensure_installed`)
			sync_install = false,

			-- Automatically install missing parsers when entering buffer
			-- Recommendation: set to false if you don't have `tree-sitter` CLI installed locally
			auto_install = true,
			-- List of parsers to ignore installing (for "all")
			highlight = {
				enable = true,
				additional_vim_regex_highlighting = { "markdown" },
			},
			incremental_selection = {
				enable = true,
				keymaps = {
					init_selection = "<CR>",
					node_incremental = "<CR>",
					node_decremental = "<BS>",
				},
			},
		},
	},
}

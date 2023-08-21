return {
	{
		"stevearc/oil.nvim",
		opts = {
			keymaps = {
				["<Esc>"] = "actions.parent",
			},
		},
		-- Optional dependencies
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

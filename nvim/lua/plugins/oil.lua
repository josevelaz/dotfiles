return {
	{
		"stevearc/oil.nvim",
		opts = {
			keymaps = {
				["<Esc>"] = "actions.parent",
			},
			view_options = {
				show_hidden = true,
			},
		},
		-- Optional dependencies
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

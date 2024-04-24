return {
	{
		"stevearc/oil.nvim",
		init = function()
			vim.keymap.set("n", "<leader>M", function()
				local Oil = require("oil")
				local filename = Oil.get_cursor_entry().name
				local directory = Oil.get_current_dir()

				local Grapple = require("grapple")
				local Path = require("grapple.path")
				Grapple.toggle({ path = Path.join(directory, filename) })
			end, { desc = "Grapple tag under cursor" })
		end,
		opts = {
			keymaps = {
				["<Esc>"] = "actions.parent",
				["<C-r>"] = "actions.refresh",
				["<C-v>"] = "actions.select_vsplit",
				["<C-s>"] = "actions.select_split",
			},
			view_options = {
				show_hidden = true,
			},
		},
		-- Optional dependencies
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

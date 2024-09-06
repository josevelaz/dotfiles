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


      vim.keymap.set("n", "<leader>pv", "<cmd>Oil<cr>")
		end,
		opts = {
			keymaps = {
				["g?"] = "actions.show_help",
				["<CR>"] = "actions.select",
				["<Esc>"] = "actions.parent",
				["<C-r>"] = "actions.refresh",
				["<C-v>"] = "actions.select_vsplit",
				["<C-s>"] = "actions.select_split",
				["<C-t>"] = { "actions.select", opts = { tab = true }, desc = "Open the entry in new tab" },
				["-"] = "actions.parent",
				["_"] = "actions.open_cwd",
				["`"] = "actions.cd",
				["~"] = { "actions.cd", opts = { scope = "tab" }, desc = ":tcd to the current oil directory" },
				["gs"] = "actions.change_sort",
				["gx"] = "actions.open_external",
				["g."] = "actions.toggle_hidden",
				["g\\"] = "actions.toggle_trash",
			},
			use_default_keymaps = false,
			view_options = {
				show_hidden = true,
			},
		},
		-- Optional dependencies
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

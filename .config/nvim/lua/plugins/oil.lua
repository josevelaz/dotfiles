return {
	{
		"stevearc/oil.nvim",
		lazy = false,
		keys = {
			{ "<leader>pv", "<cmd>Oil<cr>", desc = "Open Oil file explorer" },
		},
		init = function()
			-- Disable netrw - oil.nvim will handle directory browsing
			vim.g.loaded_netrw = 1
			vim.g.loaded_netrwPlugin = 1
		end,
		opts = {
			keymaps = {
				["<leader>M"] = {
					callback = function()
						local Oil = require("oil")
						local entry = Oil.get_cursor_entry()
						if not entry then
							vim.notify("No file under cursor", vim.log.levels.WARN)
							return
						end
						local filename = entry.name
						local directory = Oil.get_current_dir()
						local Grapple = require("grapple")
						local Path = require("grapple.path")
						Grapple.toggle({ path = Path.join(directory, filename) })
					end,
					desc = "Grapple tag under cursor",
				},
				["g?"] = "actions.show_help",
				["<CR>"] = "actions.select",
				["<Esc>"] = { "actions.parent", mode = "n" },
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
			lsp_file_methods = {
				auto_save_changes = true,
			},
		},
		-- Optional dependencies
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

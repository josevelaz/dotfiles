return {
	{
		"nvim-lualine/lualine.nvim",
		opts = {
			options = {
				theme = "auto",
				section_separators = { left = "", right = "" },
				component_separators = "",
			},
			sections = {
				lualine_a = { "mode" },
				lualine_b = { { "branch", icon = "" }, "diff", "diagnostics" },
				lualine_c = {
					{
						"filename",
						file_status = true,
						newfile_status = false,
						path = 1,
						symbols = {
							modified = "●", -- Text to show when the file is modified.
							readonly = "[-]", -- Text to show when the file is non-modifiable or readonly.
							unnamed = "[No Name]", -- Text to show for unnamed buffers.
							newfile = "", -- Text to show for newly created file before first write
						},
					},
					{ "grapple" },
				},
				lualine_x = {
					{
						function()
							local msg = "No Active Lsp"
							local buf_ft = vim.api.nvim_buf_get_option(0, "filetype")
							local clients = vim.lsp.get_active_clients()
							local client_list = {}

							if next(clients) == nil then
								return msg
							end

							for _, client in ipairs(clients) do
								local filetypes = client.config.filetypes
								if filetypes and vim.fn.index(filetypes, buf_ft) ~= -1 then
									table.insert(client_list, client.name)
								end
							end

							if #client_list == 0 then
								return msg
							else
								return "[" .. table.concat(client_list, " |  ") .. "]" -- Join client names with a comma and space
							end
						end,
						icon = " ",
					},
				},
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
		},
		dependencies = { "nvim-tree/nvim-web-devicons", opt = true },
	},
}

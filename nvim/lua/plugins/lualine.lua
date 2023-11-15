return {
	{
		"nvim-lualine/lualine.nvim",
		opts = {
			options = {
				theme = "tokyonight",
				section_separators = "",
				component_separators = "",
			},
			sections = {
				lualine_a = { "mode" },
				lualine_b = { { "branch", icon = "" }, "diff", "diagnostics" },
				lualine_c = {},
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
			winbar = {
				lualine_a = {},
				lualine_b = {},
				lualine_c = {
					{
						"filename",
						path = 1,
						fmt = function(str)
							return str:gsub("/", " 󰅂 ")
						end,
					},
					{
						"filetype",
						icon_only = true,
					},
					{
						"navic",
						separator = { left = "󰅂" },
						navic_opts = {
							seperator = " 󰅂 ",
						},
					},
				},
				lualine_x = {},
				lualine_y = {},
				lualine_z = {},
			},
		},
		dependencies = { "nvim-tree/nvim-web-devicons", opt = true },
	},
}

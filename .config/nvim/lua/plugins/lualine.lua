return {
	{
		"nvim-lualine/lualine.nvim",
		opts = {
			options = {
				theme = "auto",
				section_separators = "",
				component_separators = "",
			},
			sections = {
				lualine_a = { "mode" },
				lualine_b = { { "branch", icon = "" }, "diff" },
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
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
		},
		dependencies = { "nvim-tree/nvim-web-devicons" },
	},
}

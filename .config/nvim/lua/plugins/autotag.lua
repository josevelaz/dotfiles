return {
	"windwp/nvim-ts-autotag",
	opts = {
		opts = {
			enable_close_on_slash = true, -- Auto close on trailing </
		},
		per_filetype = {
			["typescriptreact"] = {
				enable_rename = false,
			},
		},
	},
}

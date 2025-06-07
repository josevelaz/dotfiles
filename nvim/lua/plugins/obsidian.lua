return {
	"obsidian-nvim/obsidian.nvim",
	version = "*", -- recommended, use latest release instead of latest commit
	lazy = true,
	cmd = { "Obsidian" },
	dependencies = {
		-- Required.
		"nvim-lua/plenary.nvim",

		-- see below for full list of optional dependencies 👇
	},
	opts = {
		workspaces = {
			{
				name = "notes",
				path = "~/obsidian_vaults/notes",
			},
		},
		picker = {
			name = "snacks.pick",
		},
		completion = {
			nvim_cmp = false, -- disable!
			blink = true,
		},
		open_app_foreground = true,

		follow_url_func = function(url)
			vim.fn.jobstart({ "open", url })
		end,

		follow_img_func = function(img)
			vim.fn.jobstart({ "qlmanage", "-p", img })
		end,
	},
}

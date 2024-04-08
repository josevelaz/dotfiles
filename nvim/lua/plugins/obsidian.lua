return {
	"epwalsh/obsidian.nvim",
	version = "*", -- recommended, use latest release instead of latest commit
  lazy = true,
	cmd = { "ObsidianOpen", "ObsidianNew" },
	dependencies = {
		-- Required.
		"nvim-lua/plenary.nvim",

		-- see below for full list of optional dependencies 👇
	},
	opts = {
		workspaces = {
			{
				name = "work",
				path = "~/work/itemize/itemize-notes",
			},
		},

		-- see below for full list of options 👇
	},
}

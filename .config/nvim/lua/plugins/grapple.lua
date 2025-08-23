return {
	{
		"cbochs/grapple.nvim",
		opts = {
			scope = "git_branch", -- also try out "git_branch"
		},
		keys = {
			{ "<leader>a", "<cmd>Grapple toggle<cr>", desc = "Tag a file" },
			{ "<c-e>", "<cmd>Grapple toggle_tags<cr>", desc = "Toggle tags menu" },

			{ "<c-s-p>", "<cmd>Grapple cycle backward<cr>", desc = "Go to previous tag" },
			{ "<c-s-n>", "<cmd>Grapple cycle forward<cr>", desc = "Go to next tag" },
		},
	},
}

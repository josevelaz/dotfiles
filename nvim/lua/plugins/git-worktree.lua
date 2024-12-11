return {
	"ThePrimeagen/git-worktree.nvim",
	opts = {},
	init = function()
		vim.keymap.set(
			"n",
			"<leader>st",
			require("telescope").extensions.git_worktree.git_worktrees,
			{ desc = "[S]earch Work[t]ree" }
		)
		vim.keymap.set(
			"n",
			"<leader>ct",
			require("telescope").extensions.git_worktree.create_git_worktree,
			{ desc = "[S]earch Work[t]ree" }
		)
	end,
}

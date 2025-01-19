return {
	"polarmutex/git-worktree.nvim",
	version = "^2",
	dependencies = { "nvim-lua/plenary.nvim" },
	init = function()
		local Hooks = require("git-worktree.hooks")
		local config = require("git-worktree.config")
		local update_on_switch = Hooks.builtins.update_current_buffer_on_switch

		Hooks.register(Hooks.type.SWITCH, function(path, prev_path)
			vim.notify("Moved from " .. prev_path .. " to " .. path)
			update_on_switch(path, prev_path)

			if vim.bo.filetype == "oil" then
				local oil = require("oil")
				oil.open(path)
				vim.fn.chdir(oil.get_current_dir() or path)
			end
		end)

		Hooks.register(Hooks.type.DELETE, function()
			vim.cmd(config.update_on_change_command)
		end)

		vim.keymap.set(
			"n",
			"<leader>st",
			require("telescope").extensions.git_worktree.git_worktree,
			{ desc = "[S]earch Work[t]ree" }
		)
		vim.keymap.set(
			"n",
			"<leader>ct",
			require("telescope").extensions.git_worktree.create_git_worktree,
			{ desc = "[C]reat Work[t]ree" }
		)
	end,
}

vim.api.nvim_create_user_command("WorktreeAdd", function(args)
	local wt = require("git-worktree")
	local telescope = require("telescope")
	local branch_name = args.fargs[1]

	if branch_name then
		return wt.create_worktree(branch_name, branch_name, "origin")
	end

	return telescope.extensions.git_worktree.create_git_worktree()
end, {
	nargs = "?",
})

vim.api.nvim_create_user_command("RelativePath", function()
	local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ":.")
	vim.fn.setreg("+", path)
	print("Copied: " .. path)
end, {})

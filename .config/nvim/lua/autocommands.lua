-- ===== Lint ====
local lintGroup = vim.api.nvim_create_augroup("Linter", { clear = true })

vim.api.nvim_create_autocmd({ "InsertLeave", "BufWritePost", "BufEnter" }, {
	group = lintGroup,
	callback = function()
		local lint_status, lint = pcall(require, "lint")
		if lint_status then
			lint.try_lint()
		end
	end,
})

-- ===== Format On Save ====

local formatOnSaveGroup = vim.api.nvim_create_augroup("FormatOnSave", { clear = true })
vim.api.nvim_create_autocmd("BufWritePre", {
	group = formatOnSaveGroup,
	pattern = "*",
	callback = function(args)
		require("conform").format({ bufnr = args.buf })
	end,
})

vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking (copying) text",
	group = vim.api.nvim_create_augroup("kickstart-highlight-yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

-- ==== Misc ====
-- Show errors and warnings in a floating window
-- vim.api.nvim_create_autocmd("CursorHold", {
-- 	callback = function()
-- 		vim.diagnostic.open_float(nil, { focusable = false, source = "if_many" })
-- 	end,
-- })

vim.api.nvim_create_autocmd({ "VimEnter", "VimLeave" }, {
	callback = function()
		if vim.env.TMUX_PLUGIN_MANAGER_PATH then
			vim.uv.spawn(vim.env.TMUX_PLUGIN_MANAGER_PATH .. "/tmux-window-name/scripts/rename_session_windows.py", {})
		end
	end,
})

vim.api.nvim_create_autocmd("FileType", {
	desc = "Sets wordwrap on markdown files to enhance readability",
	pattern = "md",
	group = vim.api.nvim_create_augroup("md-word-wrap", { clear = true }),
	callback = function()
		vim.opt_local.wrap = true
		vim.opt_local.linebreak = true
		vim.opt_local.breakindent = true
		vim.opt_local.textwidth = 80 -- hard wrap while typing
		vim.opt_local.colorcolumn = "80" -- visual guide
	end,
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = { "markdown" },
	callback = function()
		vim.opt_local.conceallevel = 0
	end,
})

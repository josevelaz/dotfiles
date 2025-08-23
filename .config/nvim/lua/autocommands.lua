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

vim.api.nvim_create_autocmd("BufEnter", {
	desc = "Set Conceal level for MD files",
	pattern = "*.md",
	group = vim.api.nvim_create_augroup("md-conceal-level", { clear = true }),
	callback = function()
		vim.opt.conceallevel = 1
	end,
})

-- ==== Misc ====
-- Show errors and warnings in a floating window
-- vim.api.nvim_create_autocmd("CursorHold", {
-- 	callback = function()
-- 		vim.diagnostic.open_float(nil, { focusable = false, source = "if_many" })
-- 	end,
-- })

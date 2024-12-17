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

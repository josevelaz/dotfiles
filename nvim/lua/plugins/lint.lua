local function is_eslint_config(cwd, filename)
	local eslint_files = {
		".eslintrc.json",
		".eslintrc.js",
		".eslintrc.yaml",
		".eslintrc.yml",
		".eslintrc",
	}
	for _, eslint_file in ipairs(eslint_files) do
		if filename == cwd .. "/" .. eslint_file then
			return true
		end
	end
	return false
end

return {
	{
		"mfussenegger/nvim-lint",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local linter = require("lint")
			local js_configuration = { "cspell" }

			local cwd = vim.fn.getcwd()
			local cwd_files = vim.split(vim.fn.glob(cwd .. "/*"), "\n", { trimempty = true })

			for _, filepath in ipairs(cwd_files) do
				if is_eslint_config(cwd, filepath) then
					table.insert(js_configuration, "eslint")
				end
			end

			linter.linters_by_ft = {
				lua = { "luacheck", "cspell" },
				markdown = { "vale" },
				json = { "cspell" },
				javascript = js_configuration,
				javascriptreact = js_configuration,
				typescript = js_configuration,
				typescriptreact = js_configuration,
			}

			local group = vim.api.nvim_create_augroup("Linter", { clear = true })

			vim.api.nvim_create_autocmd({ "InsertLeave", "BufWritePost", "BufEnter" }, {
				group = group,
				callback = function()
					local lint_status, lint = pcall(require, "lint")
					if lint_status then
						lint.try_lint()
					end
				end,
			})
		end,
	},
}

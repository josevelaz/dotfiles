return {
	{
		"mfussenegger/nvim-lint",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local linter = require("lint")
			local js_configuration = { "eslint_d", "cspell" }

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

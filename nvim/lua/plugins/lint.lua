return {
	{
		"mfussenegger/nvim-lint",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local linter = require("lint")
			local js_configuration = { "eslint_d" }

			linter.linters_by_ft = {
				lua = { "luacheck", "cspell" },
				markdown = { "vale" },
				json = { "cspell" },
				javascript = js_configuration,
				javascriptreact = js_configuration,
				typescript = js_configuration,
				typescriptreact = js_configuration,
			}
		end,
	},
}

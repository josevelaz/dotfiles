return {
	{
		"stevearc/conform.nvim",
		cmd = { "ConformInfo" },
		keys = {
			{
				-- Customize or remove this keymap to your liking
				"<leader>f",
				function()
					require("conform").format({ async = true, lsp_fallback = true })
				end,
				mode = "",
				desc = "[F]ormat buffer",
			},
		},
		opts = function()
			local js_configuration = { { "prettierd", "prettier" }, { "eslint_d", "eslint" } }
			return {
				notify_on_error = false,
				formatters_by_ft = {
					javascript = js_configuration,
					javascriptreact = js_configuration,
					typescript = js_configuration,
					typescriptreact = js_configuration,
					lua = { "stylua" },
					go = { "goimports", "gofmt" },
				},
				format_on_save = { timeout_ms = 500, lsp_fallback = true },
			}
		end,
	},
}

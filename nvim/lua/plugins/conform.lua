return {
	{
		"stevearc/conform.nvim",
		cmd = { "ConformInfo" },
		keys = {
			{
				-- Customize or remove this keymap to your liking
				"<leader>f",
				function()
					require("conform").format()
				end,
				mode = "",
				desc = "[F]ormat buffer",
			},
		},
		opts = function()
			local js_configuration = { "prettierd", "eslint_d" }
			return {
				formatters_by_ft = {
					javascript = js_configuration,
					javascriptreact = js_configuration,
					typescript = js_configuration,
					typescriptreact = js_configuration,
					lua = { "stylua" },
					go = { "goimports", "gofumpt" },
				},
				default_format_ops = {
					lsp_format = "fallback",
				},
			}
		end,
	},
}

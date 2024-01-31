return {
	{
		"pmizio/typescript-tools.nvim",
		dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
		opts = {
			on_attach = function(client, bufnr)
				if client.supports_method("textDocument/inlayHint") then
					vim.lsp.inlay_hint.enable(bufnr, true)
				end
			end,
			expose_as_code_action = { "all" },
			tsserver_file_preferences = {
				includeInlayFunctionLikeReturnTypeHints = true,
				includeInlayFunctionParameterTypeHints = true,
				includeInlayParameterNameHints = "all", -- 'none' | 'literals' | 'all';
				includeInlayParameterNameHintsWhenArgumentMatchesName = false,
				includeInlayPropertyDeclarationTypeHints = false,
				includeInlayVariableTypeHints = false,
			},
			complete_function_calls = true,
		},
	},
}

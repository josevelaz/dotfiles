return {
	{
		"pmizio/typescript-tools.nvim",
		dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
		opts = {
			on_attach = function(client, bufnr)
				if client.supports_method("textDocument/inlayHint") then
					vim.lsp.inlay_hint.enable(true)
				end
			end,
			settings = {
        separate_diagnostic_server = false,
				tsserver_file_preferences = {
					includeInlayParameterNameHints = "all",
					includeInlayFunctionLikeReturnTypeHints = true,
				},
				expose_as_code_action = "all",
				jsx_close_tag = {
					enable = true,
				},
			},
		},
	},
}

return {
	"pmizio/typescript-tools.nvim",
	dependencies = { "nvim-lua/plenary.nvim", "neovim/nvim-lspconfig" },
	enabled = false,
	opts = {
		settings = {
			expose_as_code_action = "all",
			publish_diagnostic_on = "change",
			complete_function_calls = true,
			tsserver_file_preferences = {
				includeCompletionsForModuleExports = true,
				allowRenameOfImportPath = true,
				includeCompletionsForImportStatements = true,

				includeInlayParameterNameHints = "all",
				includeInlayParameterNameHintsWhenArgumentMatchesName = false,
				includeInlayFunctionParameterTypeHints = true,
				includeInlayVariableTypeHints = true,
				includeInlayVariableTypeHintsWhenTypeMatchesName = false,
				includeInlayPropertyDeclarationTypeHints = true,
				includeInlayFunctionLikeReturnTypeHints = true,
				includeInlayEnumMemberValueHints = false,
			},
			jsx_close_tag = {
				enabled = true,
			},
		},
	},
}

local servers = {}

servers.gopls = {
	filetypes = { "templ" },
}

servers.lua_ls = {}

servers.templ = {}

servers.sqlls = {}

servers.html = {
	filetypes = { "html", "templ" },
}

servers.htmx = {
	filetypes = { "html", "templ" },
}

servers.tailwindcss = {
	filetypes = { "typescriptreact", "templ" },
	root_dir = require("lspconfig").util.root_pattern("tailwind.config.{js,cjs,mjs,ts}"),
	settings = {
		tailwindCSS = {
			includeLanguages = { templ = "html" },
			classFunctions = { "Class" },
			classAttributes = { "Class" },
		},
	},
}

-- servers.vtsls = {
-- 	settings = {
-- 		vtsls = {
-- 			enableMoveToFileCodeAction = true,
-- 			autoUseWorkspaceTsdk = true,
-- 			experimental = {
-- 				maxInlayHintLength = 30,
-- 				completion = {
-- 					enableServerSideFuzzyMatch = false,
-- 					enableProjectDiagnostics = true,
-- 				},
-- 			},
-- 		},
-- 		typescript = {
-- 			updateImportsOnFileMove = { enabled = "always" },
-- 			inlayHints = {
-- 				enumMemberValues = { enabled = true },
-- 				functionLikeReturnTypes = { enabled = true },
-- 				parameterNames = { enabled = "all" },
-- 				parameterTypes = { enabled = true },
-- 				propertyDeclarationTypes = { enabled = true },
-- 				variableTypes = { enabled = true },
-- 			},
-- 			suggest = {
-- 				completeFunctionCalls = true,
-- 			},
-- 		},
-- 	},
-- }

return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			"williamboman/mason.nvim",
			"williamboman/mason-lspconfig.nvim",
			"WhoIsSethDaniel/mason-tool-installer.nvim",
			-- "yioneko/nvim-vtsls",
			{
				"j-hui/fidget.nvim",
				opts = {
					notification = {
						window = {
							winblend = 0,
							border = "rounded",
						},
					},
				},
			},

			{ "Bilal2453/luvit-meta", lazy = true },
			{ "justinsgithub/wezterm-types", lazy = true },
		},
		config = function()
			--  Available keys are:
			--  - cmd (table): Override the default command used to start the server
			--  - filetypes (table): Override the default list of associated filetypes for the server
			--  - capabilities (table): Override fields in capabilities. Can be used to disable certain LSP features.
			--  - settings (table): Override the default settings passed when initializing the server.
			--        For example, to see the options for `lua_ls`, you could go to: https://luals.github.io/wiki/settings/

			require("mason").setup()

			local ensure_installed = vim.tbl_keys(servers or {})
			vim.list_extend(ensure_installed, {
				"stylua",
				"lua_ls",
				"eslint_d",
				"prettierd",
				"jsonls",
			})

			---@diagnostic disable-next-line: missing-fields
			require("mason-lspconfig").setup({
				handlers = {
					function(server_name)
						-- if server_name == "tsserver" or server_name == "ts_ls" then
						-- 	return
						-- end

						local configure_server = require("lsp").configure_server

						local server_configuration = servers[server_name] or {}

						configure_server(server_name, server_configuration)
					end,
				},
			})
		end,
	},
}

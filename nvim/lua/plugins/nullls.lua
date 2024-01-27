return {
	{
		"jose-elias-alvarez/null-ls.nvim",
		opts = function()
			local nls = require("null-ls")

			local formatting = nls.builtins.formatting
			local diagnostics = nls.builtins.diagnostics
			local code_actions = nls.builtins.code_actions
			local lsp_formatting = function(bufnr)
				vim.lsp.buf.format({
					filter = function(client)
						-- apply whatever logic you want (in this example, we'll only use null-ls)
						return client.name == "null-ls"
					end,
					bufnr = bufnr,
				})
			end

			-- if you want to set up formatting on save, you can use this as a callback
			local augroup = vim.api.nvim_create_augroup("LspFormatting", {})
			local eslint_file_config = { ".eslintrc.js", ".eslintrc.json" }
			return {
				sources = {
					-- formatting
					formatting.stylua,
					formatting.prettierd.with({
						extra_filetypes = { "svelte" },
					}),
					diagnostics.eslint_d.with({
						condition = function(utils)
							return utils.root_has_file(eslint_file_config)
						end,
					}),
					formatting.sqlfmt,
					formatting.goimports,
					formatting.gofmt,
					-- code_actions
					code_actions.eslint_d.with({
						condition = function(utils)
							return utils.root_has_file(eslint_file_config)
						end,
					}),
				},
				on_attach = function(client, bufnr)
					if client.supports_method("textDocument/formatting") then
						local opts = {
							group = augroup,
							buffer = bufnr,
							callback = function()
								-- on 0.8, you should use vim.lsp.buf.format({ bufnr = bufnr }) instead
								-- on later neovim version, you should use vim.lsp.buf.format({ async = false }) instead
								lsp_formatting(bufnr)
							end,
						}
						vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
						vim.api.nvim_create_autocmd("BufLeave", opts)
						--			vim.api.nvim_create_autocmd("InsertLeave", opts)
					end
				end,
			}
		end,
	},
}

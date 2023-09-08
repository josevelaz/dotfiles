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

nls.setup({
	sources = {
		-- formatting
		formatting.stylua,
		formatting.prettierd.with({
			extra_filetypes = { "svelte" },
			prefer_local = "node_modules/.bin",
		}),
		diagnostics.eslint_d,
		formatting.sqlfmt,
		formatting.goimports,
		formatting.gofmt,
		-- code_actions
		code_actions.eslint_d,
		require("typescript.extensions.null-ls.code-actions"),
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
})

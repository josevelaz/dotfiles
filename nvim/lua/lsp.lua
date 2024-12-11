local methods = vim.lsp.protocol.Methods
local M = {}

local on_attach = function(client, bufnr)
	local map = function(keys, func, desc)
		vim.keymap.set("n", keys, func, { buffer = bufnr, desc = "LSP: " .. desc })
	end

	map("gd", require("telescope.builtin").lsp_definitions, "[G]oto [D]efinition")

	-- Find references for the word under your cursor.
	map("gr", require("telescope.builtin").lsp_references, "[G]oto [R]eferences")

	-- Jump to the implementation of the word under your cursor.
	--  Useful when your language has ways of declaring types without an actual implementation.
	map("gI", require("telescope.builtin").lsp_implementations, "[G]oto [I]mplementation")

	-- Jump to the type of the word under your cursor.
	--  Useful when you're not sure what type a variable is and you want to see
	--  the definition of its *type*, not where it was *defined*.
	map("<leader>D", require("telescope.builtin").lsp_type_definitions, "Type [D]efinition")

	-- Fuzzy find all the symbols in your current document.
	--  Symbols are things like variables, functions, types, etc.
	map("<leader>ds", require("telescope.builtin").lsp_document_symbols, "[D]ocument [S]ymbols")

	-- Fuzzy find all the symbols in your current workspace.
	--  Similar to document symbols, except searches over your entire project.
	map("<leader>ws", require("telescope.builtin").lsp_dynamic_workspace_symbols, "[W]orkspace [S]ymbols")

	-- Rename the variable under your cursor.
	--  Most Language Servers support renaming across files, etc.
	map("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")

	-- Execute a code action, usually your cursor needs to be on top of an error
	-- or a suggestion from your LSP for this to activate.
	map("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction")

	-- Opens a popup that displays documentation about the word under your cursor
	--  See `:help K` for why this keymap.
	map("K", vim.lsp.buf.hover, "Hover Documentation")

	-- WARN: This is not Goto Definition, this is Goto Declaration.
	--  For example, in C this would take you to the header.
	map("gD", vim.lsp.buf.declaration, "[G]oto [D]eclaration")

	-- The following two autocommands are used to highlight references of the
	-- word under your cursor when your cursor rests there for a little while.
	--    See `:help CursorHold` for information about when this is executed
	--
	-- When you move your cursor, the highlights will be cleared (the second autocommand).
	if client and client.server_capabilities.documentHighlightProvider then
		vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
			buffer = bufnr,
			callback = vim.lsp.buf.document_highlight,
		})

		vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
			buffer = bufnr,
			callback = vim.lsp.buf.clear_references,
		})
	end
	if client.supports_method(methods.textDocument_inlayHint) then
		vim.lsp.inlay_hint.enable(true, { bufnr = bufnr })

		vim.keymap.set("n", "<leader>ci", function()
			-- Toggle the hints:
			local enabled = vim.lsp.inlay_hint.is_enabled({ bufnr = bufnr })

			vim.lsp.inlay_hint.enable(not enabled, { bufnr = bufnr })

			vim.g.inlay_hint_enabled = not enabled

			-- If toggling them on, turn them back off when entering insert mode.
			if vim.g.inlay_hint_enabled then
				vim.api.nvim_create_autocmd("InsertEnter", {
					buffer = bufnr,
					callback = function()
						vim.lsp.inlay_hint.enable(false, { bufnr = bufnr })
					end,
				})

				vim.api.nvim_create_autocmd("InsertLeave", {
					buffer = bufnr,
					callback = function()
						vim.lsp.inlay_hint.enable(vim.g.inlay_hint_enabled, { bufnr = bufnr })
					end,
				})
			end
		end, { buffer = bufnr, desc = "Toggle inlay hints" })
	end
end

vim.api.nvim_create_autocmd("LspAttach", {
	group = vim.api.nvim_create_augroup("lsp-attach", { clear = true }),
	callback = function(args)
		local client = vim.lsp.get_client_by_id(args.data.client_id)

		-- I don't think this can happen but it's a wild world out there.
		if not client then
			return
		end

		on_attach(client, args.buf)
	end,
})

--- Configures the given server with its settings and applying the regular
--- client capabilities (+ the completion ones from nvim-cmp).
---@param server string
---@param settings? table
function M.configure_server(server, settings)
	--  By default, Neovim doesn't support everything that is in the LSP specification.
	--  When you add nvim-cmp, luasnip, etc. Neovim now has *more* capabilities.
	--  So, we create new capabilities with nvim cmp, and then broadcast that to the servers.
	local function capabilities()
		local cap = vim.lsp.protocol.make_client_capabilities()
		-- UFO setup stuff
		cap.textDocument.foldingRange = {
			dynamicRegistration = false,
			lineFoldingOnly = true,
		}
		return vim.tbl_deep_extend(
			"force",
			cap,
			-- nvim-cmp supports additional completion capabilities, so broadcast that to servers.
			require("cmp_nvim_lsp").default_capabilities()
		)
	end

	require("lspconfig")[server].setup(
		vim.tbl_deep_extend("error", { capabilities = capabilities(), silent = true }, settings or {})
	)
end

return M

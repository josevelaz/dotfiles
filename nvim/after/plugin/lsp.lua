local lsp = require("lsp-zero").preset({})
local builtin = require("telescope.builtin")
local navic = require("nvim-navic")
local symbols = require("util.symbols")

-- (Optional) Configure lua language server for neovim
require("lspconfig").lua_ls.setup(lsp.nvim_lua_ls())

require("lspconfig").phpactor.setup({})

lsp.ensure_installed({
	"tsserver",
	"gopls",
	"svelte",
	"lua_ls",
	"yamlls",
	"sqlls",
	"jsonls",
	"html",
	"cssls",
})

lsp.set_sign_icons({
	error = " ",
	warn = "⚠",
	hint = "󱩐 ",
	info = " ",
})

lsp.skip_server_setup({ "tsserver" })

lsp.setup()

lsp.on_attach(function(client, bufnr)
	if client.server_capabilities.documentSymbolProvider then
		navic.attach(client, bufnr)
	end

	lsp.default_keymaps({ buffer = bufnr })

	local opts = { buffer = bufnr, remap = false }

	vim.keymap.set("n", "gd", function()
		vim.lsp.buf.definition()
	end, { buffer = bufnr, remap = false, desc = "Go To Definition" })

	vim.keymap.set("n", "K", function()
		vim.lsp.buf.hover()
	end, { buffer = bufnr, remap = false, desc = "Hover" })

	vim.keymap.set(
		"n",
		"<leader>vws",
		builtin.lsp_workspace_symbols,
		{ buffer = bufnr, remap = false, desc = "View Workspace Symbol" }
	)

	vim.keymap.set("n", "<leader>vd", function()
		vim.diagnostic.open_float()
	end, opts)
	--
	vim.keymap.set("n", "[d", function()
		vim.diagnostic.goto_next()
	end, opts)

	vim.keymap.set("n", "]d", function()
		vim.diagnostic.goto_prev()
	end, opts)
	vim.keymap.set("n", "<leader>vca", "<CMD>CodeActionMenu<CR>", opts)

	vim.keymap.set("n", "<leader>vrr", builtin.lsp_references, { buffer = bufnr, remap = false, desc = "References" })

	vim.keymap.set("n", "<leader>vrn", function()
		vim.lsp.buf.rename()
	end, { buffer = bufnr, remap = false, desc = "Rename" })

	vim.keymap.set("i", "<C-h>", function()
		vim.lsp.buf.signature_help()
	end, { buffer = bufnr, remap = false, desc = "Signature Help" })
end)

local format_sync_grp = vim.api.nvim_create_augroup("GoImport", {})
vim.api.nvim_create_autocmd("BufWritePre", {
	pattern = "*.go",
	callback = function()
		require("go.format").goimport()
	end,
	group = format_sync_grp,
})

-- Make sure you setup `cmp` after lsp-zero
local cmp = require("cmp")
local cmp_select = { behavior = cmp.SelectBehavior.Select }

vim.api.nvim_set_hl(0, "CmpItemAbbrMatch", { fg = "#FFE6B3" })
vim.api.nvim_set_hl(0, "CmpItemAbbrMatchFuzzy", { fg = "#F02E6E" })

cmp.setup({
	formatting = {
		fields = { "abbr", "kind" },
		format = function(_, vim_item)
			vim_item.kind = (symbols[vim_item.kind] or "") .. vim_item.kind
			return vim_item
		end,
	},
	window = {
		completion = cmp.config.window.bordered(),
		documentation = cmp.config.window.bordered(),
	},
	mapping = {
		-- `Enter` key to confirm completion
		["<CR>"] = cmp.mapping.confirm({ select = true }),
		-- Ctrl+Space to trigger completion menu
		["<C-Space>"] = cmp.mapping.complete(),
		["<C-p>"] = cmp.mapping.select_prev_item(cmp_select),
		["<C-n>"] = cmp.mapping.select_next_item(cmp_select),
	},
	sources = cmp.config.sources({
		{ name = "nvim_lsp" },
		{ name = "nvim_lsp_signature_help" },
		{ name = "async_path" },
	}),
})

cmp.setup.cmdline("/", {
	sources = cmp.config.sources({
		{ name = "nvim_lsp_document_symbol" },
	}, {
		{ name = "buffer" },
	}),
})

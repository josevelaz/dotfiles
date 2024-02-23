return {
	{
		"VonHeikemen/lsp-zero.nvim",
		branch = "v3.x",
		lazy = true,
		config = false,
		init = function()
			vim.g.lsp_zero_extend_cmp = 0
			vim.g.lsp_zero_extend_lspconfig = 0
		end,
	},
	{
		"williamboman/mason.nvim",
		lazy = false,
		config = true,
	},
	{
		"neovim/nvim-lspconfig",
		cmd = { "LspInfo", "LspInstall", "LspStart" },
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			{ "hrsh7th/cmp-nvim-lsp" },
			{ "williamboman/mason-lspconfig.nvim" },
		},
		config = function()
			local builtin = require("telescope.builtin")
			local navic = require("nvim-navic")

			-- This is where all the LSP shenanigans will live
			local lsp_zero = require("lsp-zero")

			lsp_zero.set_sign_icons({
				error = " ",
				warn = "⚠",
				hint = "󱩐 ",
				info = " ",
			})

			local function filter(arr, fn)
				if type(arr) ~= "table" then
					return arr
				end

				local filtered = {}
				for k, v in pairs(arr) do
					if fn(v, k, arr) then
						table.insert(filtered, v)
					end
				end

				return filtered
			end

			local function filterReactDTS(value)
				return string.match(value.filename, "react/index.d.ts") == nil
			end

			local function on_list(options)
				local items = options.items
				if #items > 1 then
					items = filter(items, filterReactDTS)
				end

				vim.fn.setqflist({}, " ", { title = options.title, items = items, context = options.context })
				vim.api.nvim_command("cfirst") -- or maybe you want 'copen' instead of 'cfirst'
			end

			lsp_zero.extend_lspconfig()

			lsp_zero.set_server_config({
				capabilities = {
					textDocument = {
						foldingRange = {
							dynamicRegistration = false,
							lineFoldingOnly = true,
						},
					},
				},
			})

			lsp_zero.on_attach(function(client, bufnr)
				if client.server_capabilities.documentSymbolProvider then
					navic.attach(client, bufnr)
				end

				if client.supports_method("textDocument/inlayHint") then
					vim.lsp.inlay_hint.enable(bufnr, true)
				end

				lsp_zero.default_keymaps({ buffer = bufnr })

				local opts = { buffer = bufnr, remap = false }

				vim.keymap.set("n", "gd", function()
					vim.lsp.buf.definition({ on_list = on_list })
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

				vim.keymap.set(
					"n",
					"<leader>vrr",
					builtin.lsp_references,
					{ buffer = bufnr, remap = false, desc = "References" }
				)

				vim.keymap.set("n", "<leader>vrn", function()
					vim.lsp.buf.rename()
				end, { buffer = bufnr, remap = false, desc = "Rename" })

				vim.keymap.set("i", "<C-h>", function()
					vim.lsp.buf.signature_help()
				end, { buffer = bufnr, remap = false, desc = "Signature Help" })
			end)

			require("mason-lspconfig").setup({
				ensure_installed = {
					"gopls",
					"lua_ls",
					"yamlls",
					"sqlls",
					"jsonls",
					"html",
					"cssls",
				},
				handlers = {
					lsp_zero.default_setup,
					tsserver = lsp_zero.noop,
					lua_ls = function()
						local lua_opts = lsp_zero.nvim_lua_ls()
						require("lspconfig").lua_ls.setup(lua_opts)
					end,
				},
			})
		end,
	},
	-- Autocompletion
	{
		"hrsh7th/nvim-cmp",
		dependencies = {
			{ "L3MON4D3/LuaSnip" },
		},
		config = function()
			local cmp = require("cmp")
			local cmp_select = { behavior = cmp.SelectBehavior.Select }
			local cmp_format = require("lsp-zero").cmp_format()
			local symbols = require("util.symbols")

			vim.api.nvim_set_hl(0, "CmpItemAbbrMatch", { fg = "#FFE6B3" })
			vim.api.nvim_set_hl(0, "CmpItemAbbrMatchFuzzy", { fg = "#F02E6E" })

			cmp.setup({
				formatting = {
					cmp_format,
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
		end,
	},
}

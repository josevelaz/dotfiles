local lsp = require("lsp-zero").preset({})
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
	vim.keymap.set("n", "<leader>vws", function()
		vim.lsp.buf.workspace_symbol()
	end, { buffer = bufnr, remap = false, desc = "View Workspace Symbol" })
	vim.keymap.set("n", "<leader>vd", function()
		vim.diagnostic.open_float()
	end, opts)
	vim.keymap.set("n", "[d", function()
		vim.diagnostic.goto_next()
	end, opts)
	vim.keymap.set("n", "]d", function()
		vim.diagnostic.goto_prev()
	end, opts)
	vim.keymap.set("n", "<leader>vca", "<CMD>CodeActionMenu<CR>", opts)
	vim.keymap.set("n", "<leader>vrr", function()
		vim.lsp.buf.references()
	end, { buffer = bufnr, remap = false, desc = "References" })
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

require("go").setup({
	disable_defaults = false, -- true|false when true set false to all boolean settings and replace all table
	-- settings with {}
	go = "go", -- go command, can be go[default] or go1.18beta1
	goimport = "gopls", -- goimport command, can be gopls[default] or goimport
	fillstruct = "gopls", -- can be nil (use fillstruct, slower) and gopls
	gofmt = "gofumpt", --gofmt cmd,
	max_line_len = 128, -- max line length in golines format, Target maximum line length for golines
	tag_transform = false, -- can be transform option("snakecase", "camelcase", etc) check gomodifytags for details and more options
	tag_options = "json=omitempty", -- sets options sent to gomodifytags, i.e., json=omitempty
	gotests_template = "", -- sets gotests -template parameter (check gotests for details)
	gotests_template_dir = "", -- sets gotests -template_dir parameter (check gotests for details)
	comment_placeholder = "", -- comment_placeholder your cool placeholder e.g. ﳑ       
	icons = { breakpoint = "🧘", currentpos = "🏃" }, -- setup to `false` to disable icons setup
	verbose = false, -- output loginf in messages
	lsp_cfg = false, -- true: use non-default gopls setup specified in go/lsp.lua
	lsp_gofumpt = false, -- true: set default gofmt in gopls format to gofumpt
	lsp_on_attach = nil, -- nil: use on_attach function defined in go/lsp.lua,
	--      when lsp_cfg is true
	-- if lsp_on_attach is a function: use this function as on_attach function for gopls
	lsp_keymaps = true, -- set to false to disable gopls/lsp keymap
	lsp_codelens = true, -- set to false to disable codelens, true by default, you can use a function
	-- function(bufnr)
	--    vim.api.nvim_buf_set_keymap(bufnr, "n", "<space>F", "<cmd>lua vim.lsp.buf.formatting()<CR>", {noremap=true, silent=true})
	-- end
	-- to setup a table of codelens
	lsp_diag_hdlr = true, -- hook lsp diag handler
	lsp_diag_underline = true,
	-- virtual text setup
	lsp_diag_virtual_text = { space = 0, prefix = "■" },
	lsp_diag_signs = true,
	lsp_diag_update_in_insert = false,
	lsp_document_formatting = true,
	-- set to true: use gopls to format
	-- false if you want to use other formatter tool(e.g. efm, nulls)
	lsp_inlay_hints = {
		enable = true,
		-- Only show inlay hints for the current line
		only_current_line = false,
		-- Event which triggers a refersh of the inlay hints.
		-- You can make this "CursorMoved" or "CursorMoved,CursorMovedI" but
		-- not that this may cause higher CPU usage.
		-- This option is only respected when only_current_line and
		-- autoSetHints both are true.
		only_current_line_autocmd = "CursorHold",
		-- whether to show variable name before type hints with the inlay hints or not
		-- default: false
		show_variable_name = true,
		-- prefix for parameter hints
		parameter_hints_prefix = " ",
		show_parameter_hints = true,
		-- prefix for all the other hints (type, chaining)
		other_hints_prefix = "=> ",
		-- whether to align to the lenght of the longest line in the file
		max_len_align = false,
		-- padding from the left if max_len_align is true
		max_len_align_padding = 1,
		-- whether to align to the extreme right or not
		right_align = false,
		-- padding from the right if right_align is true
		right_align_padding = 6,
		-- The color of the hints
		highlight = "Comment",
	},
	gopls_cmd = nil, -- if you need to specify gopls path and cmd, e.g {"/home/user/lsp/gopls", "-logfile","/var/log/gopls.log" }
	gopls_remote_auto = true, -- add -remote=auto to gopls
	gocoverage_sign = "█",
	sign_priority = 5, -- change to a higher number to override other signs
	dap_debug = true, -- set to false to disable dap
	dap_debug_keymap = true, -- true: use keymap for debugger defined in go/dap.lua
	-- false: do not use keymap in go/dap.lua.  you must define your own.
	-- windows: use visual studio keymap
	dap_debug_gui = {}, -- bool|table put your dap-ui setup here set to false to disable
	dap_debug_vt = { enabled_commands = true, all_frames = true }, -- bool|table put your dap-virtual-text setup here set to false to disable
	dap_port = 38697, -- can be set to a number, if set to -1 go.nvim will pickup a random port
	dap_timeout = 15, --  see dap option initialize_timeout_sec = 15,
	dap_retries = 20, -- see dap option max_retries
	build_tags = "tag1,tag2", -- set default build tags
	textobjects = true, -- enable default text jobects through treesittter-text-objects
	test_runner = "go", -- one of {`go`, `richgo`, `dlv`, `ginkgo`, `gotestsum`}
	verbose_tests = true, -- set to add verbose flag to tests deprecated, see '-v' option
	run_in_floaterm = false, -- set to true to run in float window. :GoTermClose closes the floatterm
	-- float term recommend if you use richgo/ginkgo with terminal color

	floaterm = {
		-- position
		posititon = "auto", -- one of {`top`, `bottom`, `left`, `right`, `center`, `auto`}
		width = 0.45, -- width of float window if not auto
		height = 0.98, -- height of float window if not auto
	},
	trouble = false, -- true: use trouble to open quickfix
	test_efm = false, -- errorfomat for quickfix, default mix mode, set to true will be efm only
	luasnip = false, -- enable included luasnip snippets. you can also disable while add lua/snips folder to luasnip load
	--  Do not enable this if you already added the path, that will duplicate the entries
	on_jobstart = function(cmd)
		_ = cmd
	end, -- callback for stdout
	on_stdout = function(err, data)
		_, _ = err, data
	end, -- callback when job started
	on_stderr = function(err, data)
		_, _ = err, data
	end, -- callback for stderr
	on_exit = function(code, signal, output)
		_, _, _ = code, signal, output
	end, -- callback for jobexit, output : string
	iferr_vertical_shift = 4, -- defines where the cursor will end up vertically from the begining of if err statement
})

require("typescript").setup({
	disable_commands = false, -- prevent the plugin from creating Vim commands
	debug = false, -- enable debug logging for commands
	go_to_source_definition = {
		fallback = true, -- fall back to standard LSP definition on failure
	},
	server = {
		on_attach = function(client, bufnr)
			print(client)
			vim.lsp.buf.inlay_hint(bufnr, true)
		end,
		settings = {
			javascript = {
				inlayHints = {
					includeInlayEnumMemberValueHints = false,
					includeInlayFunctionLikeReturnTypeHints = true,
					includeInlayFunctionParameterTypeHints = true,
					includeInlayParameterNameHints = "all", -- 'none' | 'literals' | 'all';
					includeInlayParameterNameHintsWhenArgumentMatchesName = false,
					includeInlayPropertyDeclarationTypeHints = false,
					includeInlayVariableTypeHints = false,
				},
			},
			typescript = {
				inlayHints = {
					includeInlayEnumMemberValueHints = false,
					includeInlayFunctionLikeReturnTypeHints = true,
					includeInlayFunctionParameterTypeHints = true,
					includeInlayParameterNameHints = "all", -- 'none' | 'literals' | 'all';
					includeInlayParameterNameHintsWhenArgumentMatchesName = false,
					includeInlayPropertyDeclarationTypeHints = false,
					includeInlayVariableTypeHints = false,
				},
			},
		},
	},
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

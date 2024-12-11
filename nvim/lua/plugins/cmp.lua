return {
	{
		"iguanacucumber/magazine.nvim",
		name = "nvim-cmp",
		event = "InsertEnter",
		dependencies = {
			{
				"L3MON4D3/LuaSnip",
				build = "make install_jsregexp",
				dependencies = {
					-- `friendly-snippets` contains a variety of premade snippets.
					--    See the README about individual language/framework/plugin snippets:
					--    https://github.com/rafamadriz/friendly-snippets
					{
						"rafamadriz/friendly-snippets",
						config = function()
							require("luasnip.loaders.from_vscode").lazy_load()
						end,
					},
				},
			},
			"onsails/lspkind.nvim",

			"saadparwaiz1/cmp_luasnip",
			{ "iguanacucumber/mag-nvim-lsp", name = "cmp-nvim-lsp", opts = {} },
			{ "iguanacucumber/mag-nvim-lua", name = "cmp-nvim-lua" },
			{ "iguanacucumber/mag-buffer", name = "cmp-buffer" },
			{ "iguanacucumber/mag-cmdline", name = "cmp-cmdline" },
			"hrsh7th/cmp-path",
		},
		opts = function()
			local luasnip = require("luasnip")
			local lsp_kind = require("lspkind")
			local cmp = require("cmp")

			return {
				snippet = {
					expand = function(args)
						luasnip.lsp_expand(args.body)
					end,
				},
				formatting = {
					format = lsp_kind.cmp_format(),
					fields = { "abbr", "kind", "menu" },
					expandable_indicator = true,
				},
				completion = { completeopt = "menu,menuone,noinsert,noselect" },
				preselect = cmp.PreselectMode.None,

				window = {
					documentation = cmp.config.window.bordered({ scrollbar = true }),
				},

				-- For an understanding of why these mappings were
				-- chosen, you will need to read `:help ins-completion`
				--
				-- No, but seriously. Please read `:help ins-completion`, it is really good!
				mapping = cmp.mapping.preset.insert({
					-- Select the [n]ext item
					["<C-n>"] = cmp.mapping.select_next_item(),
					-- Select the [p]revious item
					["<C-p>"] = cmp.mapping.select_prev_item(),

					-- Scroll the documentation window [b]ack / [f]orward
					["<C-b>"] = cmp.mapping.scroll_docs(-4),
					["<C-f>"] = cmp.mapping.scroll_docs(4),

					-- Accept ([y]es) the completion.
					--  This will auto-import if your LSP supports it.
					--  This will expand snippets if the LSP sent a snippet.
					["<CR>"] = cmp.mapping.confirm({ select = true }),

					-- Manually trigger a completion from nvim-cmp.
					--  Generally you don't need this, because nvim-cmp will display
					--  completions whenever it has completion options available.
					["<C-Space>"] = cmp.mapping.complete(),

					-- Think of <c-l> as moving to the right of your snippet expansion.
					--  So if you have a snippet that's like:
					--  function $name($args)
					--    $body
					--  end
					--
					-- <c-l> will move you to the right of each of the expansion locations.
					-- <c-h> is similar, except moving you backwards.
					["<C-l>"] = cmp.mapping(function()
						if luasnip.expand_or_locally_jumpable() then
							luasnip.expand_or_jump()
						end
					end, { "i", "s" }),
					["<C-h>"] = cmp.mapping(function()
						if luasnip.locally_jumpable(-1) then
							luasnip.jump(-1)
						end
					end, { "i", "s" }),

					-- For more advanced Luasnip keymaps (e.g. selecting choice nodes, expansion) see:
					--    https://github.com/L3MON4D3/LuaSnip?tab=readme-ov-file#keymaps
				}),
				sources = cmp.config.sources({
					{ name = "nvim_lsp", keyword_length = 2 },
					{
						name = "luasnip",
						-- Don't show snippet completions in comments or strings.
						entry_filter = function()
							local ctx = require("cmp.config.context")
							local in_string = ctx.in_syntax_group("String") or ctx.in_treesitter_capture("string")
							local in_comment = ctx.in_syntax_group("Comment") or ctx.in_treesitter_capture("comment")

							return not in_string and not in_comment
						end,
					},
				}, { name = "nvim_lua" }, {
					{ name = "path" },
					{
						name = "buffer",
						keyword_length = 3,
						option = {
							-- Buffer completions from all visible buffers (that aren't huge).
							get_bufnrs = function()
								local bufs = {}

								for _, win in ipairs(vim.api.nvim_list_wins()) do
									local buf = vim.api.nvim_win_get_buf(win)
									if vim.bo[buf].filetype ~= "bigfile" then
										table.insert(bufs, buf)
									end
								end

								return bufs
							end,
						},
					},
				}),
				sorting = {
					priority_weight = 2,
					comparators = {
						cmp.config.compare.offset,
						cmp.config.compare.exact,
						cmp.config.compare.score,

						-- copied from cmp-under, but I don't think I need the plugin for this.
						-- I might add some more of my own.
						function(entry1, entry2)
							local _, entry1_under = entry1.completion_item.label:find("^_+")
							local _, entry2_under = entry2.completion_item.label:find("^_+")
							entry1_under = entry1_under or 0
							entry2_under = entry2_under or 0
							if entry1_under > entry2_under then
								return false
							elseif entry1_under < entry2_under then
								return true
							end
						end,

						cmp.config.compare.kind,
						cmp.config.compare.sort_text,
						cmp.config.compare.length,
						cmp.config.compare.order,
					},
				},
				performance = {
					max_view_entries = 30,
				},
			}
		end,
		config = function(_, opts)
			-- See `:help cmp`
			local cmp = require("cmp")

			local luasnip = require("luasnip")

			luasnip.config.setup({})

			cmp.setup(opts)

			cmp.setup.cmdline({ "/", "?" }, {
				mapping = cmp.mapping.preset.cmdline(),
				-- window = { completion = cmp.config.window.bordered({ col_offset = 0 }) },
				sources = {
					{ name = "buffer" },
				},
			})

			cmp.setup.cmdline(":", {
				mapping = cmp.mapping.preset.cmdline(),
				-- window = { completion = cmp.config.window.bordered({ col_offset = 0 }) },
				sources = cmp.config.sources({
					{ name = "path" },
				}, {
					{ name = "cmdline", option = {
						ignore_cmds = { "Man", "!" },
					} },
				}),
			})
		end,
	},
}

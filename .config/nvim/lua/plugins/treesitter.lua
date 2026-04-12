return {
	{ -- Highlight, edit, and navigate code
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		branch = "main",
		lazy = false,
		opts = {
			install_dir = vim.fn.stdpath("data") .. "/site",
			ensure_installed = {
				"bash",
				"html",
				"lua",
				"luadoc",
				"markdown",
				"markdown_inline",
				"vim",
				"vimdoc",
				"jsdoc",
				"typescript",
				"javascript",
				"json",
				"yaml",
			},
			-- Autoinstall languages that are not installed
			auto_install = true,
			highlight = {
				enable = true,
				-- Some languages depend on vim's regex highlighting system (such as Ruby) for indent rules.
				--  If you are experiencing weird indenting issues, add the language to
				--  the list of additional_vim_regex_highlighting and disabled languages for indent.
				additional_vim_regex_highlighting = { "markdown" },
			},
		},
		config = function(_, opts)
			local ts = require("nvim-treesitter")
			local parsers = require("nvim-treesitter.parsers")

			ts.setup({
				install_dir = opts.install_dir,
			})

			ts.install(opts.ensure_installed)

			local highlight_enabled = opts.highlight and opts.highlight.enable ~= false
			local group = vim.api.nvim_create_augroup("nvim_treesitter_main", { clear = true })

			local function get_lang(bufnr)
				local ft = vim.bo[bufnr].filetype
				if ft == "" then
					return nil
				end

				local ok, lang = pcall(vim.treesitter.language.get_lang, ft)
				if ok and lang and lang ~= "" then
					return lang
				end

				return ft
			end

			vim.api.nvim_create_autocmd("FileType", {
				group = group,
				callback = function(args)
					if not highlight_enabled then
						return
					end

					local lang = get_lang(args.buf)
					if not lang or not parsers[lang] then
						return
					end

					local installed = ts.get_installed("parsers")
					if opts.auto_install and not vim.list_contains(installed, lang) then
						ts.install(lang)
						return
					end

					if vim.list_contains(installed, lang) then
						pcall(vim.treesitter.start, args.buf, lang)
					end
				end,
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		opts = {
			max_lines = 5,
			multiline_threshold = 3,
		},
	},
}

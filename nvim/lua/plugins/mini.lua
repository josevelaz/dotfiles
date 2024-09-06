return {
	{ -- Collection of various small independent plugins/modules
		"echasnovski/mini.nvim",
		config = function()
			local nmap = function(keymap, cmd, desc) end

      require("mini.indentscope").setup()

			-- Better Around/Inside textobjects
			--
			-- Examples:
			--  - va)  - [V]isually select [A]round [)]paren
			--  - yinq - [Y]ank [I]nside [N]ext [']quote
			--  - ci'  - [C]hange [I]nside [']quote
			require("mini.ai").setup({ n_lines = 500 })

			-- Add/delete/replace surroundings (brackets, quotes, etc.)
			--
			-- - saiw) - [S]urround [A]dd [I]nner [W]ord [)]Paren
			-- - sd'   - [S]urround [D]elete [']quotes
			-- - sr)'  - [S]urround [R]eplace [)] [']
			require("mini.surround").setup()

			-- Vim Session Manager
			require("mini.sessions").setup({
        autoread = true,
        autowrite = false,
      })

			vim.keymap.set("n", "<leader>ls", "<cmd>lua MiniSessions.read(nil)<cr>", { desc = "[L]oad [S]ession" })
			vim.keymap.set("n", "<leader>ns", '<cmd>lua MiniSessions.write(vim.fn.fnamemodify(vim.fn.getcwd(), ":t"), { verbose = true })<cr>', { desc = "[N]oad [S]ession" })

			local group = vim.api.nvim_create_augroup("SessionWrite", { clear = true })

      vim.api.nvim_create_autocmd("VimLeave", {
        group = group,
        callback = function()
          require("mini.sessions").write(vim.fn.fnamemodify(vim.fn.getcwd(), ":t"), { verbose = true })
        end
      })
		end,
	},
}

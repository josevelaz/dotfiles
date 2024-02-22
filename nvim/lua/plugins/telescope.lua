return {
  {
    "nvim-telescope/telescope.nvim",
    branch = "0.1.x",
    dependencies = { { "nvim-lua/plenary.nvim" } },
    opts = {
      extensions = {
        ["ui-select"] = {
          require("telescope.themes").get_dropdown
        }
      },
      defaults = {
        wrap_results = true,
        sorting_strategy = "ascending",
      },
    },
    config = function()
      local builtin = require("telescope.builtin")
      vim.keymap.set("n", "<leader>pf", builtin.find_files, { desc = "Find Files" })
      vim.keymap.set("n", "<C-p>", builtin.git_files, { desc = "Git Files" })
      vim.keymap.set("n", "<leader>ps", function()
        builtin.grep_string({ search = vim.fn.input("Grep < ") })
      end, { desc = "Grep" })
    end,
  },
  {
    "nvim-telescope/telescope-ui-select.nvim",
    -- event = "VeryLazy",
    config = function()
      require("telescope").setup {
        extensions = {
          ["ui-select"] = {
            require("telescope.themes").get_cursor({
              initial_mode = "normal"
            }) 
          }
        }
      }
      -- To get fzf loaded and working with telescope, you need to call
      -- load_extension, somewhere after setup function:
      require("telescope").load_extension("ui-select")

      vim.keymap.set({ "n", "v" }, "<leader>vca", vim.lsp.buf.code_action, { desc = "Code Action" })
    end,
  }
}

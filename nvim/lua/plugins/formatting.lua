return {
  {
    "mfussenegger/nvim-lint",
    config = function()
      local linter = require("lint")
      local js_configuration = { "eslint_d", "cspell" }

      linter.linters_by_ft = {
        lua = { "luacheck", "cspell" },
        markdown = { "vale" },
        json = { "jsonlint", "cspell" },
        javascript = js_configuration,
        javascriptreact = js_configuration,
        typescript = js_configuration,
        typescriptreact = js_configuration,
      }


      local group = vim.api.nvim_create_augroup("Linter", { clear = true })

      vim.api.nvim_create_autocmd({ "InsertLeave", "BufWritePost", "BufEnter" }, {
        group = group,
        callback = function()
          local lint_status, lint = pcall(require, "lint")
          if lint_status then
            lint.try_lint()
          end
        end,
      })
    end,
  },
  {
    "stevearc/conform.nvim",
    config = function(_, opts)
      require('conform').setup(opts)

      vim.api.nvim_create_user_command("Format", function(args)
        local range = nil
        if args.count ~= -1 then
          local end_line = vim.api.nvim_buf_get_lines(0, args.line2 - 1, args.line2, true)[1]
          range = {
            start = { args.line1, 0 },
            ["end"] = { args.line2, end_line:len() },
          }
        end
        require("conform").format({ async = true, lsp_fallback = true, range = range })
      end, { range = true })

      vim.keymap.set(
        "n",
        "<leader>f",
        function()
          require("conform").format({ async = true, lsp_fallback = true })
        end,
        { desc = "Format Buffer" }
      )
    end,
    opts = function()
      local util = require("conform.util")
      local js_configuration = { { "prettierd", "prettier" }, { "eslint_d", "eslint" } }
      return {
        formatters_by_ft = {
          javascript = js_configuration,
          javascriptreact = js_configuration,
          typescript = js_configuration,
          typescriptreact = js_configuration,
          lua = { "stylua" },
          go = { "goimports", "gofmt" },
        },
        format_on_save = { timeout_ms = 500, lsp_fallback = true },
      }
    end,
  },
}

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

      vim.api.nvim_create_autocmd({ "InsertLeave", "BufWritePost" }, {
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
    event = { "BufWritePre" },
    cmd = { "ConformInfo" },
    keys = {
      {
        -- Customize or remove this keymap to your liking
        "<leader>f",
        function()
          require("conform").format({ async = true, lsp_fallback = true })
        end,
        mode = "",
        desc = "Format buffer",
      },
    },
    config = function()
      vim.api.nvim_create_user_command("FormatDisable", function(args)
        if args.bang then
          -- FormatDisable! will disable formatting just for this buffer
          vim.b.disable_autoformat = true
        else
          vim.g.disable_autoformat = true
        end
      end, {
        desc = "Disable autoformat-on-save",
        bang = true,
      })
      vim.api.nvim_create_user_command("FormatEnable", function()
        vim.b.disable_autoformat = false
        vim.g.disable_autoformat = false
      end, {
        desc = "Re-enable autoformat-on-save",
      })
    end,
    -- Everything in opts will be passed to setup()
    opts = function()
      local js_configuration = { { "prettierd", "prettier" } }
      return {
        -- Define your formatters
        formatters_by_ft = {
          javascript = js_configuration,
          javascriptreact = js_configuration,
          typescript = js_configuration,
          typescriptreact = js_configuration,
          lua = { "stylua" },
          go = { "goimports", "gofmt" },
        },
        -- Set up format-on-save
        format_on_save = function(bufnr)
          -- Disable with a global or buffer-local variable
          if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
            return
          end
          return { timeout_ms = 500, lsp_fallback = true }
        end,
        -- Customize formatters
        formatters = {
          shfmt = {
            prepend_args = { "-i", "2" },
          },
        },
      }
    end,
  },
}

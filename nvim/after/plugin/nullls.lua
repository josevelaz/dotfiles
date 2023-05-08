local null_ls = require("null-ls")

local formatting = null_ls.builtins.formatting
local diagnostics = null_ls.builtins.diagnostics
local code_actions = null_ls.builtins.code_actions
local completion = null_ls.builtins.completion
null_ls.setup({
    sources = {
        -- formatting
        formatting.stylua,
        formatting.eslint_d,
        formatting.prettierd.with({
            extra_filetypes = { "svelte" },
            prefer_local = "node_modules/.bin",
        }),
        formatting.sqlfmt,
        formatting.gofmt,
        -- diagnostics
        diagnostics.cspell.with({
            -- Force the severity to be HINT
            diagnostics_postprocess = function(diagnostic)
                diagnostic.severity = vim.diagnostic.severity.HINT
            end,
            config = {
                find_json = function(cwd)
                    return vim.fn.expand("~/dotfiles/nvim/cspell.json")
                end
            },
        }),

        -- code_actions
        code_actions.eslint_d,
        code_actions.cspell.with({
            config = {
                find_json = function(cwd)
                    return vim.fn.expand("~/dotfiles/nvim/cspell.json")
                end
            },
        })
    }
})

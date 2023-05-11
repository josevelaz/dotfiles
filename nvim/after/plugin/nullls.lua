local null_ls = require("null-ls")
local cspell = require("cspell")

local formatting = null_ls.builtins.formatting
local code_actions = null_ls.builtins.code_actions
null_ls.setup({
    sources = {
        -- Diagnostics
        cspell.diagnostics.with({
            diagnostics_postprocess = function(diagnostic)
                diagnostic.severity = vim.diagnostic.severity.HINT
            end,
            find_json = function(cwd)
                return "~/dotfiles/"
            end
        }),
        -- formatting
        formatting.stylua,
        formatting.eslint_d,
        formatting.prettierd.with({
            extra_filetypes = { "svelte" },
            prefer_local = "node_modules/.bin",
        }),
        formatting.sqlfmt,
        formatting.gofmt,
        -- code_actions
        code_actions.eslint_d,
        cspell.code_actions.with({
            find_json = function(cwd)
                return "~/dotfiles/"
            end
        })
    }
})

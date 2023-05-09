local null_ls = require("null-ls")
local cspell = require("cspell")

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
        diagnostics.codespell,
        formatting.sqlfmt,
        formatting.gofmt,
        -- code_actions
        code_actions.eslint_d,
    }
})

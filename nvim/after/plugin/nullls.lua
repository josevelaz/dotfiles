local nls = require("null-ls")
local cspell = require("cspell")

local formatting = nls.builtins.formatting
local code_actions = nls.builtins.code_actions
nls.setup({
    sources = {
        require("typescript.extensions.null-ls.code-actions"), -- Diagnostics
        cspell.diagnostics.with({
            diagnostic_config = {
                virtual_text = false,
            },
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
        formatting.goimports,
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

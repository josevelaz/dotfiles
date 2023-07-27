local nls = require("null-ls")

local formatting = nls.builtins.formatting
local code_actions = nls.builtins.code_actions
nls.setup({
    sources = {
        require("typescript.extensions.null-ls.code-actions"), -- Diagnostics
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
    }
})

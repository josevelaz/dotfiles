local builtin = require('telescope.builtin')
local command_center = require("command_center")
local tl = require('telescope')
vim.keymap.set('n', '<leader>pf', builtin.find_files, { desc = "Find Files" })
vim.keymap.set('n', '<C-p>', builtin.git_files, { desc = "Git Files" })
vim.keymap.set('n', '<leader>ps', function()
    builtin.grep_string({ search = vim.fn.input("Grep < ") });
end, { desc = "Grep" })

command_center.add({
    {
        desc = "Resart LSP Server",
        cmd = "<CMD>LspRestart<CR>",
    },
    {
        desc = "Run the nearest test",
        cmd = "<CMD>lua require('neotest').run.run({ jestCommand = 'jest --watch --runInBand'})<CR>",
    },
    {
        desc = "Run the current file",
        cmd = "<CMD>lua require('neotest').run.run({ vim.fn.expand('%') })<CR>",
    },
    {
        desc = "Stop the nearest test",
        cmd = "<CMD>lua require('neotest').run.stop()<CR>",
    },
    {
        desc = "Debug Nearest Test",
        cmd = "<CMD>require('neotest').run.run({strategy = 'dap'})<CR>",
    },
    {
        desc = "Open Icon Picker",
        cmd = "<CMD>NerdIcons<CR>"
    }
})

tl.load_extension("command_center")
tl.setup {
    extensions = {
        command_center = {
            {
                -- Specify what components are shown in telescope prompt;
                -- Order matters, and components may repeat
                components = {
                    command_center.component.DESC,
                    command_center.component.KEYS,
                    command_center.component.CMD,
                    command_center.component.CATEGORY,
                },
                -- Spcify by what components the commands is sorted
                -- Order does not matter
                sort_by = {
                    command_center.component.DESC,
                    command_center.component.KEYS,
                    command_center.component.CMD,
                    command_center.component.CATEGORY,
                },
                -- Change the separator used to separate each component
                separator = " ",
                -- When set to false,
                -- The description compoenent will be empty if it is not specified
                auto_replace_desc_with_cmd = false,
                -- Default title to Telescope prompt
                prompt_title = "Command Center",
                -- can be any builtin or custom telescope theme
                theme = require("telescope.themes").command_center,
            }
        }
    }
}

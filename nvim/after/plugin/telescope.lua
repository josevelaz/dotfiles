local builtin = require('telescope.builtin')
local tl = require('telescope')
vim.keymap.set('n', '<leader>pf', builtin.find_files, {})
vim.keymap.set('n', '<C-p>', builtin.git_files, {})
vim.keymap.set('n', '<leader>ps', function()
builtin.grep_string({search = vim.fn.input("Grep < ")});
tl.default.file_ignore_pattern({ "node_modules" })
end)

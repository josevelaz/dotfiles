vim.opt.guicursor = ""

vim.opt.nu = true
vim.opt.relativenumber = true

vim.opt.tabstop = 2
vim.opt.softtabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true

vim.opt.smartindent = true

vim.opt.wrap = false

vim.opt.swapfile = false
vim.opt.backup = false
local undodir = os.getenv("HOME") .. "/.vim/undodir"
vim.fn.mkdir(undodir, "p")
vim.opt.undodir = undodir

vim.opt.hlsearch = false
vim.opt.incsearch = true

vim.opt.ignorecase = true
vim.opt.smartcase = true

vim.opt.cursorline = true
vim.opt.cursorlineopt = "number"

vim.opt.termguicolors = true

vim.opt.scrolloff = 12
vim.opt.signcolumn = "yes"
vim.opt.isfname:append("@-@")

vim.opt.updatetime = 50

vim.opt.foldcolumn = "1" -- '0' is not bad
vim.opt.foldlevel = 99 -- Using ufo provider need a large value, feel free to decrease the value
vim.opt.foldlevelstart = 99
vim.opt.foldenable = true
vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]

vim.opt.colorcolumn = "80"

-- vim.opt.spell = true
-- vim.opt.spelllang = { "en_us" }

-- Enable markdown-specific formatting (wrap, linebreak, textwidth) in the autocommands.
-- Set to `false` in your init.lua or before requiring autocommands to disable.
if vim.g.markdown_word_wrap == nil then
  vim.g.markdown_word_wrap = true
end

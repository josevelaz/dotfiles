if vim.g.markdown_word_wrap == false then
  return
end

vim.opt_local.wrap = true
vim.opt_local.linebreak = true
vim.opt_local.breakindent = true
vim.opt_local.colorcolumn = "80"
vim.bo.textwidth = 80

-- ===== Lint ====
local lintGroup = vim.api.nvim_create_augroup("Linter", { clear = true })

vim.api.nvim_create_autocmd({ "InsertLeave", "BufWritePost", "BufEnter" }, {
  group = lintGroup,
  callback = function()
    local lint_status, lint = pcall(require, "lint")
    if lint_status then
      lint.try_lint()
    end
  end,
})

-- ===== Format On Save ====

local formatOnSaveGroup = vim.api.nvim_create_augroup("FormatOnSave", { clear = true })
vim.api.nvim_create_autocmd("BufWritePre", {
  group = formatOnSaveGroup,
  pattern = "*",
  callback = function(args)
    require("conform").format({ bufnr = args.buf })
  end,
})

vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight when yanking (copying) text",
  group = vim.api.nvim_create_augroup("kickstart-highlight-yank", { clear = true }),
  callback = function()
    vim.highlight.on_yank()
  end,
})

-- ==== Misc ====
-- Show errors and warnings in a floating window
-- vim.api.nvim_create_autocmd("CursorHold", {
-- 	callback = function()
-- 		vim.diagnostic.open_float(nil, { focusable = false, source = "if_many" })
-- 	end,
-- })

vim.api.nvim_create_autocmd({ "VimEnter", "VimLeave" }, {
  callback = function()
    if vim.env.TMUX_PLUGIN_MANAGER_PATH then
      vim.uv.spawn(vim.env.TMUX_PLUGIN_MANAGER_PATH .. "/tmux-window-name/scripts/rename_session_windows.py", {})
    end
  end,
})

local md_word_wrap_group = vim.api.nvim_create_augroup("md-word-wrap", { clear = true })

local function apply_markdown_settings(bufnr)
  if vim.g.markdown_word_wrap == false then
    return
  end

  vim.bo[bufnr].textwidth = 80
  vim.bo[bufnr].conceallevel = 0

  for _, winid in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_buf(winid) == bufnr then
      vim.wo[winid].wrap = true
      vim.wo[winid].linebreak = true
      vim.wo[winid].breakindent = true
      vim.wo[winid].colorcolumn = "80"
      vim.wo[winid].conceallevel = 0
    end
  end
end

vim.api.nvim_create_autocmd('FileType', {
  desc = "Sets wordwrap on markdown files to enhance readability",
  pattern = "markdown",
  group = md_word_wrap_group,
  callback = function(args)
    apply_markdown_settings(args.buf)
  end,
})

-- Apply to markdown buffers that were opened before this file was sourced
-- (e.g. the opencode annotator plugin opens via --cmd, which runs before init.lua).
if vim.g.markdown_word_wrap ~= false then
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.bo[bufnr].filetype == "markdown" then
      apply_markdown_settings(bufnr)
    end
  end
end

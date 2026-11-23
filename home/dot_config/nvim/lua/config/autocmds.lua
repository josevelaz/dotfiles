-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Auto-save
-- Writes the buffer when leaving Insert/Replace mode and after Normal-mode
-- changes (dd, x, p, cw, undo, ...). Short debounce so a burst of edits
-- results in one write.
local autosave_group = vim.api.nvim_create_augroup("UserAutoSave", { clear = true })
local autosave_timer ---@type uv.uv_timer_t?
local autosave_buf ---@type integer?

---@param buf integer
local function save(buf)
  if not vim.api.nvim_buf_is_valid(buf) or not vim.api.nvim_buf_is_loaded(buf) then
    return
  end
  -- only real, named file buffers
  if vim.bo[buf].buftype ~= "" or not vim.bo[buf].modifiable or vim.bo[buf].readonly then
    return
  end
  local name = vim.api.nvim_buf_get_name(buf)
  if name == "" or name:match("^%a[%w+.-]*://") then
    return
  end
  -- don't write in the middle of a macro or while another operation is pending
  if vim.fn.reg_recording() ~= "" or vim.fn.reg_executing() ~= "" then
    return
  end

  -- noautocmd: avoid firing BufWritePre/Post (formatters, linters, ...) on every edit
  pcall(vim.api.nvim_buf_call, buf, function()
    vim.cmd("silent! noautocmd write")
  end)
end

local function schedule_save()
  autosave_buf = vim.api.nvim_get_current_buf()
  autosave_timer = autosave_timer or (vim.uv or vim.loop).new_timer()
  autosave_timer:stop()
  autosave_timer:start(
    250,
    0,
    vim.schedule_wrap(function()
      save(autosave_buf)
      autosave_buf = nil
    end)
  )
end

vim.api.nvim_create_autocmd({ "InsertLeave", "TextChanged" }, {
  group = autosave_group,
  callback = schedule_save,
})

-- Flush a pending save before quitting so edits are never lost
vim.api.nvim_create_autocmd("VimLeavePre", {
  group = autosave_group,
  callback = function()
    if autosave_timer and autosave_timer:is_active() then
      autosave_timer:stop()
      save(autosave_buf)
      autosave_buf = nil
    end
  end,
})

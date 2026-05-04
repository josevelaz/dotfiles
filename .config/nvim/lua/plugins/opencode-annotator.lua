-- opencode-annotator.nvim — local Neovim plugin for the opencode plan annotator.
-- Loaded only when the plugin directory exists (workstation-specific checkout).
-- On machines without the checkout this block is a no-op.
local plugin_dir = vim.fn.expand("~/projects/opencode-annotator.nvim/nvim")

if vim.fn.isdirectory(plugin_dir) ~= 1 then
  return {}
end

return {
  dir = plugin_dir,
  name = "opencode-annotator.nvim",
  dependencies = {
    "MunifTanjim/nui.nvim"
  },
}

-- oil.nvim, carried over from the old macOS config (minus its grapple keymap,
-- since grapple did not come along).
return {
  {
    "stevearc/oil.nvim",
    lazy = false,
    keys = {
      { "<leader>pv", "<cmd>Oil<cr>", desc = "Open Oil file explorer" },
    },
    opts = {
      delete_to_trash = true,
      keymaps = {
        ["g?"] = "actions.show_help",
        ["<CR>"] = "actions.select",
        ["<Esc>"] = { "actions.parent", mode = "n" },
        ["<C-r>"] = "actions.refresh",
        ["<C-v>"] = "actions.select_vsplit",
        ["<C-s>"] = "actions.select_split",
        ["<C-t>"] = { "actions.select", opts = { tab = true }, desc = "Open the entry in new tab" },
        ["-"] = "actions.parent",
        ["_"] = "actions.open_cwd",
        ["`"] = "actions.cd",
        ["~"] = { "actions.cd", opts = { scope = "tab" }, desc = ":tcd to the current oil directory" },
        ["gs"] = "actions.change_sort",
        ["gx"] = "actions.open_external",
        ["g."] = "actions.toggle_hidden",
        ["g\\"] = "actions.toggle_trash",
      },
      use_default_keymaps = false,
      view_options = {
        show_hidden = true,
      },
    },
  },
}

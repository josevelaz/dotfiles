-- Keys carried over from the old macOS config that collide with keys LazyVim
-- defines in plugin specs or as buffer-local LSP/treesitter maps. Those
-- LazyVim keys are disabled here so the carried-over ones win.

---@param keys string[]
local function disabled(keys)
  return vim.tbl_map(function(lhs)
    return { lhs, false }
  end, keys)
end

return {
  -- Pickers, as on macOS
  {
    "folke/snacks.nvim",
    keys = {
      { "<leader>sh", function() Snacks.picker.help() end, desc = "[S]earch [H]elp" },
      { "<leader>sk", function() Snacks.picker.keymaps() end, desc = "[S]earch [K]eymaps" },
      {
        "<leader>sf",
        function()
          Snacks.picker.files({ hidden = true, ignored = true, exclude = { "node_modules", ".git", "tmp", "cdk.out" } })
        end,
        desc = "[S]earch [F]iles",
      },
      { "<leader>ss", function() Snacks.picker() end, desc = "[S]earch [S]elect picker" },
      { "<leader>sw", function() Snacks.picker.grep_word() end, desc = "[S]earch current [W]ord" },
      {
        "<leader>sg",
        function()
          Snacks.picker.grep({ hidden = true, exclude = { "node_modules", ".git", "tmp", "cdk.out" } })
        end,
        desc = "[S]earch by [G]rep",
      },
      { "<leader>sr", function() Snacks.picker.resume() end, desc = "[S]earch [R]esume" },
      { "<leader>s.", function() Snacks.picker.oldfiles() end, desc = '[S]earch Recent Files ("." for repeat)' },
      { "<leader>fb", function() Snacks.picker.buffers() end, desc = "[F]ind Existing [B]uffers" },
      { "<leader>/", function() Snacks.picker.grep_buffers() end, desc = "[/] Fuzzily search in open buffers" },
      { "<leader>s/", function() Snacks.picker.grep({ need_search = true }) end, desc = "[S]earch [/] in Open Files" },
      {
        "<leader>sn",
        function() Snacks.picker.files({ dirs = { vim.fn.stdpath("config") } }) end,
        desc = "[S]earch [N]eovim files",
      },
    },
  },

  -- <leader>sr is "resume" above, <leader>sn is "Neovim files", <leader>q is "quit".
  { "MagicDuck/grug-far.nvim", keys = disabled({ "<leader>sr" }) },
  { "folke/noice.nvim", keys = disabled({ "<leader>sn", "<leader>snl", "<leader>snh", "<leader>sna", "<leader>snd", "<leader>snt" }) },
  { "folke/persistence.nvim", keys = disabled({ "<leader>qs", "<leader>qS", "<leader>ql", "<leader>qd" }) },

  -- Buffer-local LSP keys: <leader>ss is the picker list, <M-n>/<M-p> walk quickfix.
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        ["*"] = {
          keys = disabled({ "<leader>ss", "<a-n>", "<a-p>" }),
        },
      },
    },
  },

  -- ]c / [c jump between git hunks instead of classes.
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    opts = function(_, opts)
      local keys = vim.tbl_get(opts, "move", "keys") or {}
      for _, method in ipairs({ "goto_next_start", "goto_next_end", "goto_previous_start", "goto_previous_end" }) do
        if keys[method] then
          keys[method]["]c"] = nil
          keys[method]["[c"] = nil
        end
      end
    end,
  },
  {
    "lewis6991/gitsigns.nvim",
    opts = function(_, opts)
      local lazyvim_on_attach = opts.on_attach
      opts.on_attach = function(buffer)
        if lazyvim_on_attach then
          lazyvim_on_attach(buffer)
        end
        local gs = package.loaded.gitsigns
        vim.keymap.set("n", "<leader>ph", gs.preview_hunk, { buffer = buffer, desc = "[P]review git [H]unk" })
        -- Keep the built-in ]c/[c in diff mode.
        vim.keymap.set({ "n", "v" }, "]c", function()
          if vim.wo.diff then
            return "]c"
          end
          vim.schedule(function() gs.nav_hunk("next") end)
          return "<Ignore>"
        end, { expr = true, buffer = buffer, desc = "Jump to next hunk" })
        vim.keymap.set({ "n", "v" }, "[c", function()
          if vim.wo.diff then
            return "[c"
          end
          vim.schedule(function() gs.nav_hunk("prev") end)
          return "<Ignore>"
        end, { expr = true, buffer = buffer, desc = "Jump to previous hunk" })
      end
    end,
  },
}

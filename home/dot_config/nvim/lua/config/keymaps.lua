-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
--
-- These are the keymaps carried over from the old macOS config. Where they
-- collide with a LazyVim default, these win. Plugin-defined and buffer-local
-- LazyVim keys that collide are turned off in lua/plugins/keymap-overrides.lua.

local map = vim.keymap.set

-- Write the current file with <space><space>
-- (this replaces the default "Find Files (Root Dir)" mapping; <leader>ff still does that)
map("n", "<leader><leader>", "<cmd>write<cr>", { desc = "Save file" })

-- Move the selection up and down
map("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
map("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move line up" })
map("n", "J", "mzJ`z", { desc = "Join lines keeping cursor position" })

-- Keep the cursor centered
map("n", "<C-d>", "<C-d>zz", { desc = "Scroll down and center" })
map("n", "<C-u>", "<C-u>zz", { desc = "Scroll up and center" })
map("n", "n", "nzzzv", { desc = "Next search result centered" })
map("n", "N", "Nzzzv", { desc = "Prev search result centered" })

-- Registers and clipboard
map("x", "<leader>p", [["_dP]], { desc = "Delete selection into void and paste" })
map({ "n", "v" }, "<leader>y", [["+y]], { desc = "Copy into clipboard" })
map("n", "<leader>Y", [["+Y]], { desc = "Copy line to clipboard" })
map("v", "<leader>d", [["_d]], { desc = "Delete into void" })

-- Editing
map("i", "<C-c>", "<Esc>")
map("i", "<C-h>", "<Left>")
map("i", "<C-l>", "<Right>")
map("n", "Q", "<nop>")
map({ "n", "v" }, "<leader>rs", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]], { desc = "Replace word under cursor" })

-- Quickfix (replaces LazyVim's LSP reference jumps on <M-n>/<M-p>)
map("n", "<M-n>", "<cmd>cnext<cr>zz", { desc = "Next quickfix item" })
map("n", "<M-p>", "<cmd>cprev<cr>zz", { desc = "Previous quickfix item" })

-- Buffers and quitting (replace LazyVim's <leader>l Lazy, <leader>q… session keys, <leader>bd)
pcall(vim.keymap.del, "n", "<leader>qq")
map("n", "<leader>q", "<cmd>qa<cr>", { desc = "Quit Neovim" })
map("n", "<leader>bd", "<cmd>bd<cr>", { desc = "Quit buffer" })
map("n", "<leader>l", "<cmd>bnext<cr>", { desc = "Next buffer" })
map("n", "<leader>h", "<cmd>bprev<cr>", { desc = "Previous buffer" })

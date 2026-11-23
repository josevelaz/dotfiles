
local map = vim.keymap.set

map("n", "<leader><leader>", "<cmd>write<cr>", { desc = "Save file" })

map("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
map("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move line up" })
map("n", "J", "mzJ`z", { desc = "Join lines keeping cursor position" })

map("n", "<C-d>", "<C-d>zz", { desc = "Scroll down and center" })
map("n", "<C-u>", "<C-u>zz", { desc = "Scroll up and center" })
map("n", "n", "nzzzv", { desc = "Next search result centered" })
map("n", "N", "Nzzzv", { desc = "Prev search result centered" })

map("x", "<leader>p", [["_dP]], { desc = "Delete selection into void and paste" })
map({ "n", "v" }, "<leader>y", [["+y]], { desc = "Copy into clipboard" })
map("n", "<leader>Y", [["+Y]], { desc = "Copy line to clipboard" })
map("v", "<leader>d", [["_d]], { desc = "Delete into void" })

map("i", "<C-c>", "<Esc>")
map("i", "<C-h>", "<Left>")
map("i", "<C-l>", "<Right>")
map("n", "Q", "<nop>")
map({ "n", "v" }, "<leader>rs", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]], { desc = "Replace word under cursor" })

map("n", "<M-n>", "<cmd>cnext<cr>zz", { desc = "Next quickfix item" })
map("n", "<M-p>", "<cmd>cprev<cr>zz", { desc = "Previous quickfix item" })

pcall(vim.keymap.del, "n", "<leader>qq")
map("n", "<leader>q", "<cmd>qa<cr>", { desc = "Quit Neovim" })
map("n", "<leader>bd", "<cmd>bd<cr>", { desc = "Quit buffer" })
map("n", "<leader>l", "<cmd>bnext<cr>", { desc = "Next buffer" })
map("n", "<leader>h", "<cmd>bprev<cr>", { desc = "Previous buffer" })

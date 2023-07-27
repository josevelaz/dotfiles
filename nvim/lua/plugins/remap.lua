vim.keymap.set("n", "<leader>pv", vim.cmd.Ex)

-- Move selection up and down
-- Like alt + ^/˅
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv", { desc = "move line down" })
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv", { desc = "move line up" })

vim.keymap.set("n", "J", "mzJ`z")
-- page up / down
vim.keymap.set("n", "<C-d>", "<C-d>zz")
vim.keymap.set("n", "<C-u>", "<C-u>zz")
-- search terms in middle
vim.keymap.set("n", "n", "nzzzv")
vim.keymap.set("n", "N", "Nzzzv")

-- greatest remap ever
-- delete selection into void and paste buffer 
vim.keymap.set("x", "<leader>p", [["_dP]], { desc = "delete selection into void and paste" })

-- next greatest remap ever : asbjornHaland
-- copy into clipboard
vim.keymap.set({"n", "v"}, "<leader>y", [["+y]], { desc = "copy into clipboard" })
vim.keymap.set("n", "<leader>Y", [["+Y]])

-- delete into void
vim.keymap.set({"n", "v"}, "<leader>d", [["_d]], { desc = "delete into void" })

-- This is going to get me cancelled
vim.keymap.set("i", "<C-c>", "<Esc>")

vim.keymap.set("n", "Q", "<nop>")
-- switch projects in on window
vim.keymap.set("n", "<C-f>", "<cmd>silent !tmux neww tmux-sessionizer<CR>")
vim.keymap.set("n", "<leader>f", vim.lsp.buf.format)

-- navigation stuff?
vim.keymap.set("n", "<C-k>", "<cmd>cnext<CR>zz")
vim.keymap.set("n", "<C-j>", "<cmd>cprev<CR>zz")
vim.keymap.set("n", "<leader>k", "<cmd>lnext<CR>zz")
vim.keymap.set("n", "<leader>j", "<cmd>lprev<CR>zz")

-- search all and replace
vim.keymap.set("n", "<leader>s", [[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]], { desc = "search and replace" })
-- make bash executable
vim.keymap.set("n", "<leader>x", "<cmd>!chmod +x %<CR>", { silent = true })

vim.keymap.set("n", "<leader>vpp", "<cmd>e ~/.dotfiles/nvim/.config/nvim/lua/dreamzz/packer.lua<CR>", { desc = "packer" });

vim.keymap.set("n", "<leader><leader>", function()
    vim.cmd("so")
end, { desc = "reload file" })

vim.keymap.set("n", "<leader>fc", "<CMD>Telescope command_center<CR>", { desc = "command center" })

vim.keymap.set("n", "<leader>xx", "<cmd>TroubleToggle<cr>",
  {silent = true, noremap = true, desc = "Toggle Trouble"}
)
vim.keymap.set("n", "<leader>xw", "<cmd>TroubleToggle workspace_diagnostics<cr>",
  {silent = true, noremap = true, desc = "Toggle Trouble Workspace Diagnostics"}
)
vim.keymap.set("n", "<leader>xd", "<cmd>TroubleToggle document_diagnostics<cr>",
  {silent = true, noremap = true , desc = "Toggle Trouble Document Diagnostics"}
)
vim.keymap.set("n", "<leader>xl", "<cmd>TroubleToggle loclist<cr>",
  {silent = true, noremap = true, desc = "Toggle Trouble Location List"}
)
vim.keymap.set("n", "<leader>xq", "<cmd>TroubleToggle quickfix<cr>",
  {silent = true, noremap = true, desc = "Toggle Trouble Quickfix"}
)
vim.keymap.set("n", "gR", "<cmd>TroubleToggle lsp_references<cr>",
  {silent = true, noremap = true, desc = "Toggle Trouble References"}
)


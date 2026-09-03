-- Move selection up and down
-- Like alt + ^/˅
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv", { desc = "move line down" })
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv", { desc = "move line up" })

vim.keymap.set("n", "J", "mzJ`z", { desc = "Join lines keeping cursor position" })
-- page up / down
vim.keymap.set("n", "<C-d>", "<C-d>zz", { desc = "Scroll down and center" })
vim.keymap.set("n", "<C-u>", "<C-u>zz", { desc = "Scroll up and center" })
-- search terms in middle
vim.keymap.set("n", "n", "nzzzv", { desc = "Next search result centered" })
vim.keymap.set("n", "N", "Nzzzv", { desc = "Prev search result centered" })

-- delete selection into void and paste buffer
vim.keymap.set("x", "<leader>p", [["_dP]], { desc = "delete selection into void and paste" })

-- copy into clipboard
vim.keymap.set({ "n", "v" }, "<leader>y", [["+y]], { desc = "copy into clipboard" })
vim.keymap.set("n", "<leader>Y", [["+Y]], { desc = "Copy line to clipboard" })

-- delete into void
vim.keymap.set({ "v" }, "<leader>d", [["_d]], { desc = "delete into void", noremap = true })

vim.keymap.set("i", "<C-c>", "<Esc>")

vim.keymap.set("n", "Q", "<nop>")

vim.keymap.set("n", "<M-n>", "<cmd>cnext<cr>zz")
vim.keymap.set("n", "<M-p>", "<cmd>cprev<cr>zz")

-- search all and replace
vim.keymap.set(
	{ "n", "v" },
	"<leader>rs",
	[[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]],
	{ desc = "[S]elected" }
)

-- vim.keymap.set("v", "c", [["_di]])

vim.keymap.set("n", "<leader><leader>", "<cmd>w<cr>", { desc = "Save Buffer", noremap = true })

vim.keymap.set("n", "<leader>q", "<cmd>qa<cr>", { desc = "Quit Neovim", noremap = true })

vim.keymap.set("n", "<leader>bd", "<cmd>bd<cr>", { desc = "Quit Buffer", noremap = true })

vim.keymap.set("n", "<leader>l", "<cmd>bnext<cr>", { desc = "Next buffer" })

vim.keymap.set("n", "<leader>h", "<cmd>bprev<cr>", { desc = "Previous buffer" })

vim.keymap.set("n", "<leader>dvo", "<cmd>DiffviewOpen<cr>")
vim.keymap.set("n", "<leader>dvc", "<cmd>DiffviewClose<cr>")
vim.keymap.set("n", "<leader>dvh", "<cmd>DiffviewFileHistory %<cr>")

vim.keymap.set("i", "<C-h>", "<Left>")
vim.keymap.set("i", "<C-l>", "<Right>")

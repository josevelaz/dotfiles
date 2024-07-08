vim.keymap.set("n", "<leader>pv", "<cmd>Oil<cr>")

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

-- delete selection into void and paste buffer
vim.keymap.set("x", "<leader>p", [["_dP]], { desc = "delete selection into void and paste" })

-- copy into clipboard
vim.keymap.set({ "n", "v" }, "<leader>y", [["+y]], { desc = "copy into clipboard" })
vim.keymap.set("n", "<leader>Y", [["+Y]])

-- delete into void
vim.keymap.set({ "n", "v" }, "<leader>d", [["_d]], { desc = "delete into void" })

vim.keymap.set("i", "<C-c>", "<Esc>")

vim.keymap.set("n", "Q", "<nop>")

vim.keymap.set("n", "<leader>ds", "<cmd>!cp '%:p' '%:p:h/%:t:r-copy.%:e'", { desc = "duplicate current file" })

-- search all and replace
vim.keymap.set(
	{ "n", "v" },
	"<leader>s",
	[[:%s/\<<C-r><C-w>\>/<C-r><C-w>/gI<Left><Left><Left>]],
	{ desc = "search and replace" }
)

-- vim.keymap.set("v", "c", [["_di]])

vim.keymap.set("n", "<leader>k", function()
	vim.diagnostic.open_float({
		border = "rounded",
		scope = "cursor",
		prefix = " ",
		source = true,
	})
end)

vim.keymap.set(
	"n",
	"<leader>xw",
	"<cmd>TroubleToggle workspace_diagnostics<cr>",
	{ silent = true, noremap = true, desc = "Toggle Trouble Workspace Diagnostics" }
)
vim.keymap.set(
	"n",
	"<leader>xd",
	"<cmd>TroubleToggle document_diagnostics<cr>",
	{ silent = true, noremap = true, desc = "Toggle Trouble Document Diagnostics" }
)
vim.keymap.set(
	"n",
	"<leader>xl",
	"<cmd>TroubleToggle loclist<cr>",
	{ silent = true, noremap = true, desc = "Toggle Trouble Location List" }
)
vim.keymap.set(
	"n",
	"<leader>xq",
	"<cmd>TroubleToggle quickfix<cr>",
	{ silent = true, noremap = true, desc = "Toggle Trouble Quickfix" }
)

vim.keymap.set("n", "<leader><leader>", "<cmd>w<cr>", { desc = "Save Buffer", noremap = true })

vim.keymap.set("n", "<leader>q", "<cmd>q<cr>", { desc = "Quit Neovim", noremap = true })

vim.keymap.set("n", "<leader>c", "<cmd>bd<cr>", { desc = "Quit Buffer", noremap = true })

vim.keymap.set("n", "<leader>l", "<cmd>bnext<cr>")

vim.keymap.set("n", "<leader>h", "<cmd>bprev<cr>")

vim.keymap.set("i", "jk", "<esc>")

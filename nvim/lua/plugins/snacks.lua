return {
	"folke/snacks.nvim",
	priority = 1000,
	lazy = false,
	---@type snacks.Config
	opts = {
		picker = {
			enabled = true,
		},
	},
	keys = {
		{
			"<leader>sh",
			function()
				Snacks.picker.help()
			end,
			desc = "[S]earch [H]elp",
		},
		{
			"<leader>sk",
			function()
				Snacks.picker.keymaps()
			end,
			desc = "[S]earch [K]eymaps",
		},
		{
			"<leader>sf",
			function()
				Snacks.picker.files({ hidden = true })
			end,
			desc = "[S]earch [F]iles",
		},
		{
			"<leader>sy",
			function()
				Snacks.picker.lsp_symbols()
			end,
			desc = "[S]earch LSP S[y]mbols",
		},
		{
			"<leader>ss",
			function()
				Snacks.picker()
			end,
			desc = "[S]earch [S]elect Telescope",
		},
		{
			"<leader>sw",
			function()
				Snacks.picker.grep_word()
			end,
			desc = "[S]earch current [W]ord",
		},
		{
			"<leader>sg",
			function()
				Snacks.picker.grep({ hidden = true })
			end,
			desc = "[S]earch by [G]rep",
		},
		{
			"<leader>sd",
			function()
				Snacks.picker.diagnostics()
			end,
			desc = "[S]earch [D]iagnostics",
		},
		{
			"<leader>sr",
			function()
				Snacks.picker.resume()
			end,
			desc = "[S]earch [R]esume",
		},
		{
			"<leader>s.",
			function()
				Snacks.picker.oldfiles()
			end,
			desc = '[S]earch Recent Files ("." for repeat)',
		},
		{
			"<leader>fb",
			function()
				Snacks.picker.buffers()
			end,
			desc = "[F]ind Existing [B]uffers",
		},
		{
			"<leader>/",
			function()
				Snacks.picker.grep_buffers()
			end,
			desc = "[/] Fuzzily search in current buffer",
		},
		{
			"<leader>s/",
			function()
				Snacks.picker.grep({
					need_search = true,
				})
			end,
			desc = "[S]earch [/] in Open Files",
		},
		{
			"<leader>sn",
			function()
				Snacks.picker.files({ dirs = { vim.fn.stdpath("config") } })
			end,
			desc = "[S]earch [N]eovim files",
		},
	},
}

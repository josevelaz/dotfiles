local symbols = require("util.symbols")

return {
	{
		"SmiteshP/nvim-navic",
		requires = "neovim/nvim-lspconfig",
		opts = {
			icons = symbols,
			highlight = true,
		},
	},
}

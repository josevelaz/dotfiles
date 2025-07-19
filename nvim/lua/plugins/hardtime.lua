return {
	"m4xshen/hardtime.nvim",
	lazy = false,
	dependencies = { "MunifTanjim/nui.nvim" },
	opts = {
		max_time = 750,
		max_count = 5,
		callback = function(text)
			local fidget = require("fidget")

			fidget.notify(text, vim.log.levels.WARN)
		end,
	},
}

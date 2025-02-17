return {
	{
		"luukvbaal/statuscol.nvim",
		config = function()
			local builtin = require("statuscol.builtin")
			require("statuscol").setup({
				relculright = true,
				segments = {
					{ text = { " " } },
					{
						sign = {
							namespace = { "diagnostic/signs" },
							maxwidth = 1,
							colwidth = 1,
						},
						click = "v:lua.ScSa",
					},
					{ text = { " " } },
					{
						sign = {
							name = { "Dap" }, -- Will match DapBreakpoint, DapStopped, etc
							maxwidth = 1,
							colwidth = 1,
						},
						click = "v:lua.ScSa",
					},
					{ text = { builtin.lnumfunc, " " }, click = "v:lua.ScLa" },
					{ text = { builtin.foldfunc, " " }, click = "v:lua.ScFa" },
					{ sign = { namespace = { "gitsign" } }, click = "v:lua.ScSa" },
				},
			})
		end,
	},
}

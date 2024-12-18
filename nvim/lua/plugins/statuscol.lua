-- First define the sign
vim.fn.sign_define("DapBreakpoint", {
	text = "●", -- or "•" if you prefer a smaller dot
	texthl = "DapBreakpointSign",
	linehl = "",
	numhl = "",
})

-- Create the highlight group with red color
vim.api.nvim_set_hl(0, "DapBreakpointSign", { fg = "#FF0000" })

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

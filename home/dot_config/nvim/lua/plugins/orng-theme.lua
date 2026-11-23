-- macOS colorscheme: rose-pine with the orng palette from the old macOS config.
-- On Linux, theme.lua (a link to Omarchy's current theme) sets the colorscheme instead.
return {
	{
		"rose-pine/neovim",
		name = "rose-pine",
		opts = {
			dim_inactive_windows = true,
			palette = {
				main = {
					base = "#0a0a0a",
					surface = "#161616",
					overlay = "#242424",
					muted = "#5c5c5c",
					subtle = "#808080",
					text = "#eeeeee",
					love = "#e06c75",
					gold = "#e5c07b",
					rose = "#EE7948",
					pine = "#6ba1e6",
					foam = "#56b6c2",
					iris = "#EC5B2B",
					highlight_low = "#161616",
					highlight_med = "#3a3a3a",
					highlight_high = "#5c5c5c",
				},
			},
			highlight_groups = {
				Comment = { fg = "muted" },
				Keyword = { fg = "iris" },
				String = { fg = "pine" },
				Number = { fg = "rose" },
				Boolean = { fg = "rose" },
				Identifier = { fg = "love" },
				Function = { fg = "foam" },
				Type = { fg = "gold" },
				Operator = { fg = "foam" },
				Delimiter = { fg = "text" },
				["@variable"] = { fg = "love" },
				["@property"] = { fg = "foam" },
				["@keyword"] = { fg = "iris" },
				["@string"] = { fg = "pine" },
				["@type"] = { fg = "gold" },
			},
		},
	},
	{ "LazyVim/LazyVim", opts = { colorscheme = "rose-pine" } },
}

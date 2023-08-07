return {
	{
		"epwalsh/obsidian.nvim",
		dependencies = {
			-- Required.
			"nvim-lua/plenary.nvim",

			-- Optional, for completion.
			"hrsh7th/nvim-cmp",

			"nvim-telescope/telescope.nvim",
		},
		opts = {
			dir = "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main",

			daily_notes = {
				-- Optional, if you keep daily notes in a separate directory.
				folder = "Calendar/Daily",
			},

			-- Optional, completion.
			completion = {
				-- If using nvim-cmp, otherwise set to false
				nvim_cmp = true,
				-- Trigger completion at 2 chars
				min_chars = 2,
				-- Where to put new notes created from completion. Valid options are
				--  * "current_dir" - put new notes in same directory as the current buffer.
				--  * "notes_subdir" - put new notes in the default notes subdirectory.
				new_notes_location = "current_dir",
                prepend_note_id = false
			},
            mappings = {},
			-- Optional, determines whether to open notes in a horizontal split, a vertical split,
			-- or replacing the current buffer (default)
			-- Accepted values are "current", "hsplit" and "vsplit"
			open_notes_in = "vsplit",
		},
	},
}

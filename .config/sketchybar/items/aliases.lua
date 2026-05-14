local colors = require("theme")

-- Application aliases
-- macOS Tahoe (26+): all menu bar items are owned by "Control Center"
-- Run: sketchybar --query default_menu_items   to find current names
-- macOS Tahoe: 3rd-party items lose their names on display 1 (become "Item-0").
-- We target display-1 entries by index so SLS capture works (same display as sketchybar).
-- Run the helper script to refresh indices after app restarts.
local char = sbar.add("alias", "Control Center,Item-0(21)", {
	position = "right",
	background = {
		drawing = false,
		border_width = 0,
		padding_left = -10,
		padding_right = -10,
	},
	click_script = CONFIG_DIR .. "/plugins/char.sh",
})
char:set({ alias = { color = colors.text } })

local wispr = sbar.add("alias", "Control Center,Item-0(24)", {
	position = "right",
	background = {
		drawing = false,
		border_width = 0,
		padding_left = -10,
		padding_right = -10,
	},
	click_script = CONFIG_DIR .. "/plugins/wispr.sh",
})
wispr:set({ alias = { color = colors.text } })

local onepassword = sbar.add("alias", "Control Center,bb3cc23c-6950-4e96-8b40-850e09f46934(22)", {
	position = "right",
	background = {
		drawing = false,
		border_width = 0,
		padding_left = -10,
		padding_right = -10,
	},
})
onepassword:set({ alias = { color = colors.text } })

local fantasical = sbar.add("alias", "Control Center,Fantastical", {
	position = "right",
	background = {
		drawing = false,
		border_width = 0,
		padding_left = -10,
		padding_right = -10,
	},
	click_script = CONFIG_DIR .. "/plugins/fantastical.sh",
})

-- local dato = sbar.add("alias", "Dato,UpcomingEvent", {
--   position = "right",
--   background = {
--     padding_left = -10,
--     padding_right = -10,
--   },
--   click_script = CONFIG_DIR .. "/plugins/dato.sh",
-- })

-- local tunnelblick = sbar.add("alias", "Tunnelblick", {
-- 	position = "right",
-- 	background = {
-- 		drawing = false,
-- 		border_width = 0,
-- 		padding_left = -10,
-- 		padding_right = -10,
-- 	},
-- 	click_script = CONFIG_DIR .. "/plugins/vpn.sh",
-- })

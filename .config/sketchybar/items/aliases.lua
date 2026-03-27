-- Application aliases
local onepassword = sbar.add("alias", "1Password", {
	position = "right",
	background = {
		drawing = false,
		border_width = 0,
		padding_left = -10,
		padding_right = -10,
	},
})

local fantasical = sbar.add("alias", "Fantastical Helper,Fantastical", {
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

-- Application aliases
local onepassword = sbar.add("alias", "1Password", {
  position = "right",
  background = {
    padding_left = -10,
    padding_right = -10,
  },
})

local dato = sbar.add("alias", "Dato,UpcomingEvent", {
  position = "right", 
  background = {
    padding_left = -10,
    padding_right = -10,
  },
  click_script = os.getenv("CONFIG_DIR") .. "/plugins/dato.sh",
})

local tunnelblick = sbar.add("alias", "Tunnelblick", {
  position = "right",
  background = {
    padding_left = -10,
    padding_right = -10,
  },
  click_script = os.getenv("CONFIG_DIR") .. "/plugins/vpn.sh",
})
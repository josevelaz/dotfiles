-- Volume item
local volume = sbar.add("item", "volume", {
  position = "right",
  script = CONFIG_DIR .. "/plugins/volume.sh",
  update_freq = 5,
  background = {
    border_width = 0,
  },
})

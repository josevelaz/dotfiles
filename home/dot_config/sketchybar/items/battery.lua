-- Battery item  
local battery = sbar.add("item", "battery", {
  position = "right",
  update_freq = 120,
  script = CONFIG_DIR .. "/plugins/battery.sh",
  background = {
    border_width = 0,
  },
})

sbar.add("item", "status.separator.time_resources", {
  position = "right",
  width = 12,
  icon = { drawing = false },
  label = { drawing = false },
  background = { drawing = false },
})

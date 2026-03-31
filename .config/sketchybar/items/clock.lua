-- Clock item
local clock = sbar.add("item", "clock", {
  position = "right",
  update_freq = 60,
  icon = {
    drawing = false,
  },
  script = CONFIG_DIR .. "/plugins/clock.sh",
  background = {
    border_width = 0,
  },
})

-- Clock item
local clock = sbar.add("item", "clock", {
  position = "right",
  update_freq = 10,
  icon = {
    drawing = false,
  },
  script = os.getenv("CONFIG_DIR") .. "/plugins/clock.sh",
})
local colors = require("theme")

local cpu = sbar.add("item", "cpu", {
  position = "right",
  update_freq = 5,
  icon = {
    string = "󰻠",
    color = colors.iris,
    padding_left = 2,
  },
  label = {
    color = colors.text,
    padding_right = 2,
  },
  script = CONFIG_DIR .. "/plugins/cpu_ram.sh",
})

local ram = sbar.add("item", "ram", {
  position = "right",
  icon = {
    string = "󰍛",
    color = colors.foam,
    padding_left = 2,
  },
  label = {
    color = colors.text,
    padding_right = 2,
  },
})

sbar.add("item", "status.separator.resources_menu", {
  position = "right",
  width = 12,
  icon = { drawing = false },
  label = { drawing = false },
  background = { drawing = false },
})

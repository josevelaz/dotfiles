local colors = require("theme")

local cpu = sbar.add("item", "cpu", {
  position = "right",
  update_freq = 5,
  icon = {
    string = "󰻠",
    color = colors.iris,
    padding_left = 8,
  },
  label = {
    color = colors.text,
    padding_right = 8,
  },
  script = CONFIG_DIR .. "/plugins/cpu_ram.sh",
})

local ram = sbar.add("item", "ram", {
  position = "right",
  icon = {
    string = "󰍛",
    color = colors.foam,
    padding_left = 8,
  },
  label = {
    color = colors.text,
    padding_right = 8,
  },
})

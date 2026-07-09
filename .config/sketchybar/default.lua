local colors = require("theme")

-- Default properties for all items
sbar.default({
  padding_left = 1,
  padding_right = 1,
  icon = {
    font = "IosevkaTerm Nerd Font:Bold:16.0",
    color = colors.subtle,
    padding_left = 2,
    padding_right = 2,
  },
  label = {
    font = "IosevkaTerm Font:Bold:13.0",
    color = colors.text,
    padding_left = 2,
    padding_right = 2,
  },
  background = {
    height = 24,
    corner_radius = 9,
    color = colors.surface,
    border_color = colors.highlight_med,
    border_width = 0,
  },
})

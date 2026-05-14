local colors = require("theme")

-- Default properties for all items
sbar.default({
  padding_left = 4,
  padding_right = 4,
  icon = {
    font = "IosevkaTerm Nerd Font:Bold:17.0",
    color = colors.subtle,
    padding_left = 4,
    padding_right = 4,
  },
  label = {
    font = "IosevkaTerm Font:Bold:14.0",
    color = colors.text,
    padding_left = 4,
    padding_right = 4,
  },
  background = {
    height = 28,
    corner_radius = 12,
    color = colors.surface,
    border_color = colors.highlight_med,
    border_width = 1,
  },
})

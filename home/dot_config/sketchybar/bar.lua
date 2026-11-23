local colors = require("theme")

-- Bar configuration
sbar.bar({
  position = "top",
  height = 36,
  blur_radius = 24,
  color = colors.bar,
  border_color = colors.bar_border,
  border_width = 1,
  margin = 3,
  corner_radius = 16,
  y_offset = 4,
  padding_left = 6,
  padding_right = 6,
  shadow = true,
  sticky = true,
})

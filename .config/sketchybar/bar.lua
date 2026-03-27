local colors = require("theme")

-- Bar configuration
sbar.bar({
	position = "top",
	height = 44,
	blur_radius = 28,
	color = colors.bar,
	border_color = colors.bar_border,
	border_width = 1,
	margin = 4,
	corner_radius = 10,
	y_offset = 6,
	padding_left = 8,
	padding_right = 8,
	shadow = true,
	sticky = true,
})

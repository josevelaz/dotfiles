local colors = require("theme")

local group_background = {
  drawing = true,
  color = colors.surface,
  border_color = colors.highlight_med,
  border_width = 0,
  corner_radius = 9,
  height = 24,
  padding_left = 2,
  padding_right = 2,
}

local group_margin = {
  padding_left = 2,
  padding_right = 2,
  background = group_background,
}

local function add_gap(name)
  sbar.add("item", name, {
    position = "right",
    width = 4,
    icon = { drawing = false },
    label = { drawing = false },
    background = { drawing = false },
  })
end

add_gap("status.alias_gap.onepassword")
add_gap("status.alias_gap.codex")

-- Keep dense right-side status items visually chunked by purpose.
sbar.add("bracket", "status.time_power", { "clock", "volume", "battery" }, {
  padding_left = group_margin.padding_left,
  padding_right = group_margin.padding_right,
  background = group_margin.background,
})

sbar.add("bracket", "status.resources", { "cpu", "ram" }, {
  padding_left = group_margin.padding_left,
  padding_right = group_margin.padding_right,
  background = group_margin.background,
})

sbar.add("bracket", "status.menu_extras", {
  "Control Center,bb3cc23c-6950-4e96-8b40-850e09f46934",
  "status.alias_gap.onepassword",
  "Control Center,codexbar-codex",
  "Control Center,codexbar-grok",
  "status.alias_gap.codex",
  "Control Center,Fantastical",
}, {
  padding_left = 0,
  padding_right = 0,
  background = {
    drawing = group_background.drawing,
    color = group_background.color,
    border_color = group_background.border_color,
    border_width = group_background.border_width,
    corner_radius = group_background.corner_radius,
    height = group_background.height,
    padding_left = 0,
    padding_right = 0,
  },
})

sbar.add("bracket", "status.media", { "music-artwork", "music" }, {
  padding_left = group_margin.padding_left,
  padding_right = group_margin.padding_right,
  background = {
    drawing = false,
  },
})
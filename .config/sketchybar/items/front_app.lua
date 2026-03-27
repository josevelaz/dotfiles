local colors = require("theme")

local YABAI_BIN = "/usr/local/bin/yabai"

local function current_front_app()
  local handle = io.popen(YABAI_BIN .. " -m query --windows --window 2>/dev/null | jq -r '.app // empty'")
  if not handle then
    return ""
  end

  local app_name = handle:read("*a") or ""
  handle:close()
  return app_name:gsub("%s+$", "")
end

-- Front application display
local front_app = sbar.add("item", "front_app", {
  position = "left",
  drawing = false,
  padding_left = 6,
  padding_right = 10,
  icon = {
    drawing = false,
  },
  label = {
    color = colors.foam,
    max_chars = 32,
    padding_left = 12,
    padding_right = 12,
    font = {
      size = 13,
    },
    align = "center",
  },
  background = {
    drawing = false,
    color = colors.overlay,
    border_color = colors.highlight_high,
    border_width = 1,
    corner_radius = 9,
    height = 26,
  },
})

local function sync_front_app(app_name)
  if not app_name or app_name == "" then
    front_app:set({
      drawing = false,
      background = { drawing = false },
      label = { string = "" },
    })
    return
  end

  front_app:set({
    drawing = true,
    background = { drawing = true },
    label = { string = app_name },
  })
end

sync_front_app(current_front_app())

front_app:subscribe("front_app_switched", function(env)
  sync_front_app(env.INFO)
end)

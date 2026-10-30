local colors = require("theme")

local api = "0.0.0.0:26538/api/v1"
local plugin = CONFIG_DIR .. "/plugins/youtube-music.sh"
local toggle_play = "curl -s -X POST " .. api .. "/toggle-play && " .. plugin
-- "IosevkaTerm Nerd Font" (the global default) isn't installed; use the installed Nerd Font for glyphs
local glyph_font = "Iosevka Nerd Font:Bold:15.0"

-- Music artwork item
local music_artwork = sbar.add("item", "music-artwork", {
  position = "left",
  drawing = false,
  click_script = toggle_play,
  label = {
    padding_right = 2,
  },
  padding_left = 2,
  display = 1,
  width = 32,
  background = {
    border_width = 0,
    image = {
      scale = 0.05,
      corner_radius = 8,
      border_color = 0x00000000, -- TRANSPARENT
    },
    color = 0x00000000,          -- TRANSPARENT
  },
})

-- Music info item (hosts the volume popup)
local music = sbar.add("item", "music", {
  position = "left",
  drawing = false,
  script = plugin,
  click_script = toggle_play,
  label = {
    padding_right = 2,
    font = "IosevkaTerm Font:Bold:13.0",
    string = "Loading…",
    align = "left",
    max_chars = 28,
  },
  display = 1,
  padding_left = 0,
  icon = {
    drawing = false,
  },
  update_freq = 10,
  scroll_texts = true,
  background = {
    border_width = 0,
    image = {
      scale = 0.9,
      corner_radius = 10,
      border_color = 0x00000000, -- TRANSPARENT
    },
    color = 0x00000000,          -- TRANSPARENT
  },
  popup = {
    align = "center",
    y_offset = 6,
    height = 32,
    background = {
      drawing = true,
      color = colors.base,
      border_color = colors.bar_border,
      border_width = 1,
      corner_radius = 12,
    },
  },
})

-- Play/pause toggle (icon reflects the action: pause while playing, play while paused)
local music_play = sbar.add("item", "music-play", {
  position = "left",
  drawing = false,
  display = 1,
  padding_left = 0,
  padding_right = 0,
  icon = { string = "󰐊", font = glyph_font, padding_left = 4, padding_right = 4 },
  label = { drawing = false },
  background = { drawing = false },
  click_script = toggle_play,
})

-- YouTube Music in-app volume slider, shown in the popup under the track while hovering
local volume = sbar.add("slider", "music.volume", 140, {
  position = "popup." .. music.name,
  padding_left = 4,
  padding_right = 8,
  icon = { string = "󰕾", font = glyph_font, color = colors.subtle, padding_left = 6, padding_right = 6 },
  label = { string = "–", font = "Iosevka Nerd Font:Bold:12.0", color = colors.subtle, padding_left = 8, width = 36 },
  background = { drawing = false },
  slider = {
    percentage = 100,
    highlight_color = colors.pine,
    background = { height = 6, corner_radius = 3, color = colors.overlay },
    knob = { string = "󰝥", font = glyph_font, color = colors.text, drawing = true },
  },
})

local function show_volume(level, muted)
  volume:set({
    icon = { string = muted and "󰝟" or "󰕾" },
    label = { string = level .. "%" },
  })
  sbar.animate("tanh", 10, function()
    volume:set({ slider = { percentage = level } })
  end)
end

local function refresh_volume()
  sbar.exec("curl -s -m 2 " .. api .. "/volume", function(info)
    if type(info) ~= "table" or info.state == nil then return end
    show_volume(math.floor(info.state + 0.5), info.isMuted == true)
  end)
end

-- Clicking/dragging the track reports PERCENTAGE; clicking the icon (no PERCENTAGE) toggles mute
volume:subscribe("mouse.clicked", function(env)
  local level = tonumber(env.PERCENTAGE)
  if not level then
    sbar.exec("curl -s -X POST " .. api .. "/toggle-mute", refresh_volume)
    return
  end
  level = math.floor(level + 0.5)
  volume:set({ label = { string = level .. "%" } })
  sbar.exec("curl -s -X POST -H 'Content-Type: application/json' -d '{\"volume\":" .. level .. "}' " .. api .. "/volume")
end)

-- Hover anywhere on the now-playing group opens the popup; leaving the bar (popup included) closes it
for _, item in ipairs({ music_artwork, music, music_play }) do
  item:subscribe("mouse.entered", function()
    refresh_volume()
    music:set({ popup = { drawing = true } })
  end)
  item:subscribe("mouse.exited.global", function()
    music:set({ popup = { drawing = false } })
  end)
end

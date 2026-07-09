-- Music artwork item
local music_artwork = sbar.add("item", "music-artwork", {
  position = "left",
  drawing = false,
  click_script = "curl -s -X POST 0.0.0.0:26538/api/v1/toggle-play && " .. CONFIG_DIR .. "/plugins/youtube-music.sh",
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

-- Music info item
local music = sbar.add("item", "music", {
  position = "left",
  drawing = false,
  script = CONFIG_DIR .. "/plugins/youtube-music.sh",
  click_script = "curl -s -X POST 0.0.0.0:26538/api/v1/toggle-play && " .. CONFIG_DIR .. "/plugins/youtube-music.sh",
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
})

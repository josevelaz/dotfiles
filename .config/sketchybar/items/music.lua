-- Music artwork item
local music_artwork = sbar.add("item", "music-artwork", {
  position = "right",
  click_script = "curl -s -X POST 0.0.0.0:26538/api/v1/toggle-play && " .. os.getenv("CONFIG_DIR") .. "/plugins/youtube-music.sh",
  label = {
    padding_right = 8,
  },
  padding_left = 8,
  display = 1,
  width = 40,
  background = {
    image = {
      scale = 0.05,
      corner_radius = 8,
      border_color = 0x00000000, -- TRANSPARENT
    },
    color = 0x00000000, -- TRANSPARENT
  },
})

-- Music info item
local music = sbar.add("item", "music", {
  position = "right",
  script = os.getenv("CONFIG_DIR") .. "/plugins/youtube-music.sh",
  click_script = "curl -s -X POST 0.0.0.0:26538/api/v1/toggle-play && " .. os.getenv("CONFIG_DIR") .. "/plugins/youtube-music.sh",
  label = {
    padding_right = 8,
    font = "IosevkaTerm Font:Bold:14.0",
    string = "Loading…",
    align = "left",
    max_chars = 40,
  },
  padding_left = 0,
  icon = {
    string = "􁁒",
    padding_left = 36,
    padding_right = 8,
  },
  update_freq = 10,
  scroll_texts = true,
  background = {
    image = {
      scale = 0.9,
      corner_radius = 10,
      border_color = 0x00000000, -- TRANSPARENT
    },
    color = 0x00000000, -- TRANSPARENT
  },
})
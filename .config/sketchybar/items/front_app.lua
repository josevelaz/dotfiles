-- Chevron separator
local chevron = sbar.add("item", "chevron", {
  position = "left",
  icon = {
    string = "",
    font = {
      size = 10.0,
    },
  },
  label = {
    drawing = false,
  },
})

-- Front application display
local front_app = sbar.add("item", "front_app", {
  position = "left",
  icon = {
    drawing = false,
  },
  script = os.getenv("CONFIG_DIR") .. "/plugins/front_app.sh",
})

front_app:subscribe("front_app_switched")
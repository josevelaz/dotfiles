local colors = require("theme")

local alias_background = {
  drawing = false,
  border_width = 0,
  padding_left = 0,
  padding_right = 0,
}

-- Application aliases
-- macOS Tahoe (26+): all menu bar items are owned by "Control Center"
-- Run: sketchybar --query default_menu_items to find current names.
-- SketchyBar v2.24.0 exposes stable names for some 3rd-party items again, but the
-- visible status item is not always the bundle-id entry. Use the queried item that
-- matches the actual menu extra width/placement, not just the prettiest identifier.

local anarlog = sbar.add("alias", "Control Center,com.hyprnote.stable", {
  position = "right",
  padding_left = -18,
  padding_right = 0,
  background = alias_background,
})

local onepassword = sbar.add("alias", "Control Center,bb3cc23c-6950-4e96-8b40-850e09f46934", {
  position = "right",
  padding_left = -18,
  padding_right = 0,
  background = alias_background,
})

local codexbarcodex = sbar.add("alias", "Control Center,codexbar-codex", {
  position = "right",
  padding_left = -18,
  padding_right = 0,
  background = alias_background,
})
local codexbarclaude = sbar.add("alias", "Control Center,codexbar-claude", {
  position = "right",
  padding_left = -18,
  padding_right = 0,
  background = alias_background,
})


local fantastical = sbar.add("alias", "Control Center,Fantastical", {
  position = "right",
  padding_left = 0,
  padding_right = 0,
  background = alias_background,
  click_script = CONFIG_DIR .. "/plugins/fantastical.sh",
})

anarlog:set({ padding_left = -18, padding_right = 0, background = alias_background })
onepassword:set({ padding_left = -18, padding_right = 0, background = alias_background })
codexbarcodex:set({ padding_left = -18, padding_right = 0, background = alias_background })
codexbarclaude:set({ padding_left = -18, padding_right = 0, background = alias_background })
fantastical:set({ padding_left = 0, padding_right = 0, background = alias_background })

-- Volume item
local volume = sbar.add("item", "volume", {
  position = "right",
  script = os.getenv("CONFIG_DIR") .. "/plugins/volume.sh",
})

volume:subscribe("volume_change")
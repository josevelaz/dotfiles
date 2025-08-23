-- Battery item  
local battery = sbar.add("item", "battery", {
  position = "right",
  update_freq = 120,
  script = os.getenv("CONFIG_DIR") .. "/plugins/battery.sh",
})

battery:subscribe("system_woke", "power_source_change")
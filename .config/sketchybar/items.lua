-- Load all item configurations
require("items.spaces")
require("items.clock")
require("items.volume")
require("items.battery")
require("items.cpu_ram")

local enable_aliases = os.getenv("SKETCHYBAR_ENABLE_ALIASES") ~= "0"
if enable_aliases then
  require("items.aliases")
end

require("items.front_app")
require("items.music")

if enable_aliases then
  require("items.groups")
end

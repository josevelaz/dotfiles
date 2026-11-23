package.cpath = package.cpath .. ";/Users/" .. os.getenv("USER") .. "/.local/share/sketchybar_lua/?.so"

local config_dir = os.getenv("CONFIG_DIR")

if not config_dir or config_dir == "" then
  local source = debug.getinfo(1, "S").source
  config_dir = source:match("^@(.+)/helpers/init%.lua$")
end

CONFIG_DIR = config_dir

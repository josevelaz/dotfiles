sbar = require("sketchybar")

-- Bundle the configuration and begin the drawing process
sbar.begin_config()

-- Load modular configuration
require("bar")
require("default")
require("items")

-- Finalize the configuration
sbar.end_config()

-- Run the event loop
sbar.event_loop()

#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Generate Rel
# @raycast.mode fullOutput

# Optional parameters:
# @raycast.icon 🚀
# @raycast.argument1 { "type": "text", "placeholder": "repository" }
# @raycast.argument2 { "type": "text", "placeholder": "pull request #" }

fatt qa:rel-ticket-from-pr -r $1 -p $2

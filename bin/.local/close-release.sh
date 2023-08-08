#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Close Release
# @raycast.mode compact

# Optional parameters:
# @raycast.icon 📦
# @raycast.argument1 { "type": "text", "placeholder": "Release" }

curl --location --request POST "https://automation.atlassian.com/pro/hooks/0f24ee64c02b57e7c1d0647fafb9d4b4dcad2b38?issue=REL-$1"

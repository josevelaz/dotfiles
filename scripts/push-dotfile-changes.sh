#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Push dotfile changes
# @raycast.mode inline
# @raycast.refreshTime 1h

# Optional parameters:
# @raycast.icon ☝🏻
# @raycast.argument1 { "type": "text", "placeholder":"commit message", "optional": true }


# Navigate to the dotfiles directory
cd ~/dotfiles

# Check if there are any changes
if [ -n "$(git status --porcelain)" ]; then
  # Stage the changes
  git add .

  # Commit the changes with either a custom message or a message containing the current date and time
  if [ -n "$1" ]; then
    git commit -m "$1"
  else
    git commit -m "Changes made on $(date)"
  fi

  # Push the changes to the remote repository
  git push
fi


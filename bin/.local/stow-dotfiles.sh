#!/bin/bash

# Script to stow all dotfiles from ~/dotfiles into ~
# Usage: stow-dotfiles.sh [-n]
#   -n: dry-run mode (show what would be done without making changes)

set -e

# Parse command line arguments
DRY_RUN=false

while getopts "n" opt; do
  case $opt in
    n)
      DRY_RUN=true
      ;;
    \?)
      echo "Usage: $0 [-n]" >&2
      echo "  -n: dry-run mode" >&2
      exit 1
      ;;
  esac
done

# Check if stow command is available
if ! command -v stow &> /dev/null; then
  echo "Error: 'stow' command not found. Please install GNU Stow first." >&2
  echo "  On macOS: brew install stow" >&2
  echo "  On Ubuntu/Debian: sudo apt-get install stow" >&2
  exit 1
fi

# Navigate to dotfiles directory
DOTFILES_DIR="$HOME/dotfiles"
if [ ! -d "$DOTFILES_DIR" ]; then
  echo "Error: dotfiles directory not found at $DOTFILES_DIR" >&2
  exit 1
fi

cd "$DOTFILES_DIR"

# Build stow command with appropriate flags (always verbose)
STOW_CMD="stow -d $DOTFILES_DIR -t $HOME -v ."

if [ "$DRY_RUN" = true ]; then
  STOW_CMD="$STOW_CMD -n"
fi

# Execute stow command
echo "Stowing dotfiles from $DOTFILES_DIR to $HOME..."
if [ "$DRY_RUN" = true ]; then
  echo "(DRY RUN - no changes will be made)"
fi

eval $STOW_CMD

if [ "$DRY_RUN" = false ]; then
  echo "✓ Successfully stowed all dotfiles!"
fi

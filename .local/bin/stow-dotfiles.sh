#!/bin/bash

# Stow dotfiles from the repo to $HOME, with optional profile-specific exclusions.
#
# Usage: stow-dotfiles.sh [-n] [--profile macos|ubuntu|server]
#   -n             dry-run mode (show what would be done without making changes)
#   --profile      install profile (default: auto-detected from uname)
#                    macos   — full desktop setup including GUI app config
#                    ubuntu  — headless/VPS; excludes macOS desktop-only config
#                    server  — alias for ubuntu

set -e

# ── Locate repo root dynamically from this script's position ──────────────────
# Script lives at <repo>/.local/bin/stow-dotfiles.sh  →  repo root is two levels up.
# We must resolve symlinks first so the path math is correct when called via a
# stowed symlink (e.g. ~/.local/bin/stow-dotfiles.sh → ../../dotfiles/.local/bin/…).
_script_path="${BASH_SOURCE[0]}"
if [[ "$_script_path" != */* ]]; then
  _script_path="$(command -v -- "$_script_path")"
fi
while [[ -L "$_script_path" ]]; do
  _link_target="$(readlink "$_script_path")"
  if [[ "$_link_target" = /* ]]; then
    _script_path="$_link_target"
  else
    _script_path="$(cd "$(dirname "$_script_path")" && pwd)/$_link_target"
  fi
done
SCRIPT_DIR="$(cd "$(dirname "$_script_path")" && pwd)"
DOTFILES_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STOW_BASE_DIR="$(dirname "$DOTFILES_DIR")"
STOW_PACKAGE="$(basename "$DOTFILES_DIR")"
unset _script_path _link_target

# ── Defaults ──────────────────────────────────────────────────────────────────
DRY_RUN=false
PROFILE=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n)
      DRY_RUN=true
      shift
      ;;
    --profile)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --profile requires a value (macos, ubuntu, server)" >&2
        exit 1
      fi
      PROFILE="$2"
      shift 2
      ;;
    --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [-n] [--profile macos|ubuntu|server]"
      echo "  -n             dry-run mode (no changes made)"
      echo "  --profile      install profile:"
      echo "                   macos   — full desktop setup (default on Darwin)"
      echo "                   ubuntu  — headless/VPS; skips macOS desktop config"
      echo "                   server  — alias for ubuntu"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ── Default profile from OS if not explicitly set ────────────────────────────
if [[ -z "$PROFILE" ]]; then
  if [[ "$(uname)" == "Darwin" ]]; then
    PROFILE="macos"
  else
    PROFILE="ubuntu"
  fi
fi

case "$PROFILE" in
  macos|ubuntu|server) ;;
  *)
    echo "Error: unknown profile '$PROFILE'. Valid profiles: macos, ubuntu, server" >&2
    exit 1
    ;;
esac

# ── Validate dependencies ─────────────────────────────────────────────────────
if ! command -v stow &>/dev/null; then
  echo "Error: 'stow' command not found. Please install GNU Stow first." >&2
  echo "  On macOS:          brew install stow" >&2
  echo "  On Ubuntu/Debian:  sudo apt-get install stow" >&2
  exit 1
fi

if [[ ! -d "$DOTFILES_DIR" ]]; then
  echo "Error: dotfiles directory not found at $DOTFILES_DIR" >&2
  exit 1
fi

if [[ ! -d "$STOW_BASE_DIR/$STOW_PACKAGE" ]]; then
  echo "Error: stow package directory not found at $STOW_BASE_DIR/$STOW_PACKAGE" >&2
  exit 1
fi

# ── Build ignore list based on profile ───────────────────────────────────────
# These directories only make sense on a macOS desktop machine.
# They are excluded from ubuntu/server profiles to avoid leaking
# desktop-only app config onto headless VPS environments.
MACOS_ONLY_DIRS=(sketchybar yabai skhd karabiner ghostty)

STOW_EXTRA_ARGS=()
if [[ "$PROFILE" == "ubuntu" || "$PROFILE" == "server" ]]; then
  for dir in "${MACOS_ONLY_DIRS[@]}"; do
    STOW_EXTRA_ARGS+=(--ignore="$dir")
  done
fi

# ── Execute stow ──────────────────────────────────────────────────────────────
# Run stow from INSIDE the dotfiles directory (package = ".") so that
# the stow dir ($DOTFILES_DIR) differs from the target ($HOME).
# When stow dir == target dir, stow 2.4+ skips the entire package.
cd "$DOTFILES_DIR"

echo "Profile  : $PROFILE"
echo "Repo     : $DOTFILES_DIR"
echo "Target   : $HOME"
if [[ "$DRY_RUN" == true ]]; then
  echo "(DRY RUN — no changes will be made)"
fi
echo ""

STOW_CMD=(stow -d "$DOTFILES_DIR" -t "$HOME" -v "${STOW_EXTRA_ARGS[@]}" .)
if [[ "$DRY_RUN" == true ]]; then
  STOW_CMD+=(-n)
fi

"${STOW_CMD[@]}"

if [[ "$DRY_RUN" == false ]]; then
  echo ""
  echo "✓ Successfully stowed dotfiles (profile: $PROFILE)!"
fi

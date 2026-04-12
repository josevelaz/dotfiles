# Linux-specific shell configuration
# Sourced automatically by .zshrc when running on Linux.

# Ubuntu/Debian installs fd as 'fdfind'; alias to fd if fd is not otherwise available
if command -v fdfind &>/dev/null && ! command -v fd &>/dev/null; then
  alias fd="fdfind"
fi

# xdg-open alias for compatibility (open is macOS-only)
if ! command -v open &>/dev/null && command -v xdg-open &>/dev/null; then
  alias open="xdg-open"
fi

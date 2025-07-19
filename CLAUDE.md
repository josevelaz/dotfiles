# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a personal dotfiles repository containing configuration files for a macOS development environment. The setup uses tools like yabai (window manager), skhd (hotkey daemon), sketchybar (status bar), karabiner (key remapping), neovim, ghostty (terminal), tmux (multiplexer), and various other development tools.

## Key Components and Architecture

### Window Management Stack
- **yabai** (`yabai/yabairc`): Binary space partitioning window manager with mouse support
- **skhd** (`skhd/skhdrc`): Hotkey daemon for window management keybindings
- **aerospace** (`aerospace/`): Alternative window manager configuration
- Configuration files use shell script syntax with specific tool commands

### Status Bar and UI
- **sketchybar** (`sketchybar/sketchybarrc`): Customizable status bar with plugins
- Plugins in `sketchybar/plugins/`: battery, clock, media control, VPN status, etc.
- Uses shell scripting with sketchybar CLI commands

### Keyboard Customization
- **karabiner** (`karabiner/karabiner.json`): Complex key modifications (Caps Lock to Esc/Ctrl)
- Handles Caps Lock → Escape/Control functionality with conditional app-specific behavior

### Terminal and Editor
- **ghostty** (`ghostty/config`): Modern terminal emulator with extensive configuration
  - Uses tokyonight theme, Iosevka font, custom keybindings
  - Configured for macOS with hidden titlebar, option-as-alt behavior
- **tmux** (`tmux/`): Terminal multiplexer for session management
- **neovim** (`nvim/`): Lua-based configuration with lazy.nvim plugin manager
  - Main entry: `nvim/init.lua`
  - Plugin configurations in `nvim/lua/plugins/`
  - Core config in `nvim/lua/config/`

### Development Setup Scripts
- `setup-scripts/`: Brew installation scripts for yabai, skhd, and other tools
- Use `stow` for symlinking configurations to appropriate locations

## Common Commands

### Window Management
```bash
# Restart yabai service
brew services restart yabai

# Reload skhd configuration
brew services restart skhd

# Restart sketchybar
brew services restart sketchybar
```

### Configuration Management
```bash
# Use stow to symlink configurations (from dotfiles root)
stow yabai -t ~/.config/yabai
stow skhd -t ~/.config/skhd
stow sketchybar -t ~/.config/sketchybar

# Install tools via setup scripts
./setup-scripts/setup-yabai.sh
```

### Terminal and Multiplexing
```bash
# Reload ghostty configuration (automatic on config file changes)
# Configuration file: ~/.config/ghostty/config

# List available ghostty themes
ghostty +list-themes

# List available ghostty actions for keybindings
ghostty +list-actions

# Tmux session management
tmux new-session -s <session-name>
tmux attach-session -t <session-name>
tmux list-sessions
```

## Configuration Patterns

### File Structure
- Each tool has its own directory with main config file
- Plugin/script directories for modular functionality
- Setup scripts for automated installation

### Key Mapping Philosophy
- Caps Lock serves dual purpose: Escape on tap, Control on hold (via Karabiner)
- Modal keybindings (resize mode in skhd)
- Vim-style navigation (hjkl) across tools
- Super/Cmd key for most terminal and window operations

### Integration Points
- Sketchybar plugins call external services (YouTube Music API, system info)
- Yabai rules exclude specific applications from tiling
- Shell integration features for enhanced terminal experience
- Tmux provides session persistence and multiplexing within ghostty
- Consistent theming (tokyonight) across terminal and editor

## Important Notes

- This setup requires macOS with Homebrew
- Some tools require accessibility permissions
- Yabai requires System Integrity Protection modifications for advanced features
- Configuration files use shell scripting, Lua, and config-specific formats
- Karabiner is used for keyboard remapping
- Tmux is used for terminal multiplexing and session management within ghostty
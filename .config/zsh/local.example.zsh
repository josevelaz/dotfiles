# Machine-local zsh overrides — NOT committed to the dotfiles repo.
#
# Copy this file to ~/.config/zsh/local.zsh and customise it for this machine.
# It is sourced by .zshrc after secrets are loaded and before any shared config runs.
# Use it for machine-specific paths, secrets, and environment variables.
#
# ~/.config/zsh/local.zsh is gitignored — changes are never accidentally committed.

# ---------------------------------------------------------------------------
# Examples — uncomment and adjust as needed
# ---------------------------------------------------------------------------

# Override the projects root (defaults to ~/projects)
# export PROJECTS="$HOME/my-special-projects"

# Machine-specific API keys or tokens (prefer ~/.zsh_secrets.sh for pure secrets)
# export CONTEXT7_API_KEY="..."
# export GITHUB_TOKEN="..."

# Extra PATH entries only needed on this machine
# export PATH="$HOME/some-local-tool/bin:$PATH"

# Any site-local config that does not belong in the shared baseline

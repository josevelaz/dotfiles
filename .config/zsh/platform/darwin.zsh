# macOS-specific shell configuration
# Sourced automatically by .zshrc when running on Darwin.

# Homebrew mysql-client (not in default Homebrew PATH)
if [[ -d /opt/homebrew/opt/mysql-client/bin ]]; then
  export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"
elif [[ -d /usr/local/opt/mysql-client/bin ]]; then
  export PATH="/usr/local/opt/mysql-client/bin:$PATH"
fi

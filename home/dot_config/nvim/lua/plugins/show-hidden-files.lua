-- Show dotfiles/hidden directories in the picker and the file explorer,
-- while keeping dependency and VCS internals out of the way.

-- Directories that are never interesting to browse or search.
local excluded = {
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".pnpm-store",
  "bower_components",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  "target",
  ".gradle",
  ".next",
  ".nuxt",
  ".turbo",
  ".terraform",
}

return {
  -- File picker + live grep (<leader>ff, <leader>sg, ...)
  {
    "snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = {
            hidden = true, -- dotfiles and hidden dirs
            -- ignored = true, -- ALSO reveal files matched by .gitignore (dist/, coverage/, ...)
            exclude = excluded,
          },
          grep = {
            hidden = true, -- search inside dotfiles too
            -- ignored = true,
            exclude = excluded,
          },
          -- Only used if you switch from neo-tree to Snacks' explorer
          explorer = {
            hidden = true,
            ignored = false, -- still respect .gitignore
          },
        },
      },
    },
  },

  -- Sidebar explorer (<leader>e)
  {
    "nvim-neo-tree/neo-tree.nvim",
    opts = {
      filesystem = {
        filtered_items = {
          hide_dotfiles = false,
          hide_hidden = false, -- Windows hidden attribute
          -- hide_gitignored = false, -- ALSO reveal .gitignore'd files (node_modules included)
          never_show = excluded,
        },
      },
    },
  },
}

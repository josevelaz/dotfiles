-- This file can be loaded by calling `lua require('plugins')` from your init.vim

-- Only required if you have packer configured as `opt`
vim.cmd [[packadd packer.nvim]]

return require('packer').startup(function(use)
  -- Packer can manage itself
  use 'wbthomason/packer.nvim'

  use({
      "andythigpen/nvim-coverage",
      requires = "nvim-lua/plenary.nvim",
      -- Optional: needed for PHP when using the cobertura parser
      rocks = { 'lua-xmlreader' },
      config = function()
          require("coverage").setup()
      end,
  })

  use {
      'tanvirtin/vgit.nvim',
      requires = {
          'nvim-lua/plenary.nvim'
      },
      config = function()
          require('vgit').setup()
      end,
  }
  use 'm4xshen/autoclose.nvim'
  use 'David-Kunz/jester'
  use 'nvim-tree/nvim-web-devicons'
  use 'freddiehaddad/feline.nvim'
  use 'Exafunction/codeium.vim'
  use {
      'nvim-telescope/telescope.nvim', tag = '0.1.1',
      -- or                            , branch = '0.1.x',
      requires = { {'nvim-lua/plenary.nvim'} }
  }

  use('tpope/vim-fugitive')
  use { 'embark-theme/vim', as = 'embark' }
  use('nvim-treesitter/nvim-treesitter', {run = ':TSUpdate'})
  use('theprimeagen/harpoon')
  use('mbbill/undotree')
  use {
  'VonHeikemen/lsp-zero.nvim',
  branch = 'v2.x',
  requires = {
    -- LSP Support
    {'neovim/nvim-lspconfig'},             -- Required
    {                                      -- Optional
      'williamboman/mason.nvim',
      run = function()
        pcall(vim.cmd, 'MasonUpdate')
      end,
    },
    {'williamboman/mason-lspconfig.nvim'}, -- Optional

    -- Autocompletion
    {'hrsh7th/nvim-cmp'},     -- Required
    {'hrsh7th/cmp-nvim-lsp'}, -- Required
    {'L3MON4D3/LuaSnip'},     -- Required
}
}
use('jose-elias-alvarez/null-ls.nvim')
use('MunifTanjim/prettier.nvim')
end)

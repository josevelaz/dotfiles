-- This file can be loaded by calling `lua require('plugins')` from your init.vim

-- Only required if you have packer configured as `opt`
vim.cmd [[packadd packer.nvim]]

return require('packer').startup(function(use)
    -- Packer can manage itself
    use 'wbthomason/packer.nvim'

    use 'davidmh/cspell.nvim'

    use({
        "andythigpen/nvim-coverage",
        requires = "nvim-lua/plenary.nvim",
        -- Optional: needed for PHP when using the cobertura parser
        rocks = { 'lua-xmlreader' },
        config = function()
            require("coverage").setup()
        end,
    })
    -- Lua
    use {
        "folke/which-key.nvim",
        config = function()
            vim.o.timeout = true
            vim.o.timeoutlen = 300
            require("which-key").setup {
                -- your configuration comes here
                -- or leave it empty to use the default settings
                -- refer to the configuration section below
            }
        end
    }
    use {
        "nvim-neotest/neotest",
        requires = {
            "nvim-lua/plenary.nvim",
            "nvim-treesitter/nvim-treesitter",
            "antoinemadec/FixCursorHold.nvim",
            "haydenmeade/neotest-jest",
        },
        config = function()
            require("neotest").setup({
                adapters = {
                    require("neotest-jest")({
                        jestCommand = "jest --watch",
                        env = {
                            test = true
                        }
                    })
                }
            })
        end
    }

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
    use 'nvim-tree/nvim-web-devicons'
    use 'freddiehaddad/feline.nvim'
    use 'Exafunction/codeium.vim'
    require('packer').use({
        'weilbith/nvim-code-action-menu',
        cmd = 'CodeActionMenu',
    })
    use {
        'nvim-telescope/telescope.nvim', tag = '0.1.1',
        -- or                            , branch = '0.1.x',
        requires = { { 'nvim-lua/plenary.nvim' } }
    }

    use('tpope/vim-fugitive')
    use { 'embark-theme/vim', as = 'embark' }
    use('nvim-treesitter/nvim-treesitter', { run = ':TSUpdate' })
    use('theprimeagen/harpoon')
    use('mbbill/undotree')
    use {
        'VonHeikemen/lsp-zero.nvim',
        branch = 'v2.x',
        requires = {
            -- LSP Support
            { 'neovim/nvim-lspconfig' }, -- Required
            {
                -- Optional
                'williamboman/mason.nvim',
                run = function()
                    pcall(vim.cmd, 'MasonUpdate')
                end,
            },
            { 'williamboman/mason-lspconfig.nvim' }, -- Optional

            -- Autocompletion
            { 'hrsh7th/nvim-cmp' },     -- Required
            { 'hrsh7th/cmp-nvim-lsp' }, -- Required
            { 'L3MON4D3/LuaSnip' },     -- Required
        }
    }
    use('jose-elias-alvarez/null-ls.nvim')
    use('RRethy/vim-illuminate')
    use {
        "FeiyouG/command_center.nvim",
        requires = { "nvim-telescope/telescope.nvim" }
    }
    use {
        "https://git.sr.ht/~nedia/auto-save.nvim",
        config = function()
            require("auto-save").setup()
        end
    }
    use 'mfussenegger/nvim-dap'
    use {
        'm4xshen/hardtime.nvim',
        config = function()
            require("hardtime").setup({
                max_time = 1000,
                max_count = 20,
                disable_mouse = true,
                hint = true,
                allow_different_key = false,
                resetting_keys = { "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "c", "d" },
                restricted_keys = { "h", "j", "k", "l", "-", "+", "<UP>", "<DOWN>", "<LEFT>", "<RIGHT>" },
                hint_keys = { "k", "j", "^", "$", "a", "x", "i", "d", "y", "c", "l" },
                disabled_keys = { "<UP>", "<DOWN>", "<LEFT>", "<RIGHT>" },
                disabled_filetypes = { "qf", "netrw", "NvimTree", "lazy", "mason" }
            })
        end
    }
end)

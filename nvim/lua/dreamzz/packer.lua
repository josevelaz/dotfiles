-- This file can be loaded by calling `lua require('plugins')` from your init.vim

-- Only required if you have packer configured as `opt`
vim.cmd [[packadd packer.nvim]]

return require('packer').startup({
    function(use)
        -- Packer can manage itself
        use 'wbthomason/packer.nvim'

        use 'davidmh/cspell.nvim'

        use 'christoomey/vim-tmux-navigator'

        use {
            "folke/trouble.nvim",
            requires = "nvim-tree/nvim-web-devicons",
        }

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
        use "folke/neodev.nvim"
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
        use {
            "epwalsh/obsidian.nvim",
            requires = {
                -- Required.
                "nvim-lua/plenary.nvim",

                -- Optional, for completion.
                "hrsh7th/nvim-cmp",

                "nvim-telescope/telescope.nvim",
            }
        }
        use "lukas-reineke/indent-blankline.nvim"
        use 'm4xshen/autoclose.nvim'
        use 'nvim-tree/nvim-web-devicons'
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
        use('nvim-treesitter/nvim-treesitter', { run = ':TSUpdate' })
        use 'nvim-treesitter/nvim-treesitter-context'
        use 'folke/tokyonight.nvim'
        use {
            'nvim-lualine/lualine.nvim',
            requires = { 'nvim-tree/nvim-web-devicons', opt = true }
        }
        use({ 'glepnir/nerdicons.nvim', cmd = 'NerdIcons', config = function() require('nerdicons').setup({}) end })
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
    end,
    config = {
        luarocks = {
            python_cmd = 'python3' -- Set the python command to use for running hererocks
        }
    }
})

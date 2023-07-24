local plugins = {
    {
        "windwp/nvim-ts-autotag",
        lazy = true,
        opts = {
            filetypes = {
                "html",
                "tsx",
                "jsx",
                "vue",
                "svelte",
                "typescriptreact",
                "javascriptreact",
            },
        },
        config = function()
            require("nvim-ts-autotag").setup()
        end,
    },

    "christoomey/vim-tmux-navigator",

    {
        "folke/trouble.nvim",
        dependencies = "nvim-tree/nvim-web-devicons",
    },

    {
        "andythigpen/nvim-coverage",
        dependencies = "nvim-lua/plenary.nvim",
        -- Optional: needed for PHP when using the cobertura parser
        rocks = { "lua-xmlreader" },
        config = function()
            require("coverage").setup()
        end,
    },
    -- Lua
    "folke/neodev.nvim",
    {
        "folke/which-key.nvim",
        config = function()
            vim.o.timeout = true
            vim.o.timeoutlen = 300
            require("which-key").setup({
                -- your configuration comes here
                -- or leave it empty to the default settings
                -- refer to the configuration section below
            })
        end,
    },
    {
        "nvim-neotest/neotest",
        dependencies = {
            "nvim-lua/plenary.nvim",
            "nvim-treesitter/nvim-treesitter",
            "antoinemadec/FixCursorHold.nvim",
            "haydenmeade/neotest-jest",
        },
        lazy = true,
        config = function()
            require("neotest").setup({
                adapters = {
                    require("neotest-jest")({
                        jestCommand = "jest --watch",
                        env = {
                            test = true,
                        },
                    }),
                },
            })
        end,
    },
    {
        "epwalsh/obsidian.nvim",
        lazy = true,
        dependencies = {
            -- Required.
            "nvim-lua/plenary.nvim",

            -- Optional, for completion.
            "hrsh7th/nvim-cmp",

            "nvim-telescope/telescope.nvim",
        },
    },
    "lukas-reineke/indent-blankline.nvim",
    "m4xshen/autoclose.nvim",
    "nvim-tree/nvim-web-devicons",
    "Exafunction/codeium.vim",
    {
        "weilbith/nvim-code-action-menu",
        cmd = "CodeActionMenu",
    },
    {
        "nvim-telescope/telescope.nvim",
        tag = "0.1.1",
        -- or                            , branch = "0.1.x",
        dependencies = { { "nvim-lua/plenary.nvim" } },
    },

    {
        "tpope/vim-fugitive",
        lazy = true,
    },
    "nvim-treesitter/nvim-treesitter",
    "nvim-treesitter/nvim-treesitter-context",
    "folke/tokyonight.nvim",
    {
        "nvim-lualine/lualine.nvim",
        dependencies = { "nvim-tree/nvim-web-devicons", opt = true },
    },
    {
        "glepnir/nerdicons.nvim",
        cmd = "NerdIcons",
        config = function()
            require("nerdicons").setup({})
        end,
    },
    "theprimeagen/harpoon",
    {
        "mbbill/undotree",
        lazy = true,
    },

    "jose-elias-alvarez/typescript.nvim",
    "ray-x/go.nvim",

    {
        "VonHeikemen/lsp-zero.nvim",
        branch = "v2.x",
        dependencies = {
            -- LSP Support
            { "neovim/nvim-lspconfig" }, -- Required
            {
                -- Optional
                "williamboman/mason.nvim",
                run = function()
                    pcall(vim.cmd, "MasonUpdate")
                end,
            },
            { "williamboman/mason-lspconfig.nvim" }, -- Optional

            -- Autocompletion
            { "hrsh7th/nvim-cmp" }, -- Required
            { "hrsh7th/cmp-nvim-lsp" }, -- Required
            { "L3MON4D3/LuaSnip" }, -- Required
        },
    },
    "jose-elias-alvarez/null-ls.nvim",
    "RRethy/vim-illuminate",
    {
        "FeiyouG/command_center.nvim",
        lazy = true,
        dependencies = { "nvim-telescope/telescope.nvim" },
    },
    "Pocco81/auto-save.nvim",

    {
        "mfussenegger/nvim-dap",
        lazy = true,
    },
}

require("lazy").setup(plugins)

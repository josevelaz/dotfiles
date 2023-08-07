return {
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
    },

    "christoomey/vim-tmux-navigator",

    "cohama/lexima.vim",
    {
        "folke/trouble.nvim",
        dependencies = "nvim-tree/nvim-web-devicons",
    },

    {
        "andythigpen/nvim-coverage",
        dependencies = "nvim-lua/plenary.nvim",
        -- Optional: needed for PHP when using the cobertura parser
        rocks = { "lua-xmlreader" },
    },
    -- Lua
    "folke/neodev.nvim",
    {
        "folke/which-key.nvim",
        event = "VeryLazy",
        init = function()
            vim.o.timeout = true
            vim.o.timeoutlen = 300
        end,
        opts = {
            -- your configuration comes here
            -- or leave it empty to use the default settings
            -- refer to the configuration section below
        }
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
    },
    {
        "lukas-reineke/indent-blankline.nvim",
        opts = {
            space_char_blankline = " ",
            show_current_context = true,
            show_current_context_start = true,

        }
    },
    { 'kosayoda/nvim-lightbulb', opts = {autocmd = { enabled = true }  } },
    "m4xshen/autoclose.nvim",
    "nvim-tree/nvim-web-devicons",
    "Exafunction/codeium.vim",
    'weilbith/nvim-code-action-menu',
    {
        "nvim-telescope/telescope.nvim",
        tag = "0.1.1",
        -- or                            , branch = "0.1.x",
        dependencies = { { "nvim-lua/plenary.nvim" } },
    },

    "tpope/vim-fugitive",
    {
        "folke/tokyonight.nvim",
        lazy = false,    -- make sure we load this during startup if it is your main colorscheme
        priority = 1000, -- make sure to load this before all the other start plugins
        config = function()
            -- load the colorscheme here
            vim.cmd([[colorscheme tokyonight]])
        end,
    },
    {
        "nvim-lualine/lualine.nvim",
        opts = {
            theme = "tokyonight",
        },
        dependencies = { "nvim-tree/nvim-web-devicons", opt = true },
    },
    {
        "glepnir/nerdicons.nvim",
        cmd = "NerdIcons",
    },
    "theprimeagen/harpoon",
    {
        "mbbill/undotree",
        lazy = true,
    },

    "jose-elias-alvarez/typescript.nvim",
    "ray-x/go.nvim",
    "nvim-treesitter/nvim-treesitter-context",
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
            { "hrsh7th/nvim-cmp" },     -- Required
            { "hrsh7th/cmp-nvim-lsp" }, -- Required
            { "L3MON4D3/LuaSnip" },     -- Required
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

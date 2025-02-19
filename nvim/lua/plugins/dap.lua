-- -- First define the sign
vim.fn.sign_define("DapBreakpoint", {
	text = "●", -- or "•" if you prefer a smaller dot
	texthl = "DapBreakpointHl",
	linehl = "",
	numhl = "",
})
vim.fn.sign_define("DapBreakpointLog", {
	text = "", -- or "•" if you prefer a smaller dot
	texthl = "DapBreakpointLogHl",
	linehl = "",
	numhl = "",
})
vim.fn.sign_define("DapBreakpointCondition", {
	text = "", -- or "•" if you prefer a smaller dot
	texthl = "DapBreakpointConditionHl",
	linehl = "",
	numhl = "",
})
vim.fn.sign_define("DapBreakpointRejected", {
	text = "", -- or "•" if you prefer a smaller dot
	texthl = "DapBreakpointRejectedHl",
	linehl = "",
	numhl = "",
})
vim.fn.sign_define("DapStopped", {
	text = "", -- or "•" if you prefer a smaller dot
	texthl = "DapStoppedHl",
	linehl = "",
	numhl = "",
})

return {
	{
		"mfussenegger/nvim-dap",
		dependencies = {
			-- Fancy UI for the debugger
			"nvim-neotest/nvim-nio",
			{
				"rcarriga/nvim-dap-ui",
				keys = {
					{
						"<leader>de",
						function()
							-- Calling this twice to open and jump into the window.
							require("dapui").eval()
							require("dapui").eval()
						end,
						desc = "Evaluate expression",
					},
				},
				opts = {
					floating = { border = "rounded" },
					layouts = {
						{
							elements = {
								{ id = "stacks", size = 0.30 },
								{ id = "breakpoints", size = 0.20 },
								{ id = "scopes", size = 0.50 },
							},
							position = "left",
							size = 60,
						},
					},
				},
			},
			-- Virtual text.
			{
				"theHamsta/nvim-dap-virtual-text",
				opts = { virt_text_pos = "eol" },
			},
		},
		keys = {
			{
				"<leader>db",
				function()
					require("dap").toggle_breakpoint()
				end,
				desc = "Toggle breakpoint",
			},
			{
				"<leader>dl",
				function()
					require("dap").set_breakpoint(nil, nil, vim.fn.input("Log Message: "))
				end,
				desc = "List breakpoints",
			},
			{
				"<leader>dB",
				function()
					require("dap").list_breakpoints()
				end,
				desc = "List breakpoints",
			},
			{
				"<leader>dc",
				function()
					require("dap").set_breakpoint(vim.fn.input("Breakpoint condition: "))
				end,
				desc = "Breakpoint condition",
			},
			{
				"<F5>",
				function()
					require("dap").continue()
				end,
				desc = "Continue",
			},
			{
				"<F10>",
				function()
					require("dap").step_over()
				end,
				desc = "Step over",
			},
			{
				"<F11>",
				function()
					require("dap").step_into()
				end,
				desc = "Step into",
			},
			{
				"<F12>",
				function()
					require("dap").step_out()
				end,
				desc = "Step Out",
			},
		},
		config = function()
			local dap = require("dap")
			local dapui = require("dapui")

			-- Automatically open the UI when a new debug session is created.
			dap.listeners.after.event_initialized["dapui_config"] = function()
				dapui.open({})
			end
			dap.listeners.before.event_terminated["dapui_config"] = function()
				dapui.close({})
			end
			dap.listeners.before.event_exited["dapui_config"] = function()
				dapui.close({})
			end

			dap.adapters["pwa-node"] = {
				type = "server",
				host = "::1",
				port = "${port}",
				executable = {
					command = vim.fn.stdpath("data") .. "/mason/bin/js-debug-adapter",
					args = {
						"${port}",
					},
				},
			}

			dap.configurations["typescript"] = {
				{
					type = "pwa-node",
					request = "launch",
					name = "Run and Attach",
					program = "${workspaceFolder}/ace.js",
					args = { "serve", "--hmr" },
					skipFiles = { "<node_internals>/**" },
					cwd = "${workspaceFolder}",
				},
				{
					type = "pwa-node",
					request = "attach",
					name = "Attach",
					processId = require("dap.utils").pick_process,
					skipFiles = { "<node_internals>/**" },
					cwd = "${workspaceFolder}",
				},
			}
		end,
	},
}

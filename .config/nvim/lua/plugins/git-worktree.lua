local Hooks = require("git-worktree.hooks")
local update_on_switch = Hooks.builtins.update_current_buffer_on_switch

local fidget = require("fidget")

Hooks.register(Hooks.type.CREATE, function(path, branch, upstream)
	local root_path = vim.system({ "git", "rev-parse", "--git-common-dir" }):wait().stdout
	root_path = vim.trim(root_path or "")

	if root_path == "." then
		root_path = ".."
	end

	local env_master = string.format("%s/.env", root_path)

	local env_current = string.format("%s/.env", path)

	local link_cmd = { "ln", "-s", env_master, env_current }

	vim.system(link_cmd):wait()

	fidget.notify("Linked .env to worktree", vim.log.levels.INFO, {
		ttl = 10,
	})

	local progressHandler = fidget.progress.handle.create({
		title = "Installing Dependencies",
		message = "npm install",
		percentage = 0,
	})

	local on_install_finish = function(install_output)
		if install_output.code == 1 then
			progressHandler:report({
				title = "Error Installing Dependencies",
				message = "An error occurred installing dependencies",
				done = true,
			})
		end

		progressHandler:report({
			title = "Finished Installing Dependencies",
			done = true,
		})
	end

	vim.system({ "npm", "install" }, { text = true, cwd = path }, on_install_finish)
end)

Hooks.register(Hooks.type.SWITCH, function(path, prev_path)
	local formatPath = function(fullPath)
		local last_two = fullPath:match("([^/]+/[^/]+)$")
		return last_two
	end
	fidget.notify(
		"Moved from " .. formatPath(prev_path) .. " to " .. formatPath(path),
		vim.log.levels.WARN,
		{ ttl = 10 }
	)

	local buf = vim.api.nvim_get_current_buf()

	local ft = vim.api.nvim_get_option_value("filetype", {
		buf = buf,
	})

	if ft == "oil" then
		local oil = require("oil")
		local oil_actions = require("oil.actions")

		oil_actions.refresh.callback()
		oil.open(path)
		return
	end

	update_on_switch(path, prev_path)
end)

return {
	"polarmutex/git-worktree.nvim",
	version = "*",
	-- require plenary and snacks picker
	dependencies = { "nvim-lua/plenary.nvim", "folke/snacks.nvim" },
	-- keybindings to invoke snacks pickers directly
	keys = {
		{
			"<leader>sT",
			function()
				require("git-worktree").create_worktree()
			end,
			desc = "Git Worktree: Create",
		},
		{
			"<leader>st",
			function()
				require("snacks.picker").switch_worktree()
			end,
			desc = "Git Worktree: Switch/Delete",
		},
	},
	config = function()
		if Snacks and pcall(require, "snacks.picker") then
			Snacks.picker.sources.create_worktree = new_worktree
			Snacks.picker.sources.switch_worktree = switch_worktree
		end
	end,
}

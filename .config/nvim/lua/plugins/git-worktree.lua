local worktree = require("git-worktree")
-- Toggle for forced deletion (optional)
local force_next_deletion = false

local get_worktree_path_cmd = { "git", "rev-parse", "--path-format=absolute", "--git-common-dir" }

---@type snacks.picker.Config
local new_worktree = {
	title = "Create Git Worktree",
	finder = "git_branches",
	format = "git_branch",
	preview = "git_log",
	matcher = {
		fuzzy = false,
	},
	win = {
		list = { keys = {
			["<tab>"] = "confirm",
			["<CR>"] = "confirm",
		} },
	},
}

---@param picker snacks.Picker
---@param item? snacks.picker.Item
function new_worktree.confirm(picker, item)
	picker:close()

	local branch_name = picker.finder.filter.pattern
	if item ~= nil then
		branch_name = item.branch
	end

	local root_path = vim.trim(vim.system(get_worktree_path_cmd):wait().stdout) .. "/"

	local path_with_branch = root_path .. branch_name

	worktree.create_worktree(path_with_branch, branch_name, "origin/master")
end

---@type snacks.picker.Config
local switch_worktree = {
	title = "Git Worktrees",
	preview = "preview",
	matcher = {
		fuzzy = false,
	},
	focus = "list",
	-- core actions: switch (confirm), delete, create
	actions = {
		-- delete selected worktree(s)
		delete = {
			desc = "Delete worktree(s)",
			action = function(picker)
				-- collect selected worktrees, fallback to current
				local items = picker:selected({ fallback = false })
				if #items == 0 then
					items = { picker:current() }
				end
				-- confirmation
				local prompt
				if #items > 1 then
					prompt = string.format("Delete %d worktrees?", #items)
				else
					prompt = string.format("Delete worktree '%s'?", items[1].path)
				end
				if vim.fn.confirm(prompt, "&Yes\n&No", 2) ~= 1 then
					return
				end
				-- delete each selected worktree
				for _, item in ipairs(items) do
					worktree.delete_worktree(item.path, force_next_deletion)
				end
				picker:update({ refresh = true })
				force_next_deletion = false
			end,
		},
	},
	win = {
		input = {
			keys = {
				["<c-d>"] = "delete",
			},
		},
		list = {
			keys = {
				["<c-d>"] = "delete",
			},
		},
	},
}

---@type snacks.picker.finder
function switch_worktree.finder(_, _)
	-- Fetch worktrees via Git porcelain output
	local lines = vim.fn.systemlist("git worktree list --porcelain")
	local worktrees = {}
	local current = {}

	for _, line in ipairs(lines) do
		local key, val = line:match("^(%w+)%s*(.*)$")

		if key == "worktree" then
			if current.path and not current.bare then
				table.insert(worktrees, current)
			end
			current = { path = val }
		elseif key == "HEAD" then
			current.sha = val
		elseif key == "branch" then
			current.branch = val:match("^refs/heads/(.+)$") or val
		elseif key == "bare" then
			current.bare = true
		end
	end

	if current.path then
		table.insert(worktrees, current)
	end

	---@async
	---@param cb async fun(item: snacks.picker.finder.Item)
	return function(cb)
		for i, wt in ipairs(worktrees) do
			local item = {
				idx = i,
				text = wt.branch or wt.sha or wt.path,
				file = wt.path,
				path = wt.path,
				branch = wt.branch,
				sha = wt.sha,
				preview = { text = wt.path .. "\t" .. (wt.branch or "") .. "\t" .. (wt.sha or "") },
			}
			cb(item)
		end
	end
end

---@param item snacks.picker.Item
---@param picker snacks.Picker
function switch_worktree.format(item, picker)
	local ret = {} --@type snacks.picker.Highlight[]
	ret[#ret + 1] = { item.branch, "SnacksPickerGitBranch" }
	ret[#ret + 1] = { " " }

	local file_name = Snacks.picker.format.filename(item, picker)
	vim.list_extend(ret, file_name)
	return ret
end

---@param picker snacks.Picker
---@param item? snacks.picker.Item
function switch_worktree.confirm(picker, item)
	picker:close()

	if item ~= nil then
		worktree.switch_worktree(item.file)
	end
end

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
	version = "^2",
	-- require plenary and snacks picker
	dependencies = { "nvim-lua/plenary.nvim", "folke/snacks.nvim" },
	-- keybindings to invoke snacks pickers directly
	keys = {
		{
			"<leader>sT",
			function()
				require("snacks.picker").create_worktree()
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

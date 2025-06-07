local worktree = require("git-worktree")

---@type snacks.picker.Config
local new_worktree = {
	title = "New Worktree",
	finder = "git_branches",
	format = "git_branch",
	preview = "git_log",
}

---@param picker snacks.Picker
---@param item? snacks.picker.Item
function new_worktree.confirm(picker, item)
	picker:close()

	local existing_branch = false
	local branch_name = picker.finder.filter.pattern
	if item ~= nil then
		existing_branch = true
		branch_name = item.branch
	end

	vim.print(branch_name, existing_branch and branch_name or "master")

	worktree.create_worktree(branch_name, existing_branch and branch_name or "master")
end

---@type snacks.picker.Config
local switch_worktree = {
	title = "Worktrees",
	preview = "preview",
}

---@type snacks.picker.finder
function switch_worktree.finder(_, _)
	-- Fetch worktrees via Git porcelain output
	local lines = vim.fn.systemlist("git worktree list --porcelain")
	local worktrees = {}
	local current = {}
	for _, line in ipairs(lines) do
		local key, val = line:match("^(%w+)%s+(.+)$")
		if key == "worktree" then
			if current.path then
				table.insert(worktrees, current)
			end
			current = { path = val }
		elseif key == "HEAD" then
			current.sha = val
		elseif key == "branch" then
			current.branch = val:match("^refs/heads/(.+)$") or val
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
local config = require("git-worktree.config")
local update_on_switch = Hooks.builtins.update_current_buffer_on_switch

Hooks.register(Hooks.type.SWITCH, function(path, prev_path)
	vim.notify("Moved from " .. prev_path .. " to " .. path)
	update_on_switch(path, prev_path)
end)

return {
	"polarmutex/git-worktree.nvim",
	version = "^2",
	dependencies = { "nvim-lua/plenary.nvim" },
	config = function()
		if Snacks and pcall(require, "snacks.picker") then
			Snacks.picker.sources.create_worktree = new_worktree
			Snacks.picker.sources.switch_worktree = switch_worktree
		end
	end,
}

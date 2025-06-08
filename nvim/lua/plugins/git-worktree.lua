local worktree = require("git-worktree")
-- Toggle for forced deletion (optional)
local force_next_deletion = false

---@type snacks.picker.Config
local new_worktree = {
	title = "Create Git Worktree",
	finder = "git_branches",
	format = "git_branch",
	preview = "git_log",
	-- confirm creates: prompt for branch (or use pattern), then create under same name
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

	local existing_branch = false
	local branch_name = picker.finder.filter.pattern
	if item ~= nil then
		existing_branch = true
		branch_name = item.branch
	end

	local root_path = vim.trim(vim.fn.system("git rev-parse --absolute-git-dir")) .. "/"

	vim.print(root_path)

	worktree.create_worktree(root_path .. branch_name, existing_branch and branch_name or "master")
end

---@type snacks.picker.Config
local switch_worktree = {
	title = "Git Worktrees",
	preview = "preview",
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
		-- create a new worktree via new_worktree source
		create = {
			desc = "Create worktree",
			action = function(picker)
				picker:close()
				require("snacks.picker").create_worktree()
			end,
		},
		-- toggle forced deletion on next delete
		force = {
			desc = "Toggle force deletion",
			action = function()
				force_next_deletion = not force_next_deletion
				if force_next_deletion then
					vim.print("Next deletion will be forced")
				else
					vim.print("Next deletion will be normal")
				end
			end,
		},
	},
	-- keymap in list window: m-d delete, m-c create, c-f force
	win = {
		list = {
			keys = {
				["<CR>"] = "confirm",
				["<M-d>"] = "delete",
				["<M-c>"] = "create",
				["<C-f>"] = "force",
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
	-- require plenary and snacks picker
	dependencies = { "nvim-lua/plenary.nvim", "folke/snacks.nvim" },
	-- keybindings to invoke snacks pickers directly
	keys = {
		{
			"<leader>gW",
			function()
				require("snacks.picker").create_worktree()
			end,
			desc = "Git Worktree: Create",
		},
		{
			"<leader>gw",
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

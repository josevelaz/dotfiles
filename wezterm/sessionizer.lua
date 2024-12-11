local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

---The base folders in which to retrieve their children
local workspaces = {}

---Run a desired command
---@param cmd string
---@return string
local command_run = function(cmd)
	local stdout

	_, stdout, _ = wezterm.run_child_process({
		os.getenv("SHELL"),
		"-c",
		cmd,
	})

	return stdout
end

---Retrieve the directories found within the base_path table
---@return { id: string, label: string }[]
local get_directories = function()
	local folders = {}

	for _, base_path in ipairs(workspaces) do
		local command = "find " .. base_path .. " -mindepth 1 -maxdepth 1 -type d"
		local out = command_run(command)

		for _, path in ipairs(wezterm.split_by_newlines(out)) do
			local updated_path = string.gsub(path, wezterm.home_dir, "~")
			table.insert(folders, { id = path, label = updated_path })
		end
	end

	return folders
end

---The switching between workspaces
function M.switch_workspace()
	return wezterm.action_callback(function(window, pane)
		local workspaces = get_directories()

		window:perform_action(
			act.InputSelector({
				action = wezterm.action_callback(function(inner_window, inner_pane, id, label)
					if not id and not label then
						-- INFO: Do nothing
					else
						local full_path = string.gsub(label, "^~", wezterm.home_dir)

						if full_path:sub(1, 1) == "/" or full_path:sub(3, 3) == "\\" then
							inner_window:perform_action(
								act.SwitchToWorkspace({
									name = label,
									spawn = {
										label = "Workspace: " .. label,
										cwd = full_path,
									},
								}),
								inner_pane
							)
						else
							inner_window:perform_action(
								act.SwitchToWorkspace({
									name = id,
								}),
								inner_pane
							)
						end
					end
				end),
				title = "Wezterm Sessionizer",
				choices = workspaces,
				fuzzy = true,
				fuzzy_description = "Switch To Workspace: ",
			}),
			pane
		)
	end)
end

---List the active workspaces
function M.active_workspaces()
	return act.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" })
end

---Configure the default key bindings
---@param config table
function M.configure(config)
	table.insert(config.keys, {
		key = "f",
		mods = "CTRL",
		action = M.switch_workspace(),
	})

	table.insert(config.keys, {
		key = "s",
		mods = "LEADER",
		action = M.active_workspaces(),
	})
end

---Configure the project paths
---@param paths table
function M.set_workspaces(paths)
	workspaces = paths
end

return M

local sbar = require("sketchybar")
local colors = require("theme")

local MAX_APP_SLOTS = 5
local APP_ITEM_WIDTH = 28
local APP_INNER_PADDING = 2
local GROUP_HORIZONTAL_PADDING = 4
local GROUP_VERTICAL_HEIGHT = 28
local EMPTY_SPACE_OUTER_GAP = 12
local OCCUPIED_SPACE_GAP = 12
local YABAI_BIN = "/usr/local/bin/yabai"

local spaces = {}

local function sync_space_item(space_data)
	local show_space_number = #(space_data.apps or {}) == 0

	space_data.item:set({
		drawing = show_space_number,
		icon = {
			drawing = show_space_number,
			color = space_data.selected and colors.base or colors.subtle,
			highlight = false,
			highlight_color = space_data.selected and colors.base or colors.subtle,
		},
		background = {
			drawing = show_space_number,
			color = space_data.selected and colors.rose or colors.highlight_low,
			border_color = space_data.selected and colors.iris or colors.highlight_med,
		},
	})
end

local function sync_space_group(space_data)
	local show_group = #(space_data.apps or {}) > 0

	space_data.group:set({
		drawing = show_group,
		background = {
			drawing = show_group,
			color = space_data.selected and colors.overlay or colors.surface,
			border_color = space_data.selected and colors.iris or colors.highlight_med,
			border_width = 1,
			corner_radius = 10,
			height = GROUP_VERTICAL_HEIGHT,
			padding_left = GROUP_HORIZONTAL_PADDING,
			padding_right = GROUP_HORIZONTAL_PADDING,
		},
	})

	space_data.spacer:set({ drawing = show_group })
end

local function set_space_state(space_data, selected)
	space_data.selected = selected
	sync_space_item(space_data)
	sync_space_group(space_data)
end

local function hide_app_item(item)
	item:set({ drawing = false })
end

local function set_app_item(item, app_name)
	item:set({
		drawing = true,
		padding_left = APP_INNER_PADDING,
		padding_right = APP_INNER_PADDING,
		background = {
			drawing = true,
			color = colors.none,
			border_width = 0,
			height = 26,
			image = {
				drawing = true,
				string = "app." .. app_name,
				scale = 0.72,
				padding_left = 2,
			},
		},
		image = {
			drawing = false,
		},
		label = {
			drawing = false,
		},
	})
end

local function set_overflow_item(item, overflow_count, selected, is_last)
	item:set({
		drawing = true,
		padding_left = APP_INNER_PADDING,
		padding_right = APP_INNER_PADDING,
		background = {
			drawing = true,
			color = colors.none,
			border_width = 0,
			height = 26,
			image = {
				drawing = false,
			},
		},
		image = {
			drawing = false,
		},
		label = {
			drawing = true,
			string = "+" .. overflow_count,
			color = selected and colors.rose or colors.subtle,
		},
	})
end

local function render_space_apps(space_data)
	local apps = space_data.apps or {}
	local selected = space_data.selected

	if #apps == 0 then
		sync_space_item(space_data)
		sync_space_group(space_data)
		for _, item in ipairs(space_data.app_items) do
			hide_app_item(item)
		end
		return
	end

	space_data.item:set({ drawing = false })
	sync_space_group(space_data)
	local visible_icons = #apps

	if #apps > MAX_APP_SLOTS then
		visible_icons = MAX_APP_SLOTS - 1
	end

	for slot, item in ipairs(space_data.app_items) do
		if slot <= visible_icons then
			set_app_item(item, apps[slot])
		elseif slot == MAX_APP_SLOTS and #apps > MAX_APP_SLOTS then
			set_overflow_item(item, #apps - visible_icons, selected)
		else
			hide_app_item(item)
		end
	end
end

local function update_space_apps(space_data, space_id)
	sbar.exec(YABAI_BIN .. " -m query --windows --space " .. space_id, function(windows)
		local apps = {}
		local seen = {}

		if type(windows) == "table" then
			for _, window in ipairs(windows) do
				local app_name = window.app
				if app_name and app_name ~= "" and not seen[app_name] then
					seen[app_name] = true
					table.insert(apps, app_name)
				end
			end
		end

		table.sort(apps, function(left, right)
			return left:lower() < right:lower()
		end)

		space_data.apps = apps
		render_space_apps(space_data)
	end)
end

local function refresh_all_spaces()
	for _, space_data in ipairs(spaces) do
		update_space_apps(space_data, space_data.id)
	end
end

local refresh_observer = sbar.add("item", "spaces.observer", {
	drawing = false,
	updates = true,
})

refresh_observer:subscribe("space_windows_change", function(_)
	refresh_all_spaces()
end)

sbar.exec(YABAI_BIN .. " -m query --spaces", function(space_info)
	if type(space_info) ~= "table" or #space_info == 0 then
		return
	end

	table.sort(space_info, function(left, right)
		return left.index < right.index
	end)

	for _, space in ipairs(space_info) do
		local space_id = space.index
		local space_item = sbar.add("space", "space." .. space_id, {
			space = space_id,
			icon = {
				string = tostring(space_id),
				font = { size = 13 },
				padding_left = 12,
				padding_right = 12,
			},
			label = {
				drawing = false,
			},
			background = {
				drawing = true,
				color = colors.highlight_low,
				border_color = colors.highlight_med,
				border_width = 1,
				corner_radius = 9,
				height = 26,
			},
			padding_left = 2,
			padding_right = EMPTY_SPACE_OUTER_GAP,
			click_script = YABAI_BIN .. " -m space --focus " .. space_id,
		})

		local space_data = {
			id = space_id,
			item = space_item,
			group = nil,
			spacer = nil,
			app_items = {},
			apps = {},
			selected = space["has-focus"] == true,
		}

		local group_members = {}

		for slot = 1, MAX_APP_SLOTS do
			local app_name = "space." .. space_id .. ".app." .. slot
			local app_item = sbar.add("item", "space." .. space_id .. ".app." .. slot, {
				position = "left",
				drawing = false,
				padding_left = APP_INNER_PADDING,
				width = APP_ITEM_WIDTH,
				icon = {
					drawing = false,
				},
				label = {
					drawing = false,
					font = { size = 11 },
					padding_left = 7,
					padding_right = 7,
				},
				background = {
					drawing = true,
					color = colors.none,
					border_width = 0,
					height = 26,
					image = {
						drawing = false,
						scale = 0.72,
					},
				},
				padding_right = APP_INNER_PADDING,
				click_script = YABAI_BIN .. " -m space --focus " .. space_id,
			})

			table.insert(group_members, app_name)
			table.insert(space_data.app_items, app_item)
		end

		space_data.group = sbar.add("bracket", "space." .. space_id .. ".group", group_members, {
			drawing = false,
			background = {
				drawing = false,
				color = colors.surface,
				border_color = colors.highlight_med,
				border_width = 1,
				corner_radius = 10,
				height = GROUP_VERTICAL_HEIGHT,
				padding_left = GROUP_HORIZONTAL_PADDING,
				padding_right = GROUP_HORIZONTAL_PADDING,
			},
		})

		space_data.spacer = sbar.add("item", "space." .. space_id .. ".spacer", {
			position = "left",
			drawing = false,
			width = OCCUPIED_SPACE_GAP,
			icon = {
				drawing = false,
			},
			label = {
				drawing = false,
			},
			background = {
				drawing = false,
			},
		})

		table.insert(spaces, space_data)

		set_space_state(space_data, space_data.selected)

		-- Subscribe to space_change event for highlighting
		space_item:subscribe("space_change", function(env)
			local selected = env.SELECTED == "true"
			set_space_state(space_data, selected)
			render_space_apps(space_data)
		end)

		-- Initial app content update
		update_space_apps(space_data, space_id)
	end

	require("items.front_app")
end)

local sbar = require("sketchybar")


-- Minimal colors for clean aesthetics
local colors = {
	active_bg = 0x30ffffff,
	inactive_bg = 0x00000000,
	text_active = 0xffffffff,
	text_inactive = 0x80ffffff,
}

-- Function to get app display name
local function get_app_display(app_name)
	return app_name
end

-- Function to update space content with apps
local function update_space_apps(space_item, space_id)
	sbar.exec("yabai -m query --windows --space " .. space_id .. " | jq -r 'length'", function(window_count)
		if tonumber(window_count) == 0 then
			-- Empty space
			space_item:set({
				label = { string = "◦" }
			})
		else
			-- Space has windows, get app names
			sbar.exec("yabai -m query --windows --space " .. space_id .. " | jq -r 'map(.app) | unique | join(\",\")'", function(apps_output)
				local apps = {}
				if apps_output and apps_output ~= "" and apps_output ~= "null" then
					for app in string.gmatch(apps_output, "([^,]+)") do
						table.insert(apps, get_app_display(app:gsub("^%s*(.-)%s*$", "%1"))) -- trim whitespace
					end
				end
				
				local label_text = ""
				if #apps > 0 then
					label_text = table.concat(apps, " • ")
				else
					label_text = "◦"  -- Fallback empty indicator
				end
				
				space_item:set({
					label = { string = label_text }
				})
			end)
		end
	end)
end

-- Query available spaces and create space items
sbar.exec("yabai -m query --spaces | jq -r 'sort_by(.index) | .[].index'", function(spaces_output)
	if not spaces_output or spaces_output == "" then
		return
	end
	
	local spaces = {}
	for space_id in string.gmatch(spaces_output, "(%d+)") do
		table.insert(spaces, tonumber(space_id))
	end
	
	-- Create space items
	for _, space_id in ipairs(spaces) do
		local space_item = sbar.add("space", "space." .. space_id, {
			space = space_id,
			label = {
				string = "",
				color = colors.text_inactive,
				font = { size = 14 },
				padding_left = 0,
				padding_right = 12,
			},
			background = {
				color = colors.inactive_bg,
				corner_radius = 8,
				height = 24,
			},
			click_script = "yabai -m space --focus " .. space_id,
		})
		
		-- Subscribe to space_change event for highlighting
		space_item:subscribe("space_change", function(env)
			local selected = env.SELECTED == "true"
			local bg_color = selected and colors.active_bg or colors.inactive_bg
			local text_color = selected and colors.text_active or colors.text_inactive
			
			space_item:set({
				background = {
					color = bg_color,
				},
				label = { color = text_color },
			})
		end)
		
		-- Subscribe to space_windows_change for app updates
		space_item:subscribe("space_windows_change", function(env)
			update_space_apps(space_item, space_id)
		end)
		
		-- Initial app content update
		update_space_apps(space_item, space_id)
	end
end)


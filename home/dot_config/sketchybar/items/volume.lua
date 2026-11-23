local function volume_icon(value)
  if value >= 60 then
    return "󰕾"
  end
  if value >= 30 then
    return "󰖀"
  end
  if value >= 1 then
    return "󰕿"
  end
  return "󰖁"
end

local volume = sbar.add("item", "volume", {
  position = "right",
  drawing = false,
  updates = true,
  background = {
    border_width = 0,
  },
})

local function sync_volume(value)
  local numeric_value = tonumber(value)

  if not numeric_value then
    volume:set({
      drawing = false,
      icon = { drawing = false },
      label = { drawing = false, string = "" },
    })
    return
  end

  volume:set({
    drawing = true,
    icon = {
      drawing = true,
      string = volume_icon(numeric_value),
    },
    label = {
      drawing = true,
      string = string.format("%d%%", numeric_value),
    },
  })
end

sbar.exec("osascript -e 'output volume of (get volume settings)'", function(result)
  sync_volume(result)
end)

volume:subscribe("volume_change", function(env)
  sync_volume(env.INFO)
end)

--- @sync entry
local function entry()
  local hovered = cx.active.current.hovered
  if not hovered then
    return
  end

  if hovered.cha.is_dir then
    ya.emit("enter", {})
  else
    ya.emit("open", {})
  end
end

return { entry = entry }

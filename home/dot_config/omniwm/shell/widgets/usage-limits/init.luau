local look = require("../lib/look")

interval = 1

local PROVIDERS = {
    claude = { name = "Claude", color = "#D97757", icon = omniwm.asset("@self/icons/claude.png") },
    codex = { name = "Codex", color = "foreground", icon = omniwm.asset("@self/icons/codex.png") },
    grok = { name = "Grok", color = "foreground", icon = omniwm.asset("@self/icons/grok.png") },
    opencodego = { name = "OpenCode Go", color = "foreground", icon = omniwm.asset("@self/icons/opencodego.png") },
}

local DEFICIT = "#FF453A"
local RESERVE = "#30D158"
local WEEK = 10080
local ROTATE_SECONDS = 8
local SCROLL_POINTS = 72
local SCROLL_NOTCHES = 6
local SLIDE = 12
local SLIDE_MOTION = { response = 0.34, bounce = 0.06 }
local FAVORITES = "favorites"

local function provider(id: string)
    return PROVIDERS[id] or { name = string.upper(string.sub(id, 1, 1)) .. string.sub(id, 2), color = "foreground" }
end

local function finite(value: any): number?
    if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
        return nil
    end
    return value
end

local function tightest(entry)
    local lowest = nil
    for _, row in ipairs(entry.rows) do
        local left = finite(row.left)
        if not row.extra and left and (lowest == nil or left < lowest.left) then
            lowest = row
        end
    end
    return lowest
end

local function weekly(entry)
    for _, row in ipairs(entry.rows) do
        if not row.extra and row.windowMinutes == WEEK then
            return row
        end
    end
    return tightest(entry)
end

local function paceDelta(row, now: number): number?
    local window = finite(row.windowMinutes)
    local resetsAt = finite(row.resetsAt)
    local left = finite(row.left)
    if not window or window <= 0 or not resetsAt or not left then
        return nil
    end
    local duration = window * 60
    local elapsed = duration - math.max(0, resetsAt - now)
    local expected = math.clamp(elapsed / duration * 100, 0, 100)
    return math.round((100 - left) - expected)
end

local function paceText(delta: number): string
    if delta > 0 then
        return string.format("+%d%%", delta)
    end
    return string.format("%d%%", delta)
end

local function untilReset(resetsAt: any, now: number): string?
    local at = finite(resetsAt)
    if not at then
        return nil
    end
    local remaining = math.max(0, at - now)
    local days = math.floor(remaining / 86400)
    local hours = math.floor((remaining % 86400) / 3600)
    local minutes = math.floor((remaining % 3600) / 60)
    if days > 0 then
        return string.format("%dd %dh", days, hours)
    elseif hours > 0 then
        return string.format("%dh %dm", hours, minutes)
    end
    return string.format("%dm", minutes)
end

local function limits(ctx: Context): { any }?
    return ctx.state.limits or omniwm.store.get("limits")
end

local function sanitize(list: any): { string }
    local result = {}
    local seen = {}
    if type(list) ~= "table" then
        return result
    end
    for _, id in ipairs(list) do
        if type(id) == "string" and id ~= "" and not seen[id] then
            seen[id] = true
            result[#result + 1] = id
        end
    end
    return result
end

local function favorites(ctx: Context): { string }
    local stored = omniwm.store.get(FAVORITES)
    if type(stored) == "table" then
        return sanitize(stored)
    end
    return sanitize(ctx.data.settings and ctx.data.settings.providers)
end

local function saveFavorites(list: { string })
    local ok, err = omniwm.store.set(FAVORITES, list)
    if not ok then
        omniwm.log("usage-limits: could not save favorites: " .. tostring(err))
    end
end

local function toggleFavorite(ctx: Context, id: string)
    local updated = {}
    local found = false
    for _, value in ipairs(favorites(ctx)) do
        if value == id then
            found = true
        else
            updated[#updated + 1] = value
        end
    end
    if not found then
        updated[#updated + 1] = id
    end
    saveFavorites(updated)
end

local function favorited(ctx: Context, entries: { any }): { any }
    local byProvider = {}
    for _, entry in ipairs(entries) do
        if tightest(entry) then
            byProvider[entry.provider] = entry
        end
    end
    local picked = {}
    for _, id in ipairs(favorites(ctx)) do
        local entry = byProvider[id]
        if entry then
            picked[#picked + 1] = entry
        end
    end
    return picked
end

local function least(entries: { any }): any?
    local best, bestLeft = nil, math.huge
    for _, entry in ipairs(entries) do
        local row = tightest(entry)
        if row and row.left < bestLeft then
            best, bestLeft = entry, row.left
        end
    end
    return best
end

local function rotate(ctx: Context, list: { any }): any?
    if #list == 0 then
        return nil
    end
    local turn = finite(ctx.state.turn) or 0
    local tick = math.floor((ctx.data.seconds or 0) / ROTATE_SECONDS)
    return list[(tick + turn) % #list + 1]
end

local function scrolled(ctx: Context, event: Event)
    local dx = finite(event.dx) or 0
    local dy = finite(event.dy) or 0
    local delta = if math.abs(dx) > math.abs(dy) then dx else dy
    delta /= if event.precise then SCROLL_POINTS else SCROLL_NOTCHES
    local total = finite(ctx.state.scroll) or 0
    if total * delta < 0 then
        total = 0
    end
    total += delta
    if total >= 1 or total <= -1 then
        local step = if total > 0 then 1 else -1
        ctx.state.scroll = 0
        ctx.state.turn = (finite(ctx.state.turn) or 0) + step
        ctx.state.direction = step
    else
        ctx.state.scroll = total
    end
end

function trigger(ctx: Context, event: TriggerEvent)
    if event.name ~= "update" or not event.value then
        return
    end
    local decoded, err = json.decode(event.value)
    if not decoded then
        omniwm.log("usage-limits: bad payload: " .. tostring(err))
        return
    end
    ctx.state.limits = decoded
    omniwm.store.set("limits", decoded)
end

local function strip(ctx: Context, entry, props, size: number)
    local info = provider(entry.provider)
    local now = ctx.data.seconds
    local function text(value: string, color: string?)
        props[#props + 1] = look.text{ text = value, size = size, color = color or info.color }
    end
    local function usage(row)
        text(string.format("%d%%", finite(row.left) or 0))
        local delta = paceDelta(row, now)
        if delta then
            text(paceText(delta), if delta > 0 then DEFICIT else RESERVE)
        end
    end
    local main = tightest(entry)
    if not main then
        return
    end
    if info.icon then
        props[#props + 1] = ui.image{ image = info.icon, w = size + 2, h = size + 2 }
    else
        text(info.name)
    end
    usage(main)
    for _, row in ipairs(entry.rows) do
        if row.extra then
            props[#props + 1] = ui.box{ w = 4, h = 1 }
            text(string.sub(row.title, 1, 1), "secondaryForeground")
            usage(row)
        end
    end
    local week = weekly(entry)
    local reset = untilReset(week and week.resetsAt, now)
    if reset then
        props[#props + 1] = ui.box{ w = 4, h = 1 }
        text("in " .. reset)
    end
end

function render(ctx: Context)
    local entries = limits(ctx)
    if not entries then
        return ui.box{ w = 0, h = 0 }
    end
    local locked = ctx.state.lockedProvider
    local picked = favorited(ctx, entries)
    local entry
    if locked then
        for _, candidate in ipairs(entries) do
            if candidate.provider == locked then
                entry = candidate
                break
            end
        end
        entry = entry or { provider = locked, rows = {} }
    else
        entry = rotate(ctx, picked) or least(entries)
    end
    if not entry then
        return ui.box{ w = 0, h = 0 }
    end
    local info = provider(entry.provider)
    local hint = if locked then ". Locked. Right-click to unlock."
        elseif #picked > 1 then ". Scroll to switch. Right-click to lock."
        else ". Right-click to lock."
    local size = look.px(ctx, "text")
    local direction = if (finite(ctx.state.direction) or 1) < 0 then -1 else 1
    local props = { gap = 4, onClick = ui.popout,
        onRightClick = function(next)
            next.state.lockedProvider = if next.state.lockedProvider then nil else entry.provider
            next.state.scroll = 0
        end,
        onScroll = if not locked and #picked > 1 then scrolled else nil,
        border = if locked then "#FF9F0A" else nil,
        borderWidth = if locked then 1 else nil,
        help = "Usage limits: " .. info.name .. hint }
    local content = { key = entry.provider, gap = 4,
        appear = { opacity = 0, dx = direction * SLIDE, animate = SLIDE_MOTION },
        exit = { opacity = 0, dx = -direction * SLIDE, animate = 0.14 } }
    if tightest(entry) then
        strip(ctx, entry, content, size)
    else
        content[#content + 1] = look.text{ text = info.name .. " unavailable", size = size, role = "secondary" }
    end
    local vertical = ctx.data.bar and ctx.data.bar.style and ctx.data.bar.style.vertical
    props[#props + 1] = if vertical then ui.column(content) else ui.row(content)
    return look.bar(ctx, props)
end

local function star(id: string, info, favorite: boolean)
    return look.button(if favorite then "star.fill" else "star", function(next)
        toggleFavorite(next, id)
    end, { w = 20, h = 20, color = if favorite then "accent" else "secondaryForeground",
        help = (if favorite then "Remove " else "Add ") .. info.name
            .. (if favorite then " from favorites" else " to favorites") })
end

function popout(ctx: Context)
    local entries = limits(ctx) or {}
    local width = look.width
    local now = ctx.data.seconds
    local inner = width - 24
    local pinned = favorites(ctx)
    local starred = {}
    for _, id in ipairs(pinned) do
        starred[id] = true
    end
    local sections = { w = width + 28, look.heading("Usage limits", width),
        look.text{ text = if #pinned == 0
            then "Star a provider to feature it in the bar. With no favorites, the tightest limit shows."
            else "Star providers to cycle them in the bar. Scroll the bar item to switch.",
            size = 11, role = "secondary", maxWidth = width } }
    for _, entry in ipairs(entries) do
        local info = provider(entry.provider)
        local header = { w = inner, gap = 6 }
        if info.icon then
            header[#header + 1] = ui.image{ image = info.icon, w = 14, h = 14 }
        end
        header[#header + 1] = look.text{ text = info.name, size = 13,
            weight = if starred[entry.provider] then "semibold" else nil, maxWidth = inner - 62 }
        header[#header + 1] = ui.box{ grow = 1, h = 1 }
        header[#header + 1] = star(entry.provider, info, starred[entry.provider] == true)
        local rows = { w = inner, ui.row(header) }
        for _, row in ipairs(entry.rows) do
            local delta = paceDelta(row, now)
            rows[#rows + 1] = ui.row{ w = inner,
                look.text{ text = row.title, size = 12 },
                ui.box{ grow = 1, h = 1 },
                look.text{ text = string.format("%d%% left", finite(row.left) or 0), size = 12, color = info.color } }
            rows[#rows + 1] = ui.progress{ value = (finite(row.left) or 0) / 100, w = inner, h = 4, radius = 2,
                fill = "foreground/0.08", color = info.color }
            local details = {}
            local reset = untilReset(row.resetsAt, now)
            if reset then
                details[#details + 1] = "Resets in " .. reset
            end
            local detailRow = { w = inner,
                look.text{ text = table.concat(details, ""), size = 11, role = "secondary" },
                ui.box{ grow = 1, h = 1 } }
            if delta then
                detailRow[#detailRow + 1] = look.text{ text = (if delta > 0 then "Deficit " else "Reserve ")
                    .. paceText(delta), size = 11, color = if delta > 0 then DEFICIT else RESERVE }
            end
            rows[#rows + 1] = ui.row(detailRow)
        end
        sections[#sections + 1] = look.group(rows)
    end
    if #entries == 0 then
        sections[#sections + 1] = look.text{ text = "Waiting for CodexBar…", size = 12, role = "secondary" }
    end
    return look.panel(ctx, sections)
end

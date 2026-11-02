--[[
QCS emulator: an offline stand-in for the Quadcode Script runtime of IQ Option
charts, used only by the tests in this folder. It implements the subset of QCS
the scripts use, following https://quadcode-tech.github.io/quadcodescript-docs/
and the official script library (github.com/quadcode-tech/quadcodescript-library):

  * the script body runs once per candle, oldest candle first;
  * built-in series and the series returned by functions keep their history:
    s[n] is the value n candles ago, get_value(s) the current value;
  * make_series() values are not carried forward: they must be :set() each candle.

It is deliberately stricter than the platform, so the scripts stay portable:
  * functions that keep history must be called on every candle, in the same order;
  * series may not be compared with < <= == (the docs say: use get_value);
  * undefined globals, global writes, unknown enum items, negative (look-ahead)
    offsets and wrongly ordered plot_shape arguments are errors.
]]

local M = {}
local NAN = 0 / 0

local function valid (x) return type (x) == "number" and x == x end

local SeriesMT = {}
local Methods = {}

local function is_series (x) return getmetatable (x) == SeriesMT end

local function value_at (x, n)
    if is_series (x) then return x._at (n) end
    return x
end

SeriesMT.__index = function (s, k)
    if type (k) == "number" then
        if k < 0 then error ("negative series offset " .. k .. " (look-ahead)", 2) end
        if math.type (k) ~= "integer" and k ~= math.floor (k) then error ("non-integer series offset " .. k, 2) end
        return s._at (math.tointeger (k) or k)
    end
    local method = Methods [k]
    if method == nil then error ("series has no field '" .. tostring (k) .. "'", 2) end
    return method
end
SeriesMT.__newindex = function () error ("series are read-only; use :set() on a make_series()", 2) end
SeriesMT.__call = function (s) return s._at (0) end
SeriesMT.__tostring = function (s) return "series(" .. tostring (s._at (0)) .. ")" end

local function no_compare ()
    error ("a series cannot be compared directly; read it with get_value() first (QCS docs)", 2)
end
SeriesMT.__lt, SeriesMT.__le, SeriesMT.__eq = no_compare, no_compare, no_compare
SeriesMT.__concat = function () error ("cannot concatenate a series", 2) end

local function derived (op, a, b)
    return setmetatable ({ _at = function (n)
        local x, y = value_at (a, n), value_at (b, n)
        if type (x) ~= "number" or type (y) ~= "number" then return nil end
        return op (x, y)
    end }, SeriesMT)
end

SeriesMT.__add = function (a, b) return derived (function (x, y) return x + y end, a, b) end
SeriesMT.__sub = function (a, b) return derived (function (x, y) return x - y end, a, b) end
SeriesMT.__mul = function (a, b) return derived (function (x, y) return x * y end, a, b) end
SeriesMT.__div = function (a, b) return derived (function (x, y) return x / y end, a, b) end
SeriesMT.__pow = function (a, b) return derived (function (x, y) return x ^ y end, a, b) end
SeriesMT.__unm = function (a) return derived (function (x) return -x end, a, 0) end

Methods.set = function (s, v)
    local engine = rawget (s, "_engine")
    if not engine then error ("only series created with make_series() can be :set()", 2) end
    local x = value_at (v, 0)
    if x ~= nil and type (x) ~= "number" and type (x) ~= "boolean" then
        error ("make_series:set() expects a number or a boolean, got " .. type (x), 2)
    end
    rawget (s, "_values") [engine.bar] = x
end

local function enum (prefix, items)
    local t = {}
    for _, item in ipairs (items) do t [item] = prefix .. "." .. item end
    return setmetatable (t, { __index = function (_, k)
        error ("unknown enum item " .. prefix .. "." .. tostring (k), 2)
    end })
end

local function check_enum (value, prefix, what)
    if type (value) ~= "string" or value:sub (1, #prefix + 1) ~= prefix .. "." then
        error (what .. " must be a " .. prefix .. ".* value, got " .. tostring (value), 3)
    end
end

local function check_color (value, what)
    if type (value) ~= "string" or value == "" then
        error (what .. " must be a color string, got " .. tostring (value), 3)
    end
end

local INPUT_TYPES = {
    integer = "input.integer", double = "input.double", boolean = "input.boolean",
    color = "input.color", line_width = "input.line_width",
    string_selection = "input.string_selection", plot_visibility = "input.plot_visibility"
}

local STDLIB = { "type", "ipairs", "pairs", "tostring", "tonumber", "select", "error",
                 "assert", "next", "pcall", "math", "string", "table" }

function M.new (candles, overrides)
    overrides = overrides or {}
    local E = { bar = 0, slots = {}, calls = 0 }
    local out = { shapes = {}, plots = {}, advice = {}, logs = {}, hlines = {}, fills = {},
                  inputs = {}, instrument = nil }
    E.out = out

    local N = #candles
    local O, H, L, C, V, OT, CT, TR = {}, {}, {}, {}, {}, {}, {}, {}
    for i = 1, N do
        local c = candles [i]
        O [i], H [i], L [i], C [i] = c.open, c.high, c.low, c.close
        V [i] = c.volume or 0
        OT [i] = c.time or (i - 1) * 60
        CT [i] = OT [i] + 60
        if i == 1 then
            TR [i] = H [i] - L [i]
        else
            TR [i] = math.max (H [i] - L [i], math.abs (H [i] - C [i - 1]), math.abs (L [i] - C [i - 1]))
        end
    end

    local function stored (values)
        return setmetatable ({ _at = function (n)
            local b = E.bar - n
            if b < 1 then return nil end
            return values [b]
        end }, SeriesMT)
    end

    local function slot (name)
        E.calls = E.calls + 1
        local k = E.calls
        local st = E.slots [k]
        if st == nil then
            if E.bar ~= 1 then
                error (("'%s' ran for the first time on candle %d. Functions that keep history must run "
                    .. "on every candle in the same order (not inside if / loops)."):format (name, E.bar), 3)
            end
            st = { name = name, buf = {}, out = {} }
            st.series = stored (st.out)
            E.slots [k] = st
        elseif st.name ~= name then
            error (("call order changed on candle %d: call #%d was '%s' and is now '%s'")
                :format (E.bar, k, st.name, name), 3)
        end
        return st
    end

    local function current (x) return value_at (x, 0) end

    local function need_instrument (what)
        if not E.instrument_called then error ("instrument {} must be called before " .. what, 3) end
    end

    local env = {}
    for _, name in ipairs (STDLIB) do env [name] = _G [name] end

    env.open, env.high, env.low, env.close = stored (O), stored (H), stored (L), stored (C)
    env.volume, env.open_time, env.close_time, env.tr = stored (V), stored (OT), stored (CT), stored (TR)
    -- The chart's asset (IQ Option's active id); tests set it with the override "@ticker_id".
    env.current_ticker_id = overrides ["@ticker_id"] or 0

    env.print = function (...)
        local parts = {}
        for i = 1, select ("#", ...) do parts [#parts + 1] = tostring ((select (i, ...))) end
        out.logs [#out.logs + 1] = table.concat (parts, "\t")
    end

    env.get_value = function (x, default)
        local v = current (x)
        if v == nil then return default end
        return v
    end

    env.make_series = function ()
        local st = slot ("make_series")
        if not rawget (st.series, "_engine") then
            rawset (st.series, "_engine", E)
            rawset (st.series, "_values", st.out)
        end
        return st.series
    end

    env.sma = function (src, n)
        local st = slot ("sma")
        local b = E.bar
        st.buf [b] = current (src)
        local result = NAN
        if b >= n then
            local sum, ok = 0, true
            for i = b - n + 1, b do
                local x = st.buf [i]
                if not valid (x) then ok = false break end
                sum = sum + x
            end
            if ok then result = sum / n end
        end
        st.out [b] = result
        return st.series
    end

    local function smoother (name, alpha_of)
        return function (src, n)
            local st = slot (name)
            local x = current (src)
            local result = NAN
            if valid (x) then
                if st.state == nil then
                    st.count = (st.count or 0) + 1
                    st.sum = (st.sum or 0) + x
                    if st.count == n then st.state = st.sum / n; result = st.state end
                else
                    local a = alpha_of (n)
                    st.state = a * x + (1 - a) * st.state
                    result = st.state
                end
            end
            st.out [E.bar] = result
            return st.series
        end
    end
    env.ema = smoother ("ema", function (n) return 2 / (n + 1) end)
    env.rma = smoother ("rma", function (n) return 1 / n end)
    env.ssma = smoother ("ssma", function (n) return 1 / n end)

    local function fold (name, pick)
        return function (...)
            local count = select ("#", ...)
            if count < 2 then error (name .. "() needs at least two values", 2) end
            local args, any_series = { ... }, false
            for i = 1, count do
                if is_series (args [i]) then any_series = true end
            end
            local function combine (n)
                local best
                for i = 1, count do
                    local x = value_at (args [i], n)
                    if type (x) ~= "number" then return nil end
                    if best == nil or pick (x, best) then best = x end
                end
                return best
            end
            if any_series then return setmetatable ({ _at = combine }, SeriesMT) end
            return combine (0)
        end
    end
    env.max = fold ("max", function (a, b) return a > b end)
    env.min = fold ("min", function (a, b) return a < b end)

    env.rsi = function (src, n)
        local st = slot ("rsi")
        local x = current (src)
        local result = NAN
        if valid (x) then
            if st.prev ~= nil then
                local d = x - st.prev
                local gain, loss = 0, 0
                if d > 0 then gain = d elseif d < 0 then loss = -d end
                if st.avg_gain == nil then
                    st.count = (st.count or 0) + 1
                    st.sum_gain = (st.sum_gain or 0) + gain
                    st.sum_loss = (st.sum_loss or 0) + loss
                    if st.count == n then st.avg_gain, st.avg_loss = st.sum_gain / n, st.sum_loss / n end
                else
                    st.avg_gain = (st.avg_gain * (n - 1) + gain) / n
                    st.avg_loss = (st.avg_loss * (n - 1) + loss) / n
                end
                if st.avg_gain ~= nil then
                    if st.avg_loss == 0 then
                        result = (st.avg_gain == 0) and 50 or 100
                    else
                        result = 100 - 100 / (1 + st.avg_gain / st.avg_loss)
                    end
                end
            end
            st.prev = x
        end
        st.out [E.bar] = result
        return st.series
    end

    env.stdev = function (src, n)
        local st = slot ("stdev")
        local b = E.bar
        st.buf [b] = current (src)
        local result = NAN
        if b >= n then
            local sum, ok = 0, true
            for i = b - n + 1, b do
                local x = st.buf [i]
                if not valid (x) then ok = false break end
                sum = sum + x
            end
            if ok then
                local mean, squares = sum / n, 0
                for i = b - n + 1, b do
                    local d = st.buf [i] - mean
                    squares = squares + d * d
                end
                result = (squares / n) ^ 0.5
            end
        end
        st.out [b] = result
        return st.series
    end

    local function extreme (name, better)
        return function (src, n)
            local st = slot (name)
            local b = E.bar
            st.buf [b] = current (src)
            local result = NAN
            if b >= n then
                local best
                for i = b - n + 1, b do
                    local x = st.buf [i]
                    if not valid (x) then best = nil break end
                    if best == nil or better (x, best) then best = x end
                end
                if best ~= nil then result = best end
            end
            st.out [b] = result
            return st.series
        end
    end
    env.highest = extreme ("highest", function (a, b) return a > b end)
    env.lowest = extreme ("lowest", function (a, b) return a < b end)

    env.sar = function (start, step, max_af)
        local st = slot ("sar")
        local b = E.bar
        local result = NAN
        if b >= 2 then
            if st.up == nil then
                st.up = C [2] >= C [1]
                st.prev = st.up and L [1] or H [1]
                st.ep = st.up and H [1] or L [1]
                st.af = start
            end
            local value = st.prev + st.af * (st.ep - st.prev)
            if st.up then
                value = math.min (value, L [b - 1], L [b - 2] or L [b - 1])
                if L [b] < value then
                    st.up, value, st.ep, st.af = false, math.max (st.ep, H [b - 1], H [b]), L [b], start
                elseif H [b] > st.ep then
                    st.ep, st.af = H [b], math.min (st.af + step, max_af)
                end
            else
                value = math.max (value, H [b - 1], H [b - 2] or H [b - 1])
                if H [b] > value then
                    st.up, value, st.ep, st.af = true, math.min (st.ep, L [b - 1], L [b]), H [b], start
                elseif L [b] < st.ep then
                    st.ep, st.af = L [b], math.min (st.af + step, max_af)
                end
            end
            st.prev = value
            result = value
        end
        st.out [b] = result
        return st.series
    end

    env.abs = function (x)
        if is_series (x) then return derived (function (v) return math.abs (v) end, x, 0) end
        return math.abs (x)
    end

    env.rgba = function (r, g, b, a) return ("rgba(%d,%d,%d,%s)"):format (r, g, b, tostring (a)) end
    env.rgb = function (r, g, b) return ("rgb(%d,%d,%d)"):format (r, g, b) end

    env.shape_style = enum ("shape_style", { "arrowdown", "arrowup", "circle", "cross", "diamond", "flag",
        "labeldown", "labelup", "square", "triangledown", "triangleup", "xcross" })
    env.shape_size = enum ("shape_size", { "auto", "huge", "large", "normal", "small", "tiny" })
    env.shape_location = enum ("shape_location", { "abovebar", "belowbar", "bottom", "top", "absolute" })
    env.style = enum ("style", { "solid_line", "dash_line", "area", "points", "crosses", "levels" })
    env.na_mode = enum ("na_mode", { "restart", "continue" })
    env.advice = enum ("advice", { "buy", "neutral", "sell" })

    env.instrument = function (t)
        if type (t) ~= "table" or type (t.name) ~= "string" then
            error ("instrument { name = ..., overlay = ... } expected", 2)
        end
        if E.instrument_called then error ("instrument {} must be called only once", 2) end
        E.instrument_called = true
        out.instrument = { name = t.name, short_name = t.short_name, overlay = t.overlay == true }
    end

    env.input = setmetatable ({}, {
        __call = function (_, a, name, kind, min_value, max_value)
            need_instrument ("input()")
            local default = a
            if type (a) == "table" and name == nil then default, name, kind = a.default, a.name, a.type end
            local known = false
            for _, v in pairs (INPUT_TYPES) do if v == kind then known = true end end
            if not known then error ("unknown input type " .. tostring (kind), 2) end
            if kind == "input.integer" and math.type (default) ~= "integer" then
                error ("input '" .. tostring (name) .. "': integer default expected", 2)
            elseif kind == "input.double" and type (default) ~= "number" then
                error ("input '" .. tostring (name) .. "': number default expected", 2)
            elseif kind == "input.boolean" and type (default) ~= "boolean" then
                error ("input '" .. tostring (name) .. "': boolean default expected", 2)
            elseif kind == "input.color" then
                check_color (default, "input '" .. tostring (name) .. "'")
            end
            if kind == "input.string_selection" or kind == "input.integer_selection" or kind == "input.double_selection" then
                -- The 4th argument is the list of options; the value is a 1-based index into it.
                local options = min_value
                if type (options) ~= "table" or #options == 0 then
                    error ("input '" .. tostring (name) .. "': selection needs a non-empty options array", 2)
                end
                if math.type (default) ~= "integer" or default < 1 or default > #options then
                    error ("input '" .. tostring (name) .. "': selection default must be an index into the options", 2)
                end
                min_value, max_value = 1, #options
            end
            if type (default) == "number" and ((min_value and default < min_value) or (max_value and default > max_value)) then
                error ("input '" .. tostring (name) .. "': default outside [min, max]", 2)
            end
            local value = default
            if name ~= nil and overrides [name] ~= nil then value = overrides [name] end
            if E.bar == 1 then
                out.inputs [#out.inputs + 1] = { name = name, type = kind, default = default, value = value }
            end
            return value
        end,
        __index = function (_, k) error ("unknown input type input." .. tostring (k), 2) end
    })
    for k, v in pairs (INPUT_TYPES) do rawset (env.input, k, v) end

    env.input_group = function (t)
        if type (t) ~= "table" or type (t [1]) ~= "string" then
            error ('input_group { "Title", key = input (...), ... } expected', 2)
        end
        for k, v in pairs (t) do
            if type (k) == "string" then rawset (env, k, v) end
        end
    end

    local function record_plot (store, name, value)
        local series = store [name]
        if series == nil then series = {}; store [name] = series end
        if E.drawn [name] then error ("two plots named '" .. name .. "' on one candle", 3) end
        E.drawn [name] = true
        series [E.bar] = value
    end

    env.plot_shape = function (series, name, style, size, color, location, offset, text, text_color)
        need_instrument ("plot_shape()")
        if type (name) ~= "string" or name:match ("^shape_%a+%.") then
            error ("plot_shape (series, name, style, size, color, location, offset, text, text_color): "
                .. "argument 2 must be the plot name", 2)
        end
        check_enum (style, "shape_style", "plot_shape style")
        check_enum (size, "shape_size", "plot_shape size")
        check_color (color, "plot_shape color")
        check_enum (location, "shape_location", "plot_shape location")
        if offset ~= nil and math.type (offset) ~= "integer" then error ("plot_shape offset must be an integer", 2) end
        if text ~= nil and type (text) ~= "string" then error ("plot_shape text must be a string", 2) end
        if text_color ~= nil then check_color (text_color, "plot_shape text_color") end
        local v = current (series)
        local on = v ~= nil and v ~= false and not (type (v) == "number" and (v ~= v or v == 0))
        record_plot (out.shapes, name, on)
    end

    env.plot = function (series, name, color, width)
        need_instrument ("plot()")
        if type (name) ~= "string" then error ("plot (series, name, color, width, ...): name must be a string", 2) end
        check_color (color, "plot color")
        local v = current (series)
        if v ~= nil and type (v) ~= "number" then error ("plot() needs a numeric series", 2) end
        record_plot (out.plots, name, v)
    end

    env.fill = function (a, b, name, color)
        need_instrument ("fill()")
        if not is_series (a) or not is_series (b) then error ("fill() needs two series", 2) end
        check_color (color, "fill color")
        out.fills [#out.fills + 1] = name
    end

    env.hline = function (value, name, color, width)
        need_instrument ("hline()")
        if type (value) == "table" then value, name, color = value.value, value.name, value.color end
        if type (value) ~= "number" then error ("hline needs a numeric level", 2) end
        check_color (color, "hline color")
        if E.bar == 1 then out.hlines [#out.hlines + 1] = { value = value, name = name } end
    end

    env.advise = function (a)
        check_enum (a, "advice", "advise()")
        if out.advice [E.bar] ~= nil then error ("advise() called twice on one candle", 2) end
        out.advice [E.bar] = a
    end

    setmetatable (env, {
        __index = function (_, k) error ("undefined global '" .. tostring (k) .. "'", 2) end,
        __newindex = function (_, k) error ("assignment to global '" .. tostring (k) .. "' (use local)", 2) end
    })

    function E.run (source, chunkname)
        local chunk, err = load (source, "=" .. (chunkname or "script"), "t", env)
        if not chunk then error (err, 0) end
        for b = 1, N do
            E.bar, E.calls, E.instrument_called, E.drawn = b, 0, false, {}
            rawset (env, "current_bar_id", b - 1)
            chunk ()
            if E.calls ~= #E.slots then
                error (("candle %d: %d history-keeping calls ran, %d expected. Functions that keep history "
                    .. "must run on every candle in the same order (not inside if / loops).")
                    :format (b, E.calls, #E.slots), 0)
            end
        end
        return out
    end

    return E
end

-- Compact per-candle summary used to compare engines: one character per candle
-- for the arrow (C/P/.), then one for the advice (b/s/n).
function M.digest (out, n)
    local call, put = out.shapes ["CALL"] or {}, out.shapes ["PUT"] or {}
    local arrows, advice = {}, {}
    for b = 1, n do
        arrows [b] = (call [b] and "C") or (put [b] and "P") or "."
        local a = out.advice [b]
        advice [b] = (a == "advice.buy" and "b") or (a == "advice.sell" and "s") or (a and "n") or "-"
    end
    return table.concat (arrows) .. "|" .. table.concat (advice)
end

return M

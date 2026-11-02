
-------------------------------------------------------------------------------
-- Score the arrow of the previous candle, which has now closed.
-------------------------------------------------------------------------------
local score_won_s  = make_series ()
local score_lost_s = make_series ()
local rate_s       = make_series ()
local band_lo_s    = make_series ()
local band_hi_s    = make_series ()
local recent_s     = make_series ()

local last_shown = val (decision_s [2]) or 0
local last_move = 0
if c1 and o1 then last_move = sgn (c1 - o1) end
local won, lost = 0, 0
if last_shown ~= 0 and last_move ~= 0 then
    if last_move == last_shown then won = 1 else lost = 1 end
end
local total_won  = (val (score_won_s [1]) or 0) + won
local total_lost = (val (score_lost_s [1]) or 0) + lost
score_won_s:set (total_won)
score_lost_s:set (total_lost)

local NAN = 0 / 0
local rate, band_lo, band_hi, recent = NAN, NAN, NAN, NAN
local n = total_won + total_lost
if n > 0 then
    local p, z = total_won / n, 1.96
    local denom = 1 + z * z / n
    local centre = (p + z * z / (2 * n)) / denom
    local half = z * (p * (1 - p) / n + z * z / (4 * n * n)) ^ 0.5 / denom
    rate = 100 * p
    band_lo = 100 * nmax (0, centre - half)
    band_hi = 100 * nmin (1, centre + half)
end
local recent_won  = total_won - (val (score_won_s [recent_bars]) or 0)
local recent_lost = total_lost - (val (score_lost_s [recent_bars]) or 0)
if recent_won + recent_lost > 0 then
    recent = 100 * recent_won / (recent_won + recent_lost)
end
rate_s:set (rate)
band_lo_s:set (band_lo)
band_hi_s:set (band_hi)
recent_s:set (recent)

fill (band_lo_s, band_hi_s, "", band_color)
plot (band_hi_s, "95% band upper", band_color, 1)
plot (band_lo_s, "95% band lower", band_color, 1)
plot (recent_s, "Win rate % (recent)", recent_color, 1)
plot (rate_s, "Win rate % (all)", rate_color, 2)
hline (100 * 100 / (100 + payout), "Break-even %", even_color, 1)
hline (50, "Coin flip 50%", rgba (255, 255, 255, 0.25), 1)
hline { value = 80, color = rgba (255, 255, 255, 0), show_label = false }
hline { value = 20, color = rgba (255, 255, 255, 0), show_label = false }

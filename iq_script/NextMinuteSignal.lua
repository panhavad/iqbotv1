-- Next Minute HIGHER/LOWER - Quadcode Script (QCS) indicator for IQ Option charts
-- Made for 1-minute candles. Import this file in the traderoom:
-- Indicators > Scripts > Import (or Add manually, paste, Save, Add to the chart).
--
-- How to read it
--   Green "CALL" arrow under a candle: buy HIGHER at the start of that candle with
--   the expiry at its end (the first expiry in the list). Red "PUT" arrow above a
--   candle: buy LOWER the same way. No arrow: no trade. Each arrow is fixed when the
--   previous candle closes, so it never changes or disappears (no repainting).
--   Marks under the candle: green dot = win, red X = loss, grey = tie. On the live
--   candle the mark shows whether the trade is winning right now.
--
-- How it decides (setting "Signal method")
--   Breakout momentum (default): a candle that closes at the high (low) of the last
--   5 candles gives a CALL (PUT) arrow on the next candle. Tested on about 600,000
--   real IQ Option candles: about 58% on real Bitcoin, about 50% on OTC assets.
--   The "Breakout: ..." and "Reverse" settings adjust it; the Chrome extension
--   learns them for each asset and shows the values to enter here.
--   15-strategy vote: EMA trend, 5-minute trend, Heikin-Ashi, EMA 5/10 cross, EMA
--   pullback, MACD, Parabolic SAR, Bollinger squeeze, RSI, Connors RSI-2, Bollinger
--   reversal, Stochastic, support/resistance rejection, candle streak and candlestick
--   patterns, weighted by the market regime (ADX); about 50% on every asset tested.
--
-- Honest note: no indicator can guarantee 90% wins on 1-minute options. At an 88%
-- payout you need 53.2% wins just to break even. Add the companion script
-- "Next Minute Scoreboard" to see the real win rate of these arrows on your chart,
-- and practise on the demo (PRACTICE) account.

instrument { name = "Next Minute HIGHER/LOWER", short_name = "NEXT 1M", overlay = true }

input_group {
    "Arrows",
    call_color = input { default = "#2CAC40", name = "CALL / HIGHER", type = input.color },
    put_color  = input { default = "#DB4931", name = "PUT / LOWER", type = input.color }
}

input_group {
    "Result marks",
    show_marks = input (true, "Show win / loss marks", input.boolean),
    win_color  = input { default = "#2CAC40", name = "Win", type = input.color },
    loss_color = input { default = "#DB4931", name = "Loss", type = input.color },
    tie_color  = input { default = "#C7CAD1", name = "Tie", type = input.color }
}

-------------------------------------------------------------------------------
-- Signal rules. Shared by "Next Minute HIGHER/LOWER" and "Next Minute
-- Scoreboard": keep these settings identical in both scripts.
--   Breakout momentum: a candle that closes at the high (low) of the last 5
--   candles points HIGHER (LOWER). Tested on 1-minute candles: about 58% on real
--   Bitcoin with a realistic entry, but about 50% (a coin flip) on OTC prices.
--   The "Breakout: ..." and "Reverse" settings adjust it; the defaults are the
--   rule above. The Chrome extension learns them for each asset and writes them
--   into the LEARNED table below, which this script uses when "Use the settings
--   learned for each asset" is on (and the table has the chart's asset).
--   15-strategy vote: the earlier logic (about 50% on every asset tested).
-------------------------------------------------------------------------------
local METHODS = { "Breakout momentum", "15-strategy vote" }
input_group {
    "Signal rules",
    method      = input (1, "Signal method", input.string_selection, METHODS),
    brk_candles = input (5, "Breakout: candles", input.integer, 2, 60),
    brk_zone    = input (0, "Breakout: close within (% of range)", input.integer, 0, 45),
    brk_body    = input (0, "Breakout: minimum body (% of candle)", input.integer, 0, 90),
    reverse     = input (false, "Reverse the arrows (fade)", input.boolean),
    min_score   = input (0.30, "Vote: minimum agreement score", input.double, 0.05, 1, 0.05),
    min_agree   = input (3, "Vote: minimum agreeing strategies", input.integer, 1, 15),
    use_gate    = input (false, "Vote: evidence gate", input.boolean),
    gate_window = input (1000, "Vote: evidence window (candles)", input.integer, 100, 5000),
    gate_z      = input (2.0, "Vote: evidence needed (z-score)", input.double, 0.5, 5, 0.1),
    -- Last on purpose: the traderoom keeps input values by position.
    use_learned = input (true, "Use the settings learned for each asset", input.boolean)
}

-- LEARNED SETTINGS BEGIN (written by the Chrome extension: keep this line and the END line)
-- [asset id] = { breakout candles, close within %, minimum body %, reverse }
local LEARNED = {
}
-- LEARNED SETTINGS END

-- The rules of this chart: the asset's learned settings, or the inputs above.
local rule_method, rule_candles, rule_zone, rule_body, rule_reverse = method, brk_candles, brk_zone, brk_body, reverse
do
    local learned = use_learned and LEARNED [current_ticker_id] or nil
    if learned then
        rule_method, rule_candles, rule_zone, rule_body, rule_reverse = 1, learned [1], learned [2], learned [3], learned [4]
    end
end

local WARMUP, VOTE_FLOOR, MAX_OPPOSE = 160, 0.4, 0.34
local MIN_ATR_RATIO, MAX_ATR_RATIO = 0.5, 3.0
local ADX_TREND, ADX_RANGE = 25, 18
local GATE_MIN_SIGNALS, GATE_MIN_NET, GATE_RAMP = 30, 0.5, 1.5
local FAMILIES = { "trend", "reversion", "pattern" }
local REGIME_WEIGHT = {
    trending = { trend = 1.0, reversion = 0.4, pattern = 0.8 },
    mixed    = { trend = 0.7, reversion = 0.7, pattern = 0.8 },
    ranging  = { trend = 0.4, reversion = 1.0, pattern = 0.8 }
}

-------------------------------------------------------------------------------
-- Helpers. Decisions use plain numbers read with get_value(): the QCS docs say
-- a series cannot be compared directly or used as a condition.
-------------------------------------------------------------------------------
local function val (x)
    local v = get_value (x)
    if type (v) ~= "number" or v ~= v or v > 1e300 or v < -1e300 then
        return nil
    end
    return v
end

local function sgn (x)
    if x > 0 then return 1 elseif x < 0 then return -1 end
    return 0
end

local function nabs (x) if x < 0 then return -x end return x end
local function nmin (a, b) if a < b then return a end return b end
local function nmax (a, b) if a > b then return a end return b end
local function clamp01 (x) if x < 0 then return 0 elseif x > 1 then return 1 end return x end

local function rsi_of (up, down)
    if up == nil or down == nil then return nil end
    if down == 0 then
        if up == 0 then return 50 end
        return 100
    end
    return 100 - 100 / (1 + up / down)
end

-------------------------------------------------------------------------------
-- Indicator series. Functions that keep history are called unconditionally,
-- in the same order, on every candle.
-------------------------------------------------------------------------------
local ema5_s     = ema (close, 5)
local ema9_s     = ema (close, 9)
local ema10_s    = ema (close, 10)
local ema21_s    = ema (close, 21)
local ema50_s    = ema (close, 50)
local htf_fast_s = ema (close, 45)     -- about EMA 9 of 5-minute candles
local htf_slow_s = ema (close, 105)    -- about EMA 21 of 5-minute candles
local macd_s     = ema (close, 12) - ema (close, 26)
local macd_sig_s = ema (macd_s, 9)
-- RSI built like the platform's own RSI script (Wilder smoothing = ssma), so its
-- scale is certainly 0-100 whatever the built-in rsi() returns.
local delta_s    = close - close [1]
local rsi_up_s   = ssma (max (delta_s, 0), 14)
local rsi_dn_s   = ssma (max (-delta_s, 0), 14)
local rsi2_up_s  = ssma (max (delta_s, 0), 2)
local rsi2_dn_s  = ssma (max (-delta_s, 0), 2)
local bb_mid_s   = sma (close, 20)
local bb_dev_s   = stdev (close, 20)
local bb_bw_s    = bb_dev_s * 4 / bb_mid_s
local bb_bw_hi_s = highest (bb_bw_s, 100)
local bb_bw_lo_s = lowest (bb_bw_s, 100)
local atr_s      = rma (tr, 14)
local atr_avg_s  = sma (atr_s, 100)
local hh14_s     = highest (high, 14)
local ll14_s     = lowest (low, 14)
local support_s  = lowest (low, 35)
local resist_s   = highest (high, 35)
local sar_s      = sar (0.02, 0.02, 0.2)
local ha_close_s = (open + high + low + close) / 4
local breakout_hi_s = highest (high, rule_candles)
local breakout_lo_s = lowest (low, rule_candles)

local bars_s      = make_series ()
local pdm_s       = make_series ()
local mdm_s       = make_series ()
local stoch_raw_s = make_series ()
local ha_open_s   = make_series ()
local sar_dir_s   = make_series ()
local up_run_s    = make_series ()
local dn_run_s    = make_series ()
local pred_s, wins_s, losses_s = {}, {}, {}
for _, kind in ipairs (FAMILIES) do
    pred_s [kind]   = make_series ()
    wins_s [kind]   = make_series ()
    losses_s [kind] = make_series ()
end
local decision_s  = make_series ()

local o0, h0, l0, c0 = val (open), val (high), val (low), val (close)
local o1, h1, l1, c1 = val (open [1]), val (high [1]), val (low [1]), val (close [1])
local o2, c2 = val (open [2]), val (close [2])

local nbar = (val (bars_s [1]) or 0) + 1
bars_s:set (nbar)

do  -- Wilder's directional movement (for ADX)
    local up_move, dn_move = 0, 0
    if h1 and l1 then
        up_move, dn_move = h0 - h1, l1 - l0
    end
    pdm_s:set ((up_move > dn_move and up_move > 0) and up_move or 0)
    mdm_s:set ((dn_move > up_move and dn_move > 0) and dn_move or 0)
end

do  -- Lane's raw stochastic %K; 50 while the 14-candle range is flat
    local hh, ll = val (hh14_s), val (ll14_s)
    if hh and ll and hh > ll then
        stoch_raw_s:set (100 * (c0 - ll) / (hh - ll))
    else
        stoch_raw_s:set (50)
    end
end

local pdi_s     = 100 * rma (pdm_s / atr_s, 14)
local mdi_s     = 100 * rma (mdm_s / atr_s, 14)
local adx_s     = 100 * rma (abs (pdi_s - mdi_s) / (pdi_s + mdi_s), 14)
local stoch_k_s = sma (stoch_raw_s, 3)
local stoch_d_s = sma (stoch_k_s, 3)

local hao0
do  -- Heikin-Ashi open
    local hao1, hac1 = val (ha_open_s [1]), val (ha_close_s [1])
    if hao1 and hac1 then hao0 = (hao1 + hac1) / 2 else hao0 = (o0 + c0) / 2 end
end
ha_open_s:set (hao0)

local sar_dir = 0
do  -- Parabolic SAR side: +1 price above SAR, -1 below
    local ps = val (sar_s)
    if ps then sar_dir = (c0 >= ps) and 1 or -1 end
end
sar_dir_s:set (sar_dir)

local up_run = (c0 > o0) and (val (up_run_s [1]) or 0) + 1 or 0
local dn_run = (c0 < o0) and (val (dn_run_s [1]) or 0) + 1 or 0
up_run_s:set (up_run)
dn_run_s:set (dn_run)

local e50     = val (ema50_s)
local r14     = rsi_of (val (rsi_up_s), val (rsi_dn_s))
local mid     = val (bb_mid_s)
local dev     = val (bb_dev_s)
local atr     = val (atr_s)
local span    = h0 - l0

-------------------------------------------------------------------------------
-- Strategy votes for the NEXT candle: +1 = HIGHER, -1 = LOWER, 0 = no opinion.
-------------------------------------------------------------------------------
local votes = {}
local function vote (name, kind, trigger, weight, value)
    votes [#votes + 1] = { name = name, kind = kind, trigger = trigger, weight = weight, value = value }
end

do  -- EMA 9/21/50 stack with a rising (falling) EMA 21
    local v = 0
    local e9, e21, e21_3 = val (ema9_s), val (ema21_s), val (ema21_s [3])
    if e9 and e21 and e50 and e21_3 then
        if e9 > e21 and e21 > e50 and e21 > e21_3 and c0 > e21 then v = 1
        elseif e9 < e21 and e21 < e50 and e21 < e21_3 and c0 < e21 then v = -1 end
    end
    vote ("ema_trend", "trend", false, 1, v)
end

do  -- Higher-timeframe trend (Elder's triple screen idea)
    local v = 0
    local f, s = val (htf_fast_s), val (htf_slow_s)
    if f and s then
        if f > s and c0 > s then v = 1 elseif f < s and c0 < s then v = -1 end
    end
    vote ("htf_bias", "trend", false, 1, v)
end

do  -- Three Heikin-Ashi candles of one colour; full vote without a counter wick
    local v = 0
    local hao1, hao2 = val (ha_open_s [1]), val (ha_open_s [2])
    local hac0, hac1, hac2 = val (ha_close_s), val (ha_close_s [1]), val (ha_close_s [2])
    if hao1 and hao2 and hac0 and hac1 and hac2 then
        if hac0 > hao0 and hac1 > hao1 and hac2 > hao2 then
            v = (l0 >= nmin (hao0, hac0) - 1e-12) and 1 or 0.5
        elseif hac0 < hao0 and hac1 < hao1 and hac2 < hao2 then
            v = (h0 <= nmax (hao0, hac0) + 1e-12) and -1 or -0.5
        end
    end
    vote ("heikin_ashi", "trend", false, 1, v)
end

do  -- EMA 5/10 cross (this or the previous candle), halved against the EMA 50 side
    local function cross (f0, f1, s0, s1)
        if f0 and f1 and s0 and s1 then
            if f1 <= s1 and f0 > s0 then return 1 end
            if f1 >= s1 and f0 < s0 then return -1 end
        end
        return 0
    end
    local f0, f1, f2 = val (ema5_s), val (ema5_s [1]), val (ema5_s [2])
    local s0, s1, s2 = val (ema10_s), val (ema10_s [1]), val (ema10_s [2])
    local v = cross (f0, f1, s0, s1)
    if v == 0 then v = 0.6 * cross (f1, f2, s1, s2) end
    if v ~= 0 and e50 and ((v > 0 and c0 < e50) or (v < 0 and c0 > e50)) then v = v * 0.5 end
    vote ("ema_cross", "trend", true, 1, v)
end

do  -- Pullback to EMA 21 inside an EMA 21/50 trend, closing back with the trend
    local v = 0
    local e21, e21_1, e50_5 = val (ema21_s), val (ema21_s [1]), val (ema50_s [5])
    if e21 and e21_1 and e50 and e50_5 and h1 and l1 then
        if e21 > e50 and e50 > e50_5 and (l0 <= e21 or l1 <= e21_1) and c0 > e21 and c0 > o0 then v = 1
        elseif e21 < e50 and e50 < e50_5 and (h0 >= e21 or h1 >= e21_1) and c0 < e21 and c0 < o0 then v = -1 end
    end
    vote ("ema_pullback", "trend", true, 1, v)
end

do  -- MACD 12/26/9 crossing its signal line (stronger on the matching side of zero)
    local v = 0
    local m0, m1 = val (macd_s), val (macd_s [1])
    local s0, s1 = val (macd_sig_s), val (macd_sig_s [1])
    if m0 and m1 and s0 and s1 then
        local hist0, hist1 = m0 - s0, m1 - s1
        if hist1 <= 0 and hist0 > 0 then v = (m0 > 0) and 1 or 0.7
        elseif hist1 >= 0 and hist0 < 0 then v = (m0 < 0) and -1 or -0.7 end
    end
    vote ("macd_momentum", "trend", true, 1, v)
end

do  -- Parabolic SAR flip (this or the previous candle)
    local v = 0
    local d1, d2 = val (sar_dir_s [1]) or 0, val (sar_dir_s [2]) or 0
    if sar_dir ~= 0 and d1 ~= 0 then
        if sar_dir ~= d1 then v = sar_dir
        elseif d2 ~= 0 and d1 ~= d2 then v = 0.6 * sar_dir end
    end
    vote ("psar_flip", "trend", true, 1, v)
end

do  -- Bollinger squeeze (narrowest 20% of 100 candles) then a close outside the band
    local v = 0
    local bw1, hi1, lo1 = val (bb_bw_s [1]), val (bb_bw_hi_s [1]), val (bb_bw_lo_s [1])
    if bw1 and hi1 and lo1 and mid and dev and hi1 > lo1 and bw1 <= lo1 + 0.2 * (hi1 - lo1) then
        if c0 > mid + 2 * dev and c0 > o0 then v = 1
        elseif c0 < mid - 2 * dev and c0 < o0 then v = -1 end
    end
    vote ("bb_breakout", "trend", true, 1, v)
end

do  -- RSI 14 back inside 30/70; half vote while deeply stretched (20/80)
    local v = 0
    local r1 = rsi_of (val (rsi_up_s [1]), val (rsi_dn_s [1]))
    if r14 and r1 then
        if r1 < 30 and r14 >= 30 then v = 1
        elseif r1 > 70 and r14 <= 70 then v = -1
        elseif r14 < 20 then v = 0.5
        elseif r14 > 80 then v = -0.5 end
    end
    vote ("rsi_reversal", "reversion", true, 1, v)
end

do  -- Connors RSI(2) pullback in the direction of the EMA 50
    local v = 0
    local r2 = rsi_of (val (rsi2_up_s), val (rsi2_dn_s))
    if r2 and e50 then
        if r2 < 10 and c0 > e50 then v = 1 elseif r2 > 90 and c0 < e50 then v = -1 end
    end
    vote ("rsi2_connors", "reversion", true, 1, v)
end

do  -- Bollinger 20/2 band rejection or re-entry
    local v = 0
    local mid1, dev1 = val (bb_mid_s [1]), val (bb_dev_s [1])
    if mid and dev and mid1 and dev1 and c1 then
        local lower, upper = mid - 2 * dev, mid + 2 * dev
        if (c1 < mid1 - 2 * dev1 and c0 >= lower) or (l0 < lower and c0 >= lower and c0 > o0) then v = 1
        elseif (c1 > mid1 + 2 * dev1 and c0 <= upper) or (h0 > upper and c0 <= upper and c0 < o0) then v = -1 end
    end
    vote ("bb_reversal", "reversion", true, 1, v)
end

do  -- Stochastic 14/3/3 %K crossing %D from oversold (<25) or overbought (>75)
    local v = 0
    local k0, k1 = val (stoch_k_s), val (stoch_k_s [1])
    local d0, d1 = val (stoch_d_s), val (stoch_d_s [1])
    if k0 and k1 and d0 and d1 then
        if k1 <= d1 and k0 > d0 and nmin (k0, k1) < 25 then v = 1
        elseif k1 >= d1 and k0 < d0 and nmax (k0, k1) > 75 then v = -1 end
    end
    vote ("stoch_cross", "reversion", true, 1, v)
end

do  -- Rejection of support / resistance (extremes of candles 6-40 back) with a long wick
    local v = 0
    local sup, res = val (support_s [6]), val (resist_s [6])
    if atr and sup and res and span > 0 then
        local tol = 0.35 * atr
        local lower_wick = nmin (o0, c0) - l0
        local upper_wick = h0 - nmax (o0, c0)
        if c0 > o0 and lower_wick >= 0.4 * span and l0 <= sup + tol and l0 >= sup - atr and c0 > sup then v = 1
        elseif c0 < o0 and upper_wick >= 0.4 * span and h0 >= res - tol and h0 <= res + atr and c0 < res then v = -1 end
    end
    vote ("sr_rejection", "reversion", true, 1, v)
end

do  -- Fade 4+ candles of one colour while RSI is stretched (folk rule, half weight)
    local v = 0
    if r14 then
        if up_run >= 4 and r14 > 60 then v = -1 elseif dn_run >= 4 and r14 < 40 then v = 1 end
    end
    vote ("streak_fade", "reversion", true, 0.5, v)
end

do  -- Candlestick reversals (Nison): engulfing, hammer / shooting star, morning / evening star
    local v = 0
    local bull, bear = false, false
    if atr and c1 and o1 and c2 and o2 and span > 0 then
        local body, body1, body2 = nabs (c0 - o0), nabs (c1 - o1), nabs (c2 - o2)
        local upper_wick = h0 - nmax (o0, c0)
        local lower_wick = nmin (o0, c0) - l0
        if c1 < o1 and c0 > o0 and o0 <= c1 and c0 >= o1 and body > body1 then bull = true end
        if c1 > o1 and c0 < o0 and o0 >= c1 and c0 <= o1 and body > body1 then bear = true end
        if span >= 0.6 * atr then
            if lower_wick >= 0.6 * span and upper_wick <= 0.2 * span then bull = true end
            if upper_wick >= 0.6 * span and lower_wick <= 0.2 * span then bear = true end
        end
        if body2 >= 0.5 * atr and body1 <= 0.35 * body2 then
            if c2 < o2 and c0 > o0 and c0 > (o2 + c2) / 2 then bull = true end
            if c2 > o2 and c0 < o0 and c0 < (o2 + c2) / 2 then bear = true end
        end
    end
    if bull ~= bear then
        local pct_b = nil
        if mid and dev and dev > 0 then pct_b = (c0 - (mid - 2 * dev)) / (4 * dev) end
        if bull then
            v = ((pct_b and pct_b < 0.25) or (r14 and r14 < 40)) and 1 or 0.5
        else
            v = ((pct_b and pct_b > 0.75) or (r14 and r14 > 60)) and -1 or -0.5
        end
    end
    vote ("candle_patterns", "pattern", true, 1, v)
end

-------------------------------------------------------------------------------
-- Evidence gate. For each strategy family, count how often its own direction
-- won on the candle after it, over the last gate_window candles, using only
-- results already known (closed candles). A family that wins significantly is
-- followed, one that loses significantly is faded, otherwise it is ignored.
-- Off by default: the traderoom loads only about 440 one-minute candles, too
-- few to reach that evidence, so with the gate on the chart usually stays empty.
-------------------------------------------------------------------------------
local move = sgn (c0 - o0)    -- this candle's result: entry at its open, expiry at its close
local trust = { trend = 1, reversion = 1, pattern = 1 }
for _, kind in ipairs (FAMILIES) do
    local net = 0
    for _, v in ipairs (votes) do
        if v.kind == kind then net = net + v.weight * v.value end
    end
    local pred = 0
    if net >= GATE_MIN_NET then pred = 1 elseif net <= -GATE_MIN_NET then pred = -1 end
    pred_s [kind]:set (pred)

    local prev = val (pred_s [kind] [1]) or 0
    local won  = (prev ~= 0 and move ~= 0 and prev == move) and 1 or 0
    local lost = (prev ~= 0 and move ~= 0 and prev ~= move) and 1 or 0
    local total_won  = (val (wins_s [kind] [1]) or 0) + won
    local total_lost = (val (losses_s [kind] [1]) or 0) + lost
    wins_s [kind]:set (total_won)
    losses_s [kind]:set (total_lost)

    if use_gate then
        local w = total_won - (val (wins_s [kind] [gate_window]) or 0)
        local l = total_lost - (val (losses_s [kind] [gate_window]) or 0)
        local t = 0
        if w + l >= GATE_MIN_SIGNALS then
            local z = (w - l) / (w + l) ^ 0.5
            t = clamp01 ((nabs (z) - gate_z) / GATE_RAMP)
            if z < 0 then t = -t end
        end
        trust [kind] = t
    end
end

-------------------------------------------------------------------------------
-- Decision for the next candle: 1 = HIGHER (CALL), -1 = LOWER (PUT), 0 = wait.
-------------------------------------------------------------------------------
local regime = nil
local adx = val (adx_s)
if adx then
    if adx >= ADX_TREND then regime = "trending"
    elseif adx <= ADX_RANGE then regime = "ranging"
    else regime = "mixed" end
end

local atr_ratio = nil
do
    local avg = val (atr_avg_s)
    if atr and avg and avg > 0 then atr_ratio = atr / avg end
end

local decision = 0
if rule_method ~= 1 and nbar > WARMUP and regime then
    local family_weight = REGIME_WEIGHT [regime]
    local potential, weighted = 0, 0
    local effective = {}
    for i, v in ipairs (votes) do
        local t = trust [v.kind]
        local base = v.weight * family_weight [v.kind]
        local w = base * nabs (t)
        local value = v.value
        if t < 0 then value = -value end
        if t ~= 0 then potential = potential + base end
        weighted = weighted + w * value
        effective [i] = { w = w, value = value, trigger = v.trigger }
    end
    local score = 0
    if potential > 0 then score = weighted / potential end
    local side = sgn (score)
    if side ~= 0 and nabs (score) >= min_score then
        local agree, agree_w, oppose_w, triggered = 0, 0, 0, false
        for _, e in ipairs (effective) do
            if e.w > 0 and e.value * side >= VOTE_FLOOR then
                agree = agree + 1
                agree_w = agree_w + e.w * nabs (e.value)
                if e.trigger then triggered = true end
            elseif e.w > 0 and e.value * side <= -VOTE_FLOOR then
                oppose_w = oppose_w + e.w * nabs (e.value)
            end
        end
        local calm = (atr_ratio == nil) or (atr_ratio >= MIN_ATR_RATIO and atr_ratio <= MAX_ATR_RATIO)
        if agree >= min_agree and triggered and oppose_w <= MAX_OPPOSE * agree_w and calm then
            decision = side
        end
    end
end
if rule_method == 1 then
    -- Breakout: the close is at (or within rule_zone % of the range from) the high / low of the
    -- last rule_candles candles, this one included, and its body is at least rule_body % of the candle.
    local hh, ll = val (breakout_hi_s), val (breakout_lo_s)
    if hh and ll and o0 and h0 and l0 and c0 and hh > ll and nabs (c0 - o0) >= rule_body / 100 * (h0 - l0) then
        local zone = rule_zone / 100 * (hh - ll)
        if c0 >= hh - zone then decision = 1 elseif c0 <= ll + zone then decision = -1 end
    end
end
if rule_reverse and decision ~= 0 then decision = -decision end
decision_s:set (decision)

-------------------------------------------------------------------------------
-- Output. The arrow sits on the candle to trade; it was decided when the
-- previous candle closed, so it is already final when this candle opens.
-------------------------------------------------------------------------------
local shown = val (decision_s [1]) or 0
local traded = show_marks and shown ~= 0

plot_shape (shown == 1, "CALL", shape_style.arrowup, shape_size.large, call_color,
    shape_location.belowbar, 0, "CALL", call_color)
plot_shape (shown == -1, "PUT", shape_style.arrowdown, shape_size.large, put_color,
    shape_location.abovebar, 0, "PUT", put_color)

plot_shape (traded and move == shown, "Win", shape_style.circle, shape_size.tiny, win_color,
    shape_location.bottom)
plot_shape (traded and move == -shown, "Loss", shape_style.xcross, shape_size.tiny, loss_color,
    shape_location.bottom)
plot_shape (traded and move == 0, "Tie", shape_style.diamond, shape_size.tiny, tie_color,
    shape_location.bottom)

if shown == 1 then
    advise (advice.buy)
elseif shown == -1 then
    advise (advice.sell)
else
    advise (advice.neutral)
end

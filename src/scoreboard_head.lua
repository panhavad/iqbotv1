-- Next Minute Scoreboard - Quadcode Script (QCS) indicator for IQ Option charts
-- Companion of "Next Minute HIGHER/LOWER": it evaluates exactly the same arrows and
-- plots how often they really won on this chart (only candles that have closed).
--
--   Win rate (all)     : wins / (wins + losses) over every arrow on the chart.
--   95% band           : where the true win rate lies with 95% confidence. A narrow
--                        band needs many trades; with few trades it is wide.
--   Win rate (recent)  : the same over the last "Recent window" candles.
--   Break-even line    : 100 / (100 + payout). Above it the arrows made money.
--
-- The arrows only have a real edge if the WHOLE band stays above the break-even
-- line. Use the same "Signal rules" settings in both scripts.

instrument { name = "Next Minute Scoreboard", short_name = "SCORE 1M", overlay = false }

input_group {
    "Scoreboard",
    payout      = input (88, "Payout % shown in the traderoom", input.integer, 1, 100),
    recent_bars = input (240, "Recent window (candles)", input.integer, 30, 5000)
}

input_group {
    "Colors",
    rate_color   = input { default = "#56CEFF", name = "Win rate (all)", type = input.color },
    recent_color = input { default = "#FF7700", name = "Win rate (recent)", type = input.color },
    band_color   = input { default = rgba (86, 206, 255, 0.12), name = "95% band", type = input.color },
    even_color   = input { default = "#DB4931", name = "Break-even", type = input.color }
}


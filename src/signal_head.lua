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



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

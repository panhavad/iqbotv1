"""Momentum on real crypto: when a 1-minute candle closes at the high (low) of the last N candles,
does the next candle continue in the same direction?

    .venv\\Scripts\\python.exe research\\momentum.py

N and the closeness to the extreme are chosen on Bitcoin's training + validation period only.
The choice is then checked on Bitcoin's test period, on other real coins it never saw, on the
OTC assets, and with a realistic entry price (5 s after the candle opens) from 5-second candles.
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candles as cd  # noqa: E402
from study import wilson  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def breakout(s: cd.Series, n: int, edge: float) -> np.ndarray:
    """+1 when the close is in the top (1 - edge) of the last n candles' range, -1 in the bottom."""
    hh = cd.rolling(s.h, n, np.max)
    ll = cd.rolling(s.l, n, np.min)
    with np.errstate(divide="ignore", invalid="ignore"):
        pos = np.where(hh > ll, (s.c - ll) / (hh - ll), 0.5)
    pred = np.where(pos >= edge, 1, np.where(pos <= 1 - edge, -1, 0))
    pred[np.isnan(hh)] = 0
    return pred


def outcome(s: cd.Series, size: int = 60) -> tuple[np.ndarray, np.ndarray]:
    """y[t] = colour of candle t+1; ok[t] = candle t+1 directly follows candle t."""
    y = np.zeros(len(s.c))
    y[:-1] = np.sign(s.c[1:] - s.o[1:])
    ok = np.zeros(len(s.c), dtype=bool)
    ok[:-1] = (s.t[1:] - s.t[:-1]) == size
    return y, ok


def rate(pred, y, mask):
    m = mask & (pred != 0) & (y != 0)
    n = int(m.sum())
    w = int((pred[m] == y[m]).sum())
    return w, n


def cell(w, n, days):
    if not n:
        return "-"
    lo, hi = wilson(w, n)
    return f"**{100 * w / n:.1f}%** ({n:,}; {100 * lo:.1f}-{100 * hi:.1f}%; {n / days:.0f}/day)"


def main(size: int = 60):
    out = [f"# Momentum on real crypto ({size // 60}-minute candles)", ""]
    btc = cd.load("BTCUSD", size)
    y, ok = outcome(btc, size)
    n = len(y)
    idx = np.arange(n)
    fit = ok & (idx < int(0.8 * n))      # train + validation
    test = ok & (idx >= int(0.8 * n))
    grid = []
    for look in (5, 10, 14, 20, 30, 60):
        for edge in (1.0, 0.95, 0.9, 0.8):
            pred = breakout(btc, look, edge)
            w, k = rate(pred, y, fit)
            grid.append((w / k if k else 0, look, edge, k))
    grid.sort(reverse=True)
    out.append("Choices ranked on Bitcoin's first 80% (train + validation):\n")
    out.append("| N candles | Close within | Win rate (first 80%) | Trades |")
    out.append("|---|---|---|---|")
    for r, look, edge, k in grid[:8]:
        out.append(f"| {look} | top/bottom {100 * (1 - edge):.0f}% of the range | {100 * r:.1f}% | {k:,} |")
    _, look, edge, _ = grid[0]
    out.append(f"\nChosen: N = {look}, close within the top/bottom {100 * (1 - edge):.0f}% of the range.\n")

    out.append("| Data | Never seen when choosing? | Win rate (trades; 95% CI; per day) |")
    out.append("|---|---|---|")
    pred = breakout(btc, look, edge)
    w, k = rate(pred, y, test)
    out.append(f"| BTC/USD (real), last 20% | yes | {cell(w, k, 0.2 * (btc.t[-1] - btc.t[0]) / 86400)} |")
    for name in ("ETHUSD", "XRPUSD", "EURUSD", "EURUSD-OTC", "GBPUSD-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "CARDANO-OTC"):
        try:
            s = cd.load(name, size)
        except FileNotFoundError:
            continue
        ys, oks = outcome(s, size)
        w, k = rate(breakout(s, look, edge), ys, oks)
        out.append(f"| {name} | yes | {cell(w, k, (s.t[-1] - s.t[0]) / 86400)} |")

    # Realistic entry: price 5 s after the candle opens (5-second candles), exit at the candle close.
    five = None
    if size == 60:
        try:
            five = cd.load("BTCUSD", 5)
        except FileNotFoundError:
            pass
    if five is not None:
        first_close = {}
        last_close = {}
        for t, c in zip(five.t, five.c):
            minute = t - t % 60
            if t % 60 == 0:
                first_close[minute] = c
            last_close[minute] = c
        hits = {"open": [0, 0], "5s": [0, 0]}
        for i in range(len(btc.t) - 1):
            if pred[i] == 0 or not ok[i]:
                continue
            nxt = btc.t[i + 1]
            if nxt not in first_close or nxt not in last_close:
                continue
            for key, entry in (("open", btc.o[i + 1]), ("5s", first_close[nxt])):
                move = np.sign(btc.c[i + 1] - entry)
                if move != 0:
                    hits[key][1] += 1
                    hits[key][0] += int(move == pred[i])
        days = (five.t[-1] - five.t[0]) / 86400
        out.append(f"\nRealistic entry check on the {days:.0f} days with 5-second candles (same arrows):\n")
        out.append(f"- entry at the candle open: {cell(*hits['open'], days)}")
        out.append(f"- entry 5 s after the open (the extension buys about 1.5-3 s after it): {cell(*hits['5s'], days)}")
    text = "\n".join(out) + "\n"
    suffix = "" if size == 60 else f"-{size // 60}m"
    with open(os.path.join(HERE, f"results-momentum{suffix}.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 60)

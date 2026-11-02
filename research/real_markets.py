"""Round 3: the real markets, and a replay of the extension's own edge check.

    .venv\\Scripts\\python.exe research\\real_markets.py

1. A fresh check of the Bitcoin rule on older candles that rounds 1 and 2 never saw.
2. Every real-market asset that IQ Option offers with a 1-minute option (real-assets.json): is
   there a lasting edge for the breakout rule, or for the last candle's colour, followed or
   faded? A rule is selected on the first half of an asset's candles only if it is very unlikely
   to be luck there (p < 0.001), then judged once on the second half.
3. A replay of the extension: every 30 minutes it measures the breakout arrows of the last 5,000
   candles and trades only while the lower end of their 95% range beats break-even. The replay
   walks forward through each asset's history, so every decision uses only older candles.
4. The forex fade found in 2, with the entry price 5 s after the open (5-second candles).
5. The Bitcoin arrows at longer expiries (Bitcoin's Blitz options start at 3 minutes).
"""

from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candles as cd  # noqa: E402
from momentum import breakout, outcome  # noqa: E402
from study import wilson  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "real-assets.json"), encoding="utf-8") as _f:
    REAL = json.load(_f)
# First candle of the files used in rounds 1 and 2: anything older was never seen.
SEEN_FROM = {"BTCUSD": 1790931240, "ETHUSD": 1790932320, "XRPUSD": 1790932320}
PAYOUT_REAL = 86  # the lowest 1-minute payout of these real markets on 2 Nov 2026
# 1-minute payouts seen in the traderoom (Binary unless noted); used for the replay.
PAYOUT = {"EURUSD-OTC": 88, "GBPUSD-OTC": 85, "CARDANO-OTC": 82, "ETHUSD-OTC": 82, "BTCUSD-OTC": 82,
          "BTCUSD": 87, "ETHUSD": 87, "XRPUSD": 87, "EURUSD": 86}
Z_SELECT = 3.29  # p < 0.001, two-sided
EDGE_CANDLES = 5000
EDGE_EVERY = 1800


def arrows(s: cd.Series) -> np.ndarray:
    """The extension's default method: close at the 5-candle high -> CALL, at the low -> PUT."""
    return breakout(s, 5, 1.0).astype(int)


def colour(s: cd.Series) -> np.ndarray:
    """The last candle's colour: green -> CALL, red -> PUT."""
    return np.sign(s.c - s.o).astype(int)


def counts(pred, y, mask) -> tuple[int, int]:
    m = mask & (pred != 0) & (y != 0)
    return int((pred[m] == y[m]).sum()), int(m.sum())


def zscore(w: int, n: int) -> float:
    return (w - n / 2) / math.sqrt(n / 4) if n else 0.0


def cell(w: int, n: int, per_day: float | None = None, bold: bool = True) -> str:
    if not n:
        return "-"
    lo, hi = wilson(w, n)
    rate = f"{100 * w / n:.1f}%"
    extra = f"; {per_day:.0f}/day" if per_day else ""
    return f"{'**' + rate + '**' if bold else rate} ({n:,}; {100 * lo:.1f}-{100 * hi:.1f}%{extra})"


def trading_days(s: cd.Series, mask=None) -> int:
    t = s.t if mask is None else s.t[mask]
    return max(1, len(np.unique(t // 86400)))


def breakeven(payout: float) -> float:
    return 100 / (100 + payout)


# --------------------------------------------------------------------------- 1. fresh Bitcoin
def fresh_check(out: list[str]) -> None:
    out += ["## 1. The Bitcoin rule on older candles it never saw", "",
            "Rounds 1 and 2 used the 30 days from 2 Oct 2026. These are the candles before that, "
            "downloaded afterwards; the rule (5 candles, close at the extreme) was not changed.", "",
            "| Asset | Never seen (before 2 Oct) | Seen in rounds 1-2 (2 Oct - 1 Nov) |", "|---|---|---|"]
    for name in ("BTCUSD", "ETHUSD", "XRPUSD"):
        try:
            s = cd.load(name)
        except FileNotFoundError:
            continue
        y, ok = outcome(s)
        pred = arrows(s)
        fresh = ok & (s.t + 60 < SEEN_FROM[name])
        seen = ok & (s.t >= SEEN_FROM[name])
        w1, n1 = counts(pred, y, fresh)
        w2, n2 = counts(pred, y, seen)
        span = ""
        if fresh.any():
            first = s.t[fresh][0]
            span = f" from {np.datetime64(int(first), 's').astype('datetime64[D]')}"
        out.append(f"| {name}{span} | {cell(w1, n1, n1 / trading_days(s, fresh) if n1 else None)} | "
                   f"{cell(w2, n2, n2 / trading_days(s, seen), bold=False)} |")
    out.append("")


# --------------------------------------------------------------------------- 2. real markets
def real_markets(out: list[str]) -> list[tuple[str, str, int]]:
    be = breakeven(PAYOUT_REAL)
    out += ["## 2. Real markets with a 1-minute option", "",
            f"Each asset's candles are split in two halves by time. Break-even at {PAYOUT_REAL}%: "
            f"{100 * be:.1f}%. Win rates count the arrows' next candle (ties left out).", "",
            "| Asset | Candles (trading days) | Breakout, 1st half | Breakout, 2nd half | "
            "Colour, 1st half | Colour, 2nd half |", "|---|---|---|---|---|---|"]
    selected, skipped = [], []
    for a in REAL:
        try:
            s = cd.load("real/" + a["name"])
        except FileNotFoundError:
            skipped.append(a["label"] + " (no data)")
            continue
        if len(s) < 5000:
            skipped.append(f"{a['label']} ({len(s):,} candles)")
            continue
        y, ok = outcome(s)
        idx = np.arange(len(s))
        half = len(s) // 2
        first, second = ok & (idx < half), ok & (idx >= half)
        cells = []
        for rule, pred in (("breakout", arrows(s)), ("colour", colour(s))):
            w1, n1 = counts(pred, y, first)
            w2, n2 = counts(pred, y, second)
            cells += [cell(w1, n1, bold=False), cell(w2, n2, bold=False)]
            z = zscore(w1, n1)
            if abs(z) >= Z_SELECT:
                d = 1 if z > 0 else -1
                ww = w2 if d > 0 else n2 - w2
                selected.append((a["label"], rule, d, w1 if d > 0 else n1 - w1, n1, ww, n2,
                                 n2 / trading_days(s, second)))
        out.append(f"| {a['label']} | {len(s):,} ({trading_days(s)}) | " + " | ".join(cells) + " |")
    if skipped:
        out.append(f"\nNot enough data: {', '.join(skipped)}.")
    out += ["", "### Selected on the first half (p < 0.001), judged on the second half", ""]
    if not selected:
        out.append("Nothing was selected: no rule was clearly better or worse than a coin flip "
                   "on any asset's first half.")
    else:
        out += ["| Asset | Rule | Direction | 1st half | **2nd half (judged once)** | Beats break-even? |",
                "|---|---|---|---|---|---|"]
        for label, rule, d, w1, n1, w2, n2, per_day in selected:
            lo, _ = wilson(w2, n2)
            verdict = "yes" if lo > be else ("no" if w2 / max(n2, 1) < be else "not proven")
            out.append(f"| {label} | {rule} | {'follow' if d > 0 else 'fade'} | {cell(w1, n1, bold=False)} | "
                       f"{cell(w2, n2, per_day)} | {verdict} |")
    out.append("")
    return [(label, rule, d) for label, rule, d, *_ in selected]


# --------------------------------------------------------------------------- 3. replay
def replay(s: cd.Series, payout: float, by_month: dict | None = None) -> dict:
    """Walk forward like the extension: gate re-measured every EDGE_EVERY seconds."""
    y, ok = outcome(s)
    pred = arrows(s)
    valid = ok & (pred != 0) & (y != 0)
    won = valid & (pred == y)
    cv = np.concatenate([[0], np.cumsum(valid)])
    cw = np.concatenate([[0], np.cumsum(won)])
    be = breakeven(payout)
    block = s.t // EDGE_EVERY
    starts = np.flatnonzero(np.r_[True, block[1:] != block[:-1]])
    res = {"blocks": 0, "open": 0, "w": 0, "n": 0, "all_w": 0, "all_n": 0}
    for bi, k in enumerate(starts):
        if k < EDGE_CANDLES:
            continue
        end = starts[bi + 1] if bi + 1 < len(starts) else len(s)
        # Arrows whose result was known when the block started: j + 1 <= k - 1.
        lo_j, hi_j = k - EDGE_CANDLES, k - 1
        n, w = cv[hi_j] - cv[lo_j], cw[hi_j] - cw[lo_j]
        # Trades in the block: candles k .. end-1, i.e. arrows j = k-1 .. end-2.
        tn, tw = cv[end - 1] - cv[k - 1], cw[end - 1] - cw[k - 1]
        res["blocks"] += 1
        res["all_n"] += tn
        res["all_w"] += tw
        month = None
        if by_month is not None:
            month = str(np.datetime64(int(s.t[k]), "s").astype("datetime64[M]"))
            by_month.setdefault(month, {"blocks": 0, "open": 0, "w": 0, "n": 0})["blocks"] += 1
        if n and wilson(int(w), int(n))[0] >= be:
            res["open"] += 1
            res["n"] += tn
            res["w"] += tw
            if month:
                m = by_month[month]
                m["open"] += 1
                m["n"] += tn
                m["w"] += tw
    res["pnl"] = res["w"] * payout / 100 - (res["n"] - res["w"])
    return res


def replay_all(out: list[str]) -> None:
    out += ["## 3. Replay of the extension's edge check", "",
            "Every 30 minutes the extension replays the breakout arrows of the last 5,000 candles and "
            "trades the asset only while the lower end of their 95% range beats break-even. This "
            "replay does the same through each asset's history, using only older candles each time.", "",
            "| Asset | Payout | Gate open | Trades while open | Profit per $1 trade | Every arrow (gate off) |",
            "|---|---|---|---|---|---|"]
    names = [(n, PAYOUT.get(n, 86)) for n in ("BTCUSD", "ETHUSD", "XRPUSD", "EURUSD", "EURUSD-OTC",
                                              "GBPUSD-OTC", "CARDANO-OTC", "ETHUSD-OTC", "BTCUSD-OTC")]
    names += [("real/" + a["name"], PAYOUT_REAL) for a in REAL]
    total = {"w": 0, "n": 0, "pnl": 0.0}
    for name, payout in names:
        try:
            s = cd.load(name)
        except FileNotFoundError:
            continue
        if len(s) < EDGE_CANDLES + 1000:
            continue
        r = replay(s, payout)
        if not r["blocks"]:
            continue
        label = name.replace("real/", "")
        share = f"{100 * r['open'] / r['blocks']:.0f}% of the time"
        per_trade = f"{r['pnl'] / r['n']:+.3f}" if r["n"] else "-"
        out.append(f"| {label} | {payout}% | {share} | {cell(r['w'], r['n'])} | {per_trade} | "
                   f"{cell(r['all_w'], r['all_n'], bold=False)} |")
        total["w"] += r["w"]
        total["n"] += r["n"]
        total["pnl"] += r["pnl"]
    if total["n"]:
        out.append(f"\nAll assets together, trades while the gate was open: {cell(total['w'], total['n'])}, "
                   f"profit {total['pnl']:+.0f} per $1 stake ({total['pnl'] / total['n']:+.3f} per trade).")
    try:
        btc = cd.load("BTCUSD")
        months: dict = {}
        replay(btc, PAYOUT["BTCUSD"], months)
        out += ["", "Real Bitcoin by month (September was never used to choose the rule):", "",
                "| Month | Gate open | Trades while open |", "|---|---|---|"]
        for month, m in sorted(months.items()):
            out.append(f"| {month} | {100 * m['open'] / max(m['blocks'], 1):.0f}% of the time | {cell(m['w'], m['n'])} |")
    except FileNotFoundError:
        pass
    out.append("")


def horizons(out: list[str]) -> None:
    """The 1-minute breakout arrow judged at longer expiries (entry at the next open)."""
    out += ["## 5. Bitcoin at longer expiries", "",
            "Real Bitcoin's shortest Blitz expiry is 3 minutes. The same 1-minute arrows, judged from the "
            "next candle's open to the close 1 to 10 minutes later:", "",
            "| Expiry | BTC/USD | ETH/USD |", "|---|---|---|"]
    data = {}
    for name in ("BTCUSD", "ETHUSD"):
        try:
            data[name] = cd.load(name)
        except FileNotFoundError:
            pass
    for h in (1, 2, 3, 5, 10):
        cells = []
        for name in ("BTCUSD", "ETHUSD"):
            s = data.get(name)
            if s is None:
                cells.append("-")
                continue
            pred = arrows(s)
            idx = np.arange(len(s) - h)
            same = (s.t[idx + h] - s.t[idx]) == 60 * h
            move = np.sign(s.c[idx + h] - s.o[idx + 1])
            p = pred[idx]
            m = same & (p != 0) & (move != 0)
            cells.append(cell(int((p[m] == move[m]).sum()), int(m.sum()), bold=h == 1))
        out.append(f"| {h} min | " + " | ".join(cells) + " |")
    out.append("")


# --------------------------------------------------------------------------- 4. forex fade
FADE_5S = ("USDCAD", "GBPCAD", "CHFJPY", "EURUSD", "AUDUSD", "EURGBP", "NZDCAD", "AU200")
FOREX = [a["name"] for a in REAL if len(a["name"]) == 6 and a["label"][3:4] == "/"]


def fade_entry(out: list[str]) -> None:
    """The opposite of the breakout arrow, with the entry price 5 s after the candle opens."""
    out += ["## 4. Fading the breakout on real forex: realistic entry and hours", "",
            "The fade buys the opposite of the breakout arrow (PUT after a close at the 5-candle high). "
            "Entry 5 s after the open comes from 5-second candles of the last trading week (the extension "
            "buys about 2 s after the open). Blitz refunds a tie; on Digital a tie loses.", "",
            "| Asset | Entry at the open | Entry 5 s later | Entry 5 s later, ties lose (Digital) |",
            "|---|---|---|---|"]
    pooled = {"open": [0, 0, 0], "5s": [0, 0, 0]}
    for name in FADE_5S:
        try:
            s = cd.load("real/" + name)
            f = cd.load("real/" + name, 5)
        except FileNotFoundError:
            continue
        y, ok = outcome(s)
        pred = -arrows(s)
        first = {int(t): c for t, c in zip(f.t, f.c) if t % 60 == 0}  # price at about +5 s
        stats = {"open": [0, 0, 0], "5s": [0, 0, 0]}  # wins, decided, ties
        for i in np.flatnonzero(ok & (pred != 0)):
            nxt = int(s.t[i + 1])
            if nxt not in first:
                continue
            for key, entry in (("open", s.o[i + 1]), ("5s", first[nxt])):
                move = np.sign(s.c[i + 1] - entry)
                st = stats[key]
                if move == 0:
                    st[2] += 1
                else:
                    st[1] += 1
                    st[0] += int(move == pred[i])
        for key in stats:
            for k in range(3):
                pooled[key][k] += stats[key][k]
        w5, n5, t5 = stats["5s"]
        out.append(f"| {name} | {cell(stats['open'][0], stats['open'][1], bold=False)} | {cell(w5, n5)} | "
                   f"{cell(w5, n5 + t5, bold=False)} |")
    w5, n5, t5 = pooled["5s"]
    out.append(f"| **All together** | {cell(pooled['open'][0], pooled['open'][1], bold=False)} | {cell(w5, n5)} | "
               f"{cell(w5, n5 + t5, bold=False)} |")

    out += ["", "Fade on every real forex pair by hour (UTC), second half of the 1-minute data, entry at the open:", "",
            "| Hours (UTC) | Win rate |", "|---|---|"]
    by_hour: dict[int, list[int]] = {}
    for name in FOREX:
        try:
            s = cd.load("real/" + name)
        except FileNotFoundError:
            continue
        y, ok = outcome(s)
        pred = -arrows(s)
        idx = np.arange(len(s))
        m = ok & (idx >= len(s) // 2) & (pred != 0) & (y != 0)
        hours = (s.t[m] % 86400) // 10800
        hit = pred[m] == y[m]
        for h in range(8):
            sel = hours == h
            acc = by_hour.setdefault(h, [0, 0])
            acc[0] += int(hit[sel].sum())
            acc[1] += int(sel.sum())
    for h in range(8):
        w, n = by_hour.get(h, [0, 0])
        out.append(f"| {3 * h:02d}:00-{3 * h + 3:02d}:00 | {cell(w, n)} |")
    out.append("")


def main() -> None:
    out = ["# Round 3: real markets and a replay of the extension", ""]
    fresh_check(out)
    real_markets(out)
    replay_all(out)
    fade_entry(out)
    horizons(out)
    text = "\n".join(out) + "\n"
    with open(os.path.join(HERE, "results-real.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text)


if __name__ == "__main__":
    main()

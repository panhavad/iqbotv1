"""Candle loading and features for the signal research.

Every feature of row t uses candles 0..t only (the candle that has just closed and older ones).
The label of row t is the colour of candle t+1, the candle traded at its open:
+1 if it closed above its open, -1 below, 0 for a tie (a refund on IQ Option).
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass

import numpy as np

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


@dataclass
class Series:
    name: str
    t: np.ndarray  # open time, epoch seconds
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray

    def __len__(self) -> int:
        return len(self.t)


def load(name: str, size: int = 60) -> Series:
    path = os.path.join(DATA, f"{name}-{size}.csv")
    with open(path, encoding="utf-8") as handle:
        rows = list(csv.reader(handle))[1:]
    a = np.array(rows, dtype=float)
    a = a[np.argsort(a[:, 0])]
    return Series(name, a[:, 0].astype(np.int64), a[:, 1], a[:, 2], a[:, 3], a[:, 4])


def available() -> list[str]:
    return sorted(f[:-7] for f in os.listdir(DATA) if f.endswith("-60.csv"))


# --------------------------------------------------------------------------- indicators
def ema(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    a = 2.0 / (n + 1)
    s = x[:n].mean()
    out[n - 1] = s
    for i in range(n, len(x)):
        s = a * x[i] + (1 - a) * s
        out[i] = s
    return out


def rma(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    start = np.argmax(~np.isnan(x))
    if len(x) - start < n:
        return out
    s = np.nanmean(x[start:start + n])
    out[start + n - 1] = s
    for i in range(start + n, len(x)):
        s = (s * (n - 1) + x[i]) / n
        out[i] = s
    return out


def rolling(x: np.ndarray, n: int, fn) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view

    out = np.full(len(x), np.nan)
    if len(x) >= n:
        out[n - 1:] = fn(sliding_window_view(x, n), axis=-1)
    return out


def rsi(c: np.ndarray, n: int) -> np.ndarray:
    d = np.diff(c, prepend=np.nan)
    up = rma(np.where(np.isnan(d), np.nan, np.maximum(d, 0)), n)
    dn = rma(np.where(np.isnan(d), np.nan, np.maximum(-d, 0)), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        r = 100 - 100 / (1 + up / dn)
    r = np.where(dn == 0, np.where(up == 0, 50.0, 100.0), r)
    return r


def true_range(h, l, c):
    pc = np.roll(c, 1)
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    tr[0] = h[0] - l[0]
    return tr


def adx(h, l, c, n=14):
    up = np.diff(h, prepend=np.nan)
    dn = -np.diff(l, prepend=np.nan)
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    atr = rma(true_range(h, l, c), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        pdi = 100 * rma(pdm / atr, n)
        mdi = 100 * rma(mdm / atr, n)
        dx = np.abs(pdi - mdi) / (pdi + mdi)
    return 100 * rma(dx, n), pdi - mdi


def streak(sign: np.ndarray) -> np.ndarray:
    """Signed length of the current run of same-colour candles (0 for a doji)."""
    out = np.zeros(len(sign))
    run = 0.0
    for i, s in enumerate(sign):
        if s == 0:
            run = 0.0
        elif run * s > 0:
            run += s
        else:
            run = float(s)
        out[i] = run
    return out


# --------------------------------------------------------------------------- features
FEATURE_GROUPS = {
    "returns": ["r1", "r2", "r3", "r5", "r10", "r20", "r60"],
    "candle": ["body", "upper", "lower", "range", "body1", "body2", "gap"],
    "colour": ["c1", "c2", "c3", "c4", "c5", "streak"],
    "oscillators": ["rsi2", "rsi7", "rsi14", "stoch14", "bb_pos", "bb_width"],
    "trend": ["d_ema9", "d_ema21", "d_ema50", "d_ema100", "slope21", "macd", "adx", "di"],
    "volatility": ["atr_ratio", "range_ratio"],
    "position": ["pos10", "pos30", "pos60"],
    "time": ["min_sin", "min_cos", "hour_sin", "hour_cos", "dow"],
}
FEATURES = [f for group in FEATURE_GROUPS.values() for f in group]


def features(s: Series) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """X (rows = candles, columns = FEATURES), y = colour of the NEXT candle, valid mask."""
    o, h, l, c, t = s.o, s.h, s.l, s.c, s.t
    n = len(c)
    atr = rma(true_range(h, l, c), 14)
    atr100 = rolling(atr, 100, np.mean)
    unit = np.where(atr > 0, atr, np.nan)
    sign = np.sign(c - o)
    f: dict[str, np.ndarray] = {}

    def ret(k):
        out = np.full(n, np.nan)
        out[k:] = (c[k:] - c[:-k]) / unit[k:]
        return out

    for k in (1, 2, 3, 5, 10, 20, 60):
        f[f"r{k}"] = ret(k)
    f["body"] = (c - o) / unit
    f["upper"] = (h - np.maximum(o, c)) / unit
    f["lower"] = (np.minimum(o, c) - l) / unit
    f["range"] = (h - l) / unit
    f["body1"] = np.roll(f["body"], 1)
    f["body2"] = np.roll(f["body"], 2)
    gap = np.full(n, np.nan)
    gap[1:] = (o[1:] - c[:-1]) / unit[1:]
    f["gap"] = gap
    for k in range(1, 6):
        f[f"c{k}"] = np.roll(sign, k - 1)
    f["streak"] = streak(sign)
    f["rsi2"] = rsi(c, 2)
    f["rsi7"] = rsi(c, 7)
    f["rsi14"] = rsi(c, 14)
    hh = rolling(h, 14, np.max)
    ll = rolling(l, 14, np.min)
    with np.errstate(divide="ignore", invalid="ignore"):
        f["stoch14"] = np.where(hh > ll, 100 * (c - ll) / (hh - ll), 50.0)
    mid = rolling(c, 20, np.mean)
    sd = rolling(c, 20, np.std)
    with np.errstate(divide="ignore", invalid="ignore"):
        f["bb_pos"] = np.where(sd > 0, (c - mid) / (2 * sd), 0.0)
        f["bb_width"] = 4 * sd / unit
    for k in (9, 21, 50, 100):
        f[f"d_ema{k}"] = (c - ema(c, k)) / unit
    e21 = ema(c, 21)
    f["slope21"] = (e21 - np.roll(e21, 3)) / unit
    f["macd"] = (ema(c, 12) - ema(c, 26)) / unit
    ad, di = adx(h, l, c)
    f["adx"] = ad
    f["di"] = di
    f["atr_ratio"] = atr / atr100
    f["range_ratio"] = (h - l) / atr100
    for k in (10, 30, 60):
        hk = rolling(h, k, np.max)
        lk = rolling(l, k, np.min)
        with np.errstate(divide="ignore", invalid="ignore"):
            f[f"pos{k}"] = np.where(hk > lk, (c - lk) / (hk - lk), 0.5)
    # The NEXT candle's open time decides the time features (that is when the trade is made).
    nxt = t + 60
    minute = (nxt // 60) % 60
    hour = (nxt // 3600) % 24
    f["min_sin"] = np.sin(2 * np.pi * minute / 60)
    f["min_cos"] = np.cos(2 * np.pi * minute / 60)
    f["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    f["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    f["dow"] = ((nxt // 86400) + 4) % 7  # 0 = Monday

    X = np.column_stack([f[name] for name in FEATURES])
    y = np.zeros(n)
    y[:-1] = np.sign(c[1:] - o[1:])
    valid = np.ones(n, dtype=bool)
    valid[:120] = False  # indicator warm-up
    valid[-1] = False  # no next candle
    valid[:-1] &= (t[1:] - t[:-1]) == 60  # the next candle follows directly (no gap)
    valid &= np.all(np.isfinite(X), axis=1)
    return X, y, valid

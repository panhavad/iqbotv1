"""Test-only reference code: candles, synthetic markets and textbook indicators.

The indicators follow the original authors / TA-Lib (Wilder smoothing for RSI and
ATR, population standard deviation for Bollinger Bands) and are pinned to
independent values in test_reference.py. The emulator's built-ins are compared
against them, which is how the emulator itself is trusted.

The synthetic markets are *not* a model of IQ Option's OTC prices. They exist to
show that the script finds nothing in pure noise and finds real structure where
there is some. They are deterministic for a given seed.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

Series = list  # list[Optional[float]]


@dataclass(frozen=True, slots=True)
class Candle:
    """One OHLC bar. `ts` is the bar's open time in epoch seconds (UTC)."""

    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


# --------------------------------------------------------------------------- #
# Synthetic markets
# --------------------------------------------------------------------------- #
T0 = 1_700_000_100  # a multiple of 300 so 5-minute buckets line up


def _build(
    n: int,
    start: float,
    tick: Callable[[float, random.Random], float],
    seed: int,
    ticks_per_candle: int = 12,
    decimals: int = 6,
) -> list[Candle]:
    rng = random.Random(seed)
    price = start
    candles: list[Candle] = []
    for k in range(n):
        open_ = price
        high = low = price
        for _ in range(ticks_per_candle):
            price = tick(price, rng)
            high = max(high, price)
            low = min(low, price)
        candles.append(
            Candle(
                T0 + 60 * k,
                round(open_, decimals),
                round(high, decimals),
                round(low, decimals),
                round(price, decimals),
                float(ticks_per_candle),
            )
        )
    return candles


def random_walk(n: int, seed: int = 1, sigma: float = 0.00002, start: float = 1.11) -> list[Candle]:
    """Driftless Gaussian random walk: unpredictable by construction."""
    return _build(n, start, lambda p, rng: p + rng.gauss(0.0, sigma), seed)


def mean_reverting(
    n: int, seed: int = 1, sigma: float = 0.00002, theta: float = 0.005, start: float = 1.11
) -> list[Candle]:
    """Range-bound market: Ornstein-Uhlenbeck swings (half-life ~12 candles) around a slow anchor."""
    state = {"anchor": start}

    def tick(price: float, rng: random.Random) -> float:
        state["anchor"] += rng.gauss(0.0, sigma * 0.05)
        return price + theta * (state["anchor"] - price) + rng.gauss(0.0, sigma)

    return _build(n, start, tick, seed)


def trending(
    n: int, seed: int = 1, sigma: float = 0.00002, drift: float = 0.1, switch: float = 0.004,
    start: float = 1.11,
) -> list[Candle]:
    """Random walk whose drift flips between up / down / flat regimes."""
    state = {"regime": 0}

    def tick(price: float, rng: random.Random) -> float:
        if rng.random() < switch:
            state["regime"] = rng.choice((-1, 0, 1))
        return price + state["regime"] * drift * sigma + rng.gauss(0.0, sigma)

    return _build(n, start, tick, seed)


# --------------------------------------------------------------------------- #
# Reference indicators (warm-up positions hold None)
# --------------------------------------------------------------------------- #
def _first_valid(values: Sequence[Optional[float]]) -> Optional[int]:
    for i, v in enumerate(values):
        if v is not None:
            return i
    return None


def sma(values: Sequence[Optional[float]], n: int) -> Series:
    """Simple moving average. Leading ``None`` values are skipped."""
    if n <= 0:
        raise ValueError("n must be positive")
    out: Series = [None] * len(values)
    start = _first_valid(values)
    if start is None:
        return out
    total = 0.0
    for i in range(start, len(values)):
        total += values[i]  # type: ignore[operator]
        if i - start >= n:
            total -= values[i - n]  # type: ignore[operator]
        if i - start >= n - 1:
            out[i] = total / n
    return out


def ema(values: Sequence[Optional[float]], n: int) -> Series:
    """Exponential moving average seeded with the SMA of the first ``n`` values."""
    if n <= 0:
        raise ValueError("n must be positive")
    out: Series = [None] * len(values)
    start = _first_valid(values)
    if start is None or len(values) - start < n:
        return out
    seed = start + n - 1
    prev = sum(values[start : seed + 1]) / n  # type: ignore[arg-type]
    out[seed] = prev
    k = 2.0 / (n + 1)
    for i in range(seed + 1, len(values)):
        prev = values[i] * k + prev * (1.0 - k)  # type: ignore[operator]
        out[i] = prev
    return out


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 50.0 if avg_gain == 0 else 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def rsi(closes: Sequence[float], n: int = 14) -> Series:
    """Wilder's Relative Strength Index."""
    out: Series = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            gains += d
        else:
            losses -= d
    avg_gain, avg_loss = gains / n, losses / n
    out[n] = _rsi_value(avg_gain, avg_loss)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (n - 1) + (d if d > 0 else 0.0)) / n
        avg_loss = (avg_loss * (n - 1) + (-d if d < 0 else 0.0)) / n
        out[i] = _rsi_value(avg_gain, avg_loss)
    return out


def bollinger(
    closes: Sequence[float], n: int = 20, k: float = 2.0
) -> tuple[Series, Series, Series, Series, Series]:
    """Bollinger Bands: (middle, upper, lower, %B, bandwidth)."""
    size = len(closes)
    mid: Series = [None] * size
    upper: Series = [None] * size
    lower: Series = [None] * size
    pct_b: Series = [None] * size
    width: Series = [None] * size
    for i in range(n - 1, size):
        window = closes[i - n + 1 : i + 1]
        mean = sum(window) / n
        sd = math.sqrt(sum((x - mean) ** 2 for x in window) / n)
        mid[i] = mean
        upper[i] = mean + k * sd
        lower[i] = mean - k * sd
        span = upper[i] - lower[i]
        pct_b[i] = (closes[i] - lower[i]) / span if span > 0 else 0.5
        width[i] = span / mean if mean else None
    return mid, upper, lower, pct_b, width


def true_range(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float]) -> list[float]:
    tr = [highs[0] - lows[0]] if highs else []
    for i in range(1, len(closes)):
        tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    return tr


def atr(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float], n: int = 14) -> Series:
    """Wilder's Average True Range (first value at index ``n``, as in TA-Lib)."""
    size = len(closes)
    out: Series = [None] * size
    if size <= n:
        return out
    tr = true_range(highs, lows, closes)
    value = sum(tr[1 : n + 1]) / n
    out[n] = value
    for i in range(n + 1, size):
        value = (value * (n - 1) + tr[i]) / n
        out[i] = value
    return out


def psar(
    highs: Sequence[float],
    lows: Sequence[float],
    closes: Sequence[float],
    step: float = 0.02,
    max_step: float = 0.2,
) -> tuple[Series, list[int]]:
    """Wilder's Parabolic SAR: (sar values, trend) with trend = +1 up / -1 down."""
    size = len(closes)
    sar: Series = [None] * size
    trend = [0] * size
    if size < 2:
        return sar, trend
    up = closes[1] >= closes[0]
    sar[0] = lows[0] if up else highs[0]
    trend[0] = 1 if up else -1
    ep = highs[0] if up else lows[0]
    af = step
    for i in range(1, size):
        value = sar[i - 1] + af * (ep - sar[i - 1])  # type: ignore[operator]
        if up:
            value = min(value, lows[i - 1], lows[i - 2] if i >= 2 else lows[i - 1])
            if lows[i] < value:
                up, value, ep, af = False, max(ep, highs[i - 1], highs[i]), lows[i], step
            elif highs[i] > ep:
                ep, af = highs[i], min(af + step, max_step)
        else:
            value = max(value, highs[i - 1], highs[i - 2] if i >= 2 else highs[i - 1])
            if highs[i] > value:
                up, value, ep, af = True, min(ep, lows[i - 1], lows[i]), highs[i], step
            elif lows[i] < ep:
                ep, af = lows[i], min(af + step, max_step)
        sar[i] = value
        trend[i] = 1 if up else -1
    return sar, trend

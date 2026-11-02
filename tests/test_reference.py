"""Pins the reference indicators (the yardstick for the emulator) to independent values."""

from __future__ import annotations

import math
import random
import statistics
import unittest

from . import reference as ref


def formula_series(n: int = 300):
    """Deterministic OHLC built from a closed-form price (no RNG)."""

    def price(t: float) -> float:
        return 1.1 + 0.002 * math.sin(t / 7.0) + 0.001 * math.sin(t / 3.1) + 0.0004 * math.cos(t * 1.7) + 0.00001 * t

    opens, highs, lows, closes = [], [], [], []
    for t in range(n):
        o, c = price(t), price(t + 1)
        opens.append(o)
        closes.append(c)
        highs.append(max(o, c) + 0.0001 * (1 + math.sin(t)))
        lows.append(min(o, c) - 0.0001 * (1 + math.cos(t)))
    return opens, highs, lows, closes


# Values produced by the third-party `ta` library (0.11) for formula_series(1200) at bars
# 1199, 1100 and 1000 (late enough that differently seeded recursions have converged).
GOLDEN_SERIES_LENGTH = 1200
GOLDEN_BARS = [1199, 1100, 1000]
GOLDEN = {
    "rsi14": [54.7124240549, 60.4423673353, 43.3993371706],
    "bb_upper": [1.1162058557, 1.1122331462, 1.1116591186],
    "bb_lower": [1.1086727252, 1.1070729786, 1.1074618797],
    "bb_pctb": [0.5939037904, 0.8709694268, 0.3293200584],
    "atr14": [0.0006386579, 0.0006306376, 0.0006283918],
    "ema21": [1.1128485789, 1.1104279681, 1.1094536229],
}


class GoldenValueTests(unittest.TestCase):
    def test_against_the_ta_library(self):
        _, h, l, c = formula_series(GOLDEN_SERIES_LENGTH)
        _, up, lo, pct_b, _ = ref.bollinger(c, 20, 2.0)
        series = {
            "rsi14": ref.rsi(c, 14),
            "bb_upper": up,
            "bb_lower": lo,
            "bb_pctb": pct_b,
            "atr14": ref.atr(h, l, c, 14),
            "ema21": ref.ema(c, 21),
        }
        for name, values in series.items():
            for bar, want in zip(GOLDEN_BARS, GOLDEN[name]):
                self.assertAlmostEqual(values[bar], want, places=8, msg=f"{name}[{bar}]")


class IndicatorTests(unittest.TestCase):
    def setUp(self):
        rng = random.Random(3)
        self.values = [100 + rng.gauss(0, 1) for _ in range(120)]

    def test_sma_matches_naive_window_mean(self):
        out = ref.sma(self.values, 10)
        self.assertTrue(all(v is None for v in out[:9]))
        for i in range(9, len(self.values)):
            self.assertAlmostEqual(out[i], sum(self.values[i - 9 : i + 1]) / 10, places=9)

    def test_ema_matches_naive_recursion_seeded_with_sma(self):
        n = 12
        out = ref.ema(self.values, n)
        expected = sum(self.values[:n]) / n
        self.assertAlmostEqual(out[n - 1], expected, places=9)
        k = 2 / (n + 1)
        for i in range(n, len(self.values)):
            expected = self.values[i] * k + expected * (1 - k)
            self.assertAlmostEqual(out[i], expected, places=9)

    def test_rsi_matches_wilders_textbook_example(self):
        closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
                  45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439,
                  46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672,
                  43.4205, 42.6628, 43.1314]
        expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42,
                    39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77]
        got = [v for v in ref.rsi(closes, 14) if v is not None]
        self.assertEqual(len(got), len(expected))
        for g, e in zip(got, expected):
            self.assertAlmostEqual(g, e, delta=0.006)

    def test_rsi_extremes(self):
        self.assertEqual(ref.rsi([1.0 + 0.01 * i for i in range(40)], 14)[-1], 100.0)
        self.assertEqual(ref.rsi([1.0 - 0.01 * i for i in range(40)], 14)[-1], 0.0)
        self.assertEqual(ref.rsi([1.0] * 40, 14)[-1], 50.0)

    def test_bollinger_matches_population_stdev(self):
        closes = formula_series()[3]
        mid, up, lo, pct_b, _ = ref.bollinger(closes, 20, 2.0)
        for i in (19, 100, 299):
            window = closes[i - 19 : i + 1]
            mean, sd = statistics.fmean(window), statistics.pstdev(window)
            self.assertAlmostEqual(mid[i], mean, places=12)
            self.assertAlmostEqual(up[i], mean + 2 * sd, places=12)
            self.assertAlmostEqual(lo[i], mean - 2 * sd, places=12)
            self.assertAlmostEqual(pct_b[i], (closes[i] - lo[i]) / (up[i] - lo[i]), places=12)

    def test_atr_matches_naive_wilder_loop(self):
        _, highs, lows, closes = formula_series()
        out = ref.atr(highs, lows, closes, 14)
        tr = [highs[0] - lows[0]] + [
            max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
            for i in range(1, len(closes))
        ]
        value = sum(tr[1:15]) / 14
        self.assertAlmostEqual(out[14], value, places=12)
        for i in range(15, len(closes)):
            value = (value * 13 + tr[i]) / 14
            self.assertAlmostEqual(out[i], value, places=12)

    def test_psar_hand_computed_example(self):
        highs = [10, 11, 12, 12.5, 13, 12]
        lows = [9, 9.5, 10.5, 11, 11.5, 9.0]
        closes = [9.5, 10.8, 11.8, 12.2, 12.9, 9.4]
        sar, trend = ref.psar(highs, lows, closes)
        for got, want in zip(sar, [9.0, 9.0, 9.0, 9.18, 9.4456, 13.0]):
            self.assertAlmostEqual(got, want, places=9)
        self.assertEqual(trend, [1, 1, 1, 1, 1, -1])

    def test_psar_matches_forward_computed_version(self):
        candles = ref.trending(1500, seed=4)
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        closes = [c.close for c in candles]
        sar, trend = ref.psar(highs, lows, closes)
        fwd_sar, fwd_trend = forward_psar(highs, lows, closes)
        self.assertEqual(trend, fwd_trend)
        for a, b in zip(sar, fwd_sar):
            self.assertAlmostEqual(a, b, places=12)
        self.assertGreater(sum(1 for a, b in zip(trend, trend[1:]) if a != b), 30)

    def test_indicators_are_causal(self):
        candles = ref.trending(400, seed=9)
        h = [c.high for c in candles]
        l = [c.low for c in candles]
        c = [c.close for c in candles]

        def run(end):
            hh, ll, cc = h[:end], l[:end], c[:end]
            bb = ref.bollinger(cc)
            sar, trend = ref.psar(hh, ll, cc)
            return {
                "sma": ref.sma(cc, 20), "ema": ref.ema(cc, 21), "rsi": ref.rsi(cc, 14),
                "atr": ref.atr(hh, ll, cc), "bb_up": bb[1], "bb_lo": bb[2], "sar": sar, "trend": trend,
            }

        full = run(len(candles))
        for end in (150, 233, 399):
            for name, series in run(end).items():
                self.assertEqual(series[-1], full[name][end - 1], msg=f"{name} uses future data at bar {end - 1}")


class SyntheticMarketTests(unittest.TestCase):
    def test_generators_are_deterministic_and_well_formed(self):
        for gen in (ref.random_walk, ref.mean_reverting, ref.trending):
            candles = gen(300, seed=5)
            self.assertEqual(candles, gen(300, seed=5))
            self.assertNotEqual(candles, gen(300, seed=6))
            for k, c in enumerate(candles):
                self.assertEqual(c.ts, ref.T0 + 60 * k)
                self.assertGreaterEqual(c.high, max(c.open, c.close))
                self.assertLessEqual(c.low, min(c.open, c.close))
            for a, b in zip(candles, candles[1:]):
                self.assertEqual(b.open, a.close)


def forward_psar(highs, lows, closes, step=0.02, max_step=0.2):
    """Forward-computing Parabolic SAR (TA-Lib style), an independent cross-check."""
    n = len(highs)
    is_long = closes[1] >= closes[0]
    ep = highs[0] if is_long else lows[0]
    af = step
    sar = lows[0] if is_long else highs[0]
    out_sar, out_trend = [sar], [1 if is_long else -1]
    next_sar = sar + af * (ep - sar)
    next_sar = min(next_sar, lows[0]) if is_long else max(next_sar, highs[0])
    for i in range(1, n):
        sar = next_sar
        if is_long and lows[i] < sar:
            is_long, sar, ep, af = False, max(ep, highs[i - 1], highs[i]), lows[i], step
        elif not is_long and highs[i] > sar:
            is_long, sar, ep, af = True, min(ep, lows[i - 1], lows[i]), highs[i], step
        elif is_long and highs[i] > ep:
            ep, af = highs[i], min(af + step, max_step)
        elif not is_long and lows[i] < ep:
            ep, af = lows[i], min(af + step, max_step)
        out_sar.append(sar)
        out_trend.append(1 if is_long else -1)
        next_sar = sar + af * (ep - sar)
        if is_long:
            next_sar = min(next_sar, lows[i], lows[i - 1])
        else:
            next_sar = max(next_sar, highs[i], highs[i - 1])
    return out_sar, out_trend


if __name__ == "__main__":
    unittest.main()

"""Tests for the IQ Option Quadcode Script (QCS) indicators, run through the QCS emulator."""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import unittest

from . import qcs
from . import reference as ref
from .reference import Candle

SIGNAL = qcs.read(qcs.SIGNAL_SCRIPT)
SCOREBOARD = qcs.read(qcs.SCOREBOARD_SCRIPT)
METHOD = "Signal method"  # 1 = breakout momentum (default), 2 = 15-strategy vote
VOTE = {METHOD: 2}
GATE = "Vote: evidence gate"
RULE_INPUTS = {
    METHOD: 1,
    "Breakout: candles": 5,
    "Breakout: close within (% of range)": 0,
    "Breakout: minimum body (% of candle)": 0,
    "Reverse the arrows (fade)": False,
    "Vote: minimum agreement score": 0.30,
    "Vote: minimum agreeing strategies": 3,
    GATE: False,
    "Vote: evidence window (candles)": 1000,
    "Vote: evidence needed (z-score)": 2.0,
    "Use the settings learned for each asset": True,
}


def result_of(candle: Candle) -> int:
    return (candle.close > candle.open) - (candle.close < candle.open)


def outcomes(candles, arrows, upto=None):
    """(wins, losses, ties) of the arrows on candles[:upto]."""
    w = l = t = 0
    for i, a in enumerate(arrows[:upto]):
        if a:
            r = result_of(candles[i])
            if r == 0:
                t += 1
            elif r == a:
                w += 1
            else:
                l += 1
    return w, l, t


_CACHE: dict = {}


def cached(market: str, n: int, seed: int, script: str = "signal", inputs=None):
    key = (market, n, seed, script, tuple(sorted((inputs or {}).items())))
    if key not in _CACHE:
        gen = {"random": ref.random_walk, "ranging": ref.mean_reverting, "trending": ref.trending}[market]
        candles = gen(n, seed=seed)
        source = SIGNAL if script == "signal" else SCOREBOARD
        _CACHE[key] = (candles, qcs.run(source, candles, inputs))
    return _CACHE[key]


class BuildTests(unittest.TestCase):
    def test_built_scripts_are_up_to_date(self):
        proc = subprocess.run([sys.executable, os.path.join(qcs.SCRIPT_DIR, "build.py"), "--check"],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    def test_scripts_are_plain_ascii(self):
        for text in (SIGNAL, SCOREBOARD):
            text.encode("ascii")

    def test_instrument_is_the_first_statement(self):
        for text in (SIGNAL, SCOREBOARD):
            code = [line for line in text.splitlines() if line.strip() and not line.strip().startswith("--")]
            self.assertTrue(code[0].startswith("instrument {"), code[0])

    def test_both_scripts_share_the_same_signal_rules(self):
        _, signal = cached("trending", 400, 1)
        _, board = cached("trending", 400, 1, "scoreboard")
        rules = lambda r: [(i["name"], i["default"]) for i in r.inputs if i["name"] in RULE_INPUTS]
        self.assertEqual(rules(signal), rules(board))
        self.assertEqual(dict(rules(signal)), RULE_INPUTS)

    def test_declarations(self):
        _, signal = cached("trending", 400, 1)
        _, board = cached("trending", 400, 1, "scoreboard")
        self.assertEqual(signal.instrument["name"], "Next Minute HIGHER/LOWER")
        self.assertTrue(signal.instrument["overlay"])
        self.assertEqual(board.instrument["name"], "Next Minute Scoreboard")
        self.assertFalse(board.instrument["overlay"])

    def test_new_inputs_come_last(self):
        """The traderoom keeps a chart's input values by position (a values array, recorded on
        2 Nov 2026), and the extension updates the script in place: new inputs must be added last."""
        _, signal = cached("trending", 400, 1)
        names = [i["name"] for i in signal.inputs]
        self.assertEqual(names[:16], [
            "CALL / HIGHER", "PUT / LOWER", "Show win / loss marks", "Win", "Loss", "Tie",
            "Signal method", "Breakout: candles", "Breakout: close within (% of range)",
            "Breakout: minimum body (% of candle)", "Reverse the arrows (fade)",
            "Vote: minimum agreement score", "Vote: minimum agreeing strategies", "Vote: evidence gate",
            "Vote: evidence window (candles)", "Vote: evidence needed (z-score)"])
        self.assertEqual(names[16:], ["Use the settings learned for each asset"])


PROBE = """
instrument { name = "probe", overlay = false }
plot (ema (close, 21), "ema21", "red")
plot (sma (close, 20), "sma20", "red")
plot (rsi (close, 14), "rsi14", "red")
plot (rma (tr, 14), "atr14", "red")
plot (stdev (close, 20), "stdev20", "red")
plot (highest (high, 14), "hh14", "red")
plot (lowest (low, 14), "ll14", "red")
plot (sar (0.02, 0.02, 0.2), "sar", "red")
local m = make_series ()
m:set (get_value (close [1], 0) * 2)
plot (m, "made", "red")
plot (m [3], "made3", "red")
plot ((close - open) / 2, "derived", "red")
local delta = close - close [1]
local up, down = ssma (max (delta, 0), 14), ssma (max (-delta, 0), 14)
plot (100 - 100 / (1 + up / down), "rsi_from_ssma", "red")
"""


class EmulatorFidelityTests(unittest.TestCase):
    """The emulator's built-ins must match the reference indicators (pinned in test_reference.py)."""

    @classmethod
    def setUpClass(cls):
        cls.candles = ref.trending(900, seed=7)
        cls.res = qcs.run(PROBE, cls.candles)
        cls.o = [c.open for c in cls.candles]
        cls.h = [c.high for c in cls.candles]
        cls.l = [c.low for c in cls.candles]
        cls.c = [c.close for c in cls.candles]

    def compare(self, name, expected, start, delta):
        got = self.res.plots[name]
        for i in range(start, len(self.candles)):
            self.assertIsNotNone(got[i], f"{name}[{i}] missing")
            self.assertAlmostEqual(got[i], expected[i], delta=delta, msg=f"{name}[{i}]")

    def test_moving_averages_and_rsi(self):
        self.compare("ema21", ref.ema(self.c, 21), 20, 1e-12)
        self.compare("sma20", ref.sma(self.c, 20), 19, 1e-12)
        self.compare("rsi14", ref.rsi(self.c, 14), 14, 1e-9)
        self.assertTrue(all(v is None for v in self.res.plots["ema21"][:20]))

    def test_rsi_built_like_the_platform_script(self):
        """delta / max / ssma, as in the platform's own RSI script, is Wilder's RSI."""
        self.compare("rsi_from_ssma", ref.rsi(self.c, 14), 14, 1e-9)

    def test_volatility(self):
        self.compare("atr14", ref.atr(self.h, self.l, self.c, 14), 300, 1e-12)
        mid, upper, *_ = ref.bollinger(self.c, 20, 2.0)
        self.compare("stdev20", [None if u is None else (u - m) / 2 for u, m in zip(upper, mid)], 19, 1e-12)

    def test_extremes_and_sar(self):
        hh = [None] * 13 + [max(self.h[i - 13 : i + 1]) for i in range(13, len(self.h))]
        ll = [None] * 13 + [min(self.l[i - 13 : i + 1]) for i in range(13, len(self.l))]
        self.compare("hh14", hh, 13, 0)
        self.compare("ll14", ll, 13, 0)
        self.compare("sar", ref.psar(self.h, self.l, self.c)[0], 1, 1e-12)

    def test_make_series_history_and_derived_series(self):
        made, made3 = self.res.plots["made"], self.res.plots["made3"]
        self.assertEqual(made[0], 0)
        for i in range(1, len(self.c)):
            self.assertAlmostEqual(made[i], self.c[i - 1] * 2, delta=1e-12)
        for i in range(4, len(self.c)):
            self.assertAlmostEqual(made3[i], made[i - 3], delta=1e-12)
        for i, (o, c) in enumerate(zip(self.o, self.c)):
            self.assertAlmostEqual(self.res.plots["derived"][i], (c - o) / 2, delta=1e-15)


class EmulatorStrictnessTests(unittest.TestCase):
    """The emulator must reject the constructs that are unreliable on the real platform."""

    candles = ref.random_walk(30, seed=1)
    HEAD = 'instrument { name = "t", overlay = true }\n'

    def fails(self, body, fragment):
        from lupa.lua53 import LuaError

        with self.assertRaises(LuaError) as caught:
            qcs.run(self.HEAD + body, self.candles)
        self.assertIn(fragment, str(caught.exception))

    def test_history_function_called_conditionally(self):
        self.fails("if get_value (close) > get_value (open) then local x = ema (close, 3) end", "same order")

    def test_direct_series_comparison(self):
        self.fails("local up = close > open", "get_value")

    def test_plot_shape_argument_order(self):
        self.fails("plot_shape (true, shape_style.arrowup, shape_size.large, 'red', shape_location.belowbar)",
                   "argument 2 must be the plot name")

    def test_unknown_enum_item(self):
        self.fails("plot_shape (true, 'x', shape_style.arrow_up, shape_size.large, 'red', shape_location.belowbar)",
                   "unknown enum item")

    def test_global_assignment_and_undefined_global(self):
        self.fails("x = 1", "assignment to global")
        self.fails("local y = undefined_thing", "undefined global")

    def test_look_ahead_offset(self):
        self.fails("local future = get_value (close [-1])", "look-ahead")

    def test_instrument_must_come_first(self):
        from lupa.lua53 import LuaError

        with self.assertRaises(LuaError):
            qcs.run('local a = input (1, "a", input.integer)\ninstrument { name = "t" }', self.candles)


class SignalRuleTests(unittest.TestCase):
    """Arrow, mark and advice rules of NextMinuteSignal.lua."""

    @classmethod
    def setUpClass(cls):
        cls.runs = [cached("trending", 3000, 1), cached("ranging", 3000, 2), cached("random", 1500, 3)]

    def test_there_are_signals_to_test(self):
        self.assertGreater(sum(1 for a in self.runs[0][1].arrows if a), 20)
        self.assertGreater(sum(1 for a in self.runs[1][1].arrows if a), 20)

    def test_default_settings_draw_arrows_on_a_freshly_opened_chart(self):
        """The traderoom hands the script only about 440 one-minute candles. With the
        defaults the chart must still show arrows, or the script looks broken."""
        for seed in (21, 22, 23):
            res = qcs.run(SIGNAL, ref.random_walk(440, seed=seed))
            self.assertGreaterEqual(sum(1 for a in res.arrows if a), 3, f"seed {seed}")

    def test_no_arrow_during_warm_up(self):
        for market, n, seed in (("trending", 3000, 1), ("ranging", 3000, 2), ("random", 1500, 3)):
            _, vote = cached(market, n, seed, inputs=VOTE)
            self.assertEqual(set(vote.arrows[:161]), {0})
        for _, res in self.runs:
            self.assertEqual(set(res.arrows[:5]), {0})  # breakout needs 5 closed candles

    def test_breakout_arrows_are_exactly_the_5_candle_extremes(self):
        """Arrow on candle i: candle i-1 closed at the highest high (CALL) or the lowest low (PUT)
        of candles i-5..i-1."""
        for candles, res in self.runs:
            for i in range(5, len(candles)):
                window = candles[i - 5:i]
                hi, lo = max(c.high for c in window), min(c.low for c in window)
                close = candles[i - 1].close
                expected = 0 if hi <= lo else (1 if close >= hi else (-1 if close <= lo else 0))
                self.assertEqual(res.arrows[i], expected, i)

    def test_call_and_put_are_exclusive_and_match_advice(self):
        for _, res in self.runs:
            for call, put, advice in zip(res.shape("CALL"), res.shape("PUT"), res.advice):
                self.assertFalse(call and put)
                expected = "advice.buy" if call else ("advice.sell" if put else "advice.neutral")
                self.assertEqual(advice, expected)

    def test_result_marks_follow_the_candle(self):
        for candles, res in self.runs:
            for i, a in enumerate(res.arrows):
                r = result_of(candles[i])
                self.assertEqual(res.shape("Win")[i], bool(a) and r == a, i)
                self.assertEqual(res.shape("Loss")[i], bool(a) and r == -a, i)
                self.assertEqual(res.shape("Tie")[i], bool(a) and r == 0, i)

    def test_marks_can_be_switched_off(self):
        candles, full = self.runs[0]
        res = qcs.run(SIGNAL, candles, {"Show win / loss marks": False})
        self.assertEqual(res.arrows, full.arrows)
        self.assertFalse(any(res.shape("Win") + res.shape("Loss") + res.shape("Tie")))

    def test_stricter_rules_give_fewer_arrows(self):
        candles, _ = self.runs[0]
        _, full = cached("trending", 3000, 1, inputs=VOTE)
        strict = qcs.run(SIGNAL, candles, {METHOD: 2, "Vote: minimum agreement score": 0.6, "Vote: minimum agreeing strategies": 5})
        count = lambda r: sum(1 for a in r.arrows if a)
        self.assertLess(count(strict), count(full))
        strict_ids = {i for i, a in enumerate(strict.arrows) if a}
        self.assertTrue(strict_ids <= {i for i, a in enumerate(full.arrows) if a})


CHART_SCRIPT_CLI = os.path.join(qcs.SCRIPT_DIR, "extension", "tests", "chart-script-cli.js")


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class LearnedSettingsTests(unittest.TestCase):
    """The table of learned settings that the extension writes into the chart script."""

    LEARNED = {
        "76/60": {"name": "EUR/USD (OTC)", "rules": {"method": "breakout", "brkCandles": 8, "brkZone": 20, "brkBody": 30, "reverse": True},
                  "check": {"rate": 0.5, "n": 100}},
        "1916/60": {"name": "Bitcoin", "rules": {"method": "breakout", "brkCandles": 3, "brkZone": 0, "brkBody": 0, "reverse": False},
                    "check": {"rate": 0.5, "n": 100}},
    }
    SAME_BY_HAND = {"Breakout: candles": 8, "Breakout: close within (% of range)": 20,
                    "Breakout: minimum body (% of candle)": 30, "Reverse the arrows (fade)": True}

    @classmethod
    def setUpClass(cls):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "learned.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(cls.LEARNED, handle)
            write = lambda kind: subprocess.run(["node", CHART_SCRIPT_CLI, path, kind], capture_output=True, text=True,
                                                check=True, timeout=120).stdout
            cls.code, cls.board = write("signal"), write("scoreboard")
        cls.candles = ref.trending(1500, seed=71)

    def test_the_written_scripts_are_compact_ascii(self):
        for code, full in ((self.code, SIGNAL), (self.board, SCOREBOARD)):
            code.encode("ascii")
            self.assertIn("\n[76]={8,20,30,true},\n[1916]={3,0,0,false},\n}\n", code)
            self.assertLess(len(code), 24900, "IQ Option refuses scripts longer than about 25,000 characters")
            self.assertLess(len(code), 0.8 * len(full))

    def test_each_asset_gets_its_learned_settings(self):
        learned = qcs.run(self.code, self.candles, {"@ticker_id": 76}).arrows
        by_hand = qcs.run(SIGNAL, self.candles, self.SAME_BY_HAND).arrows
        self.assertEqual(learned, by_hand)
        self.assertNotEqual(learned, qcs.run(SIGNAL, self.candles).arrows, "the learned settings change the arrows here")

    def test_other_assets_and_the_switch_keep_the_inputs(self):
        default = qcs.run(SIGNAL, self.candles).arrows
        self.assertEqual(qcs.run(self.code, self.candles, {"@ticker_id": 77}).arrows, default, "an asset not in the table")
        off = {"@ticker_id": 76, "Use the settings learned for each asset": False}
        self.assertEqual(qcs.run(self.code, self.candles, off).arrows, default, "switched off")
        mine = {"@ticker_id": 76, "Use the settings learned for each asset": False, **self.SAME_BY_HAND}
        self.assertEqual(qcs.run(self.code, self.candles, mine).arrows, qcs.run(SIGNAL, self.candles, self.SAME_BY_HAND).arrows)

    def test_the_scoreboard_scores_the_learned_arrows(self):
        candles = self.candles[:600]
        for ticker, inputs in ((76, self.SAME_BY_HAND), (77, {})):
            compact = qcs.run(self.board, candles, {"@ticker_id": ticker})
            full = qcs.run(SCOREBOARD, candles, inputs)
            self.assertEqual(compact.plots, full.plots, ticker)
            self.assertEqual(compact.hlines, full.hlines, ticker)


class NoRepaintTests(unittest.TestCase):
    """An arrow is decided from closed candles only: it never changes during or after its candle."""

    @classmethod
    def setUpClass(cls):
        cls.candles, cls.full = cached("trending", 1300, 2)
        arrows = cls.full.arrows
        hits = [i for i, a in enumerate(arrows) if a]
        quiet = [i for i in range(400, len(arrows)) if not arrows[i]]
        if len(hits) < 3:
            raise AssertionError("scenario needs arrows")
        cls.cuts = hits[:3] + hits[-1:] + quiet[:2]

    def test_arrow_is_fixed_when_its_candle_opens(self):
        for i in self.cuts:
            c = self.candles[i]
            first_tick = Candle(c.ts, c.open, c.open, c.open, c.open, 1.0)
            spike = Candle(c.ts, c.open, c.open + 0.002, c.open - 0.002, c.open - 0.0015, 1.0)
            for live in (first_tick, spike):
                res = qcs.run(SIGNAL, self.candles[:i] + [live])
                self.assertEqual(res.arrows[i], self.full.arrows[i], f"candle {i} with {live}")
                self.assertEqual(res.advice[i], self.full.advice[i])

    def test_history_never_changes_when_new_candles_arrive(self):
        for end in (700, 1000):
            res = qcs.run(SIGNAL, self.candles[:end])
            self.assertEqual(res.arrows, self.full.arrows[:end])


class ScoreboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candles, cls.signal = cached("ranging", 3000, 2)
        _, cls.board = cached("ranging", 3000, 2, "scoreboard")

    def test_win_rate_counts_closed_candles_only(self):
        arrows = self.signal.arrows
        rate = self.board.plots["Win rate % (all)"]
        for t in range(1, len(self.candles)):
            w, l, _ = outcomes(self.candles, arrows, upto=t)
            if w + l == 0:
                self.assertIsNone(rate[t])
            else:
                self.assertAlmostEqual(rate[t], 100 * w / (w + l), places=9, msg=t)

    def test_band_contains_the_rate_and_narrows(self):
        rate = self.board.plots["Win rate % (all)"]
        lo, hi = self.board.plots["95% band lower"], self.board.plots["95% band upper"]
        seen = [t for t, v in enumerate(rate) if v is not None]
        self.assertTrue(seen)
        for t in seen:
            self.assertLessEqual(lo[t], rate[t] + 1e-9)
            self.assertGreaterEqual(hi[t], rate[t] - 1e-9)
        self.assertLess(hi[seen[-1]] - lo[seen[-1]], hi[seen[0]] - lo[seen[0]])

    def test_band_matches_the_wilson_formula(self):
        arrows = self.signal.arrows
        t = len(self.candles) - 1
        w, l, _ = outcomes(self.candles, arrows, upto=t)
        n, p, z = w + l, w / (w + l), 1.96
        denom = 1 + z * z / n
        centre = (p + z * z / (2 * n)) / denom
        half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
        self.assertAlmostEqual(self.board.plots["95% band lower"][t], 100 * (centre - half), places=9)
        self.assertAlmostEqual(self.board.plots["95% band upper"][t], 100 * (centre + half), places=9)

    def test_recent_window(self):
        arrows = self.signal.arrows
        recent = self.board.plots["Win rate % (recent)"]
        window = 240
        for t in (600, 1500, 2999):
            w = l = 0
            for i in range(max(0, t - window), t):
                if arrows[i]:
                    r = result_of(self.candles[i])
                    w += r == arrows[i]
                    l += r == -arrows[i]
            if w + l:
                self.assertAlmostEqual(recent[t], 100 * w / (w + l), places=9, msg=t)
            else:
                self.assertIsNone(recent[t])

    def test_break_even_follows_the_payout(self):
        self.assertIn((100 * 100 / 188, "Break-even %"), self.board.hlines)
        res = qcs.run(SCOREBOARD, self.candles[:300], {"Payout % shown in the traderoom": 80})
        self.assertIn((100 * 100 / 180, "Break-even %"), res.hlines)


class StatisticalTests(unittest.TestCase):
    """The script must not invent an edge on random data, and must find a real one."""

    @staticmethod
    def pooled(market, seeds, n, gate):
        w = l = 0
        for seed in seeds:
            candles, res = cached(market, n, seed, inputs={METHOD: 2, GATE: gate})
            ww, ll, _ = outcomes(candles, res.arrows)
            w, l = w + ww, l + ll
        return w, l

    @staticmethod
    def breakout(market, seeds, n):
        w = l = 0
        for seed in seeds:
            candles, res = cached(market, n, seed)
            ww, ll, _ = outcomes(candles, res.arrows)
            w, l = w + ww, l + ll
        return w, l

    def test_breakout_is_a_coin_flip_on_random_data(self):
        w, l = self.breakout("random", range(11, 19), 2500)
        n = w + l
        self.assertGreater(n, 2000)
        self.assertLess(abs(w / n - 0.5), 4 * math.sqrt(0.25 / n))  # a look-ahead leak would blow far past this

    def test_breakout_follows_a_real_trend(self):
        w, l = self.breakout("trending", (1, 2, 3), 5000)
        self.assertGreater(w / (w + l), 0.53)

    def test_textbook_rules_are_a_coin_flip_on_random_data(self):
        w, l = self.pooled("random", range(11, 19), 2500, False)
        n = w + l
        self.assertGreater(n, 500)
        self.assertLess(abs(w / n - 0.5), 4 * math.sqrt(0.25 / n))  # a look-ahead leak would blow far past this

    def test_the_gate_abstains_on_random_data(self):
        off = sum(self.pooled("random", range(11, 19), 2500, False))
        on = sum(self.pooled("random", range(11, 19), 2500, True))
        self.assertLess(on, 0.1 * off)

    def test_the_gate_stops_following_rules_that_lose(self):
        w_on, l_on = self.pooled("ranging", (1, 2, 3), 5000, True)
        w_off, l_off = self.pooled("ranging", (1, 2, 3), 5000, False)
        self.assertGreater(w_on / (w_on + l_on), w_off / (w_off + l_off) + 0.05)

    def test_a_real_trend_edge_is_found(self):
        w, l = self.pooled("trending", (1, 2, 3), 5000, True)
        self.assertGreater(w / (w + l), 100 / 188)


@unittest.skipUnless(qcs.fengari_available(), "node + fengari not installed (cd tests; npm install)")
class CrossEngineTests(unittest.TestCase):
    """Same output on the C Lua 5.3 VM and on fengari (Lua 5.3 in JavaScript, like a browser)."""

    def test_identical_output(self):
        candles = ref.mean_reverting(1200, seed=4)
        for path in (qcs.SIGNAL_SCRIPT, qcs.SCOREBOARD_SCRIPT):
            self.assertEqual(qcs.run_fengari_digest(path, candles), qcs.run_file(path, candles).digest, path)
            self.assertEqual(qcs.run_fengari_digest(path, candles, VOTE), qcs.run_file(path, candles, VOTE).digest, path)


if __name__ == "__main__":
    unittest.main()

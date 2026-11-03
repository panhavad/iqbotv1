"""The Chrome extension's JavaScript signal engine must give the chart script's arrows, candle by candle."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest

from . import qcs
from . import reference as ref

ENGINE_CLI = os.path.join(qcs.SCRIPT_DIR, "extension", "tests", "engine-cli.js")
REAL_CANDLES = os.path.join(qcs.SCRIPT_DIR, "extension", "tests", "fixtures", "eurusd-otc-1m.json")
SIGNAL = qcs.read(qcs.SIGNAL_SCRIPT)
METHOD = "Signal method"  # 1 = breakout momentum (default), 2 = 15-strategy vote
GATE = "Vote: evidence gate"
LOOSE_VOTE = {METHOD: 2, "Vote: minimum agreement score": 0.05, "Vote: minimum agreeing strategies": 1}
MARKETS = {"random": ref.random_walk, "ranging": ref.mean_reverting, "trending": ref.trending}


def real_candles() -> list:
    """1000 real EUR/USD (OTC) 1-minute candles recorded from IQ Option."""
    with open(REAL_CANDLES, encoding="utf-8") as handle:
        rows = json.load(handle)["candles"]
    return [ref.Candle(r["from"], r["open"], r["max"], r["min"], r["close"]) for r in rows]


def js_arrows(candles, inputs=None) -> list:
    """Arrows (+1 CALL, -1 PUT, 0 none) per candle from extension/src/signal-engine.js."""
    with tempfile.TemporaryDirectory() as folder:
        candles_path = os.path.join(folder, "candles.json")
        inputs_path = os.path.join(folder, "inputs.json")
        with open(candles_path, "w", encoding="utf-8") as handle:
            json.dump([{"open": c.open, "high": c.high, "low": c.low, "close": c.close} for c in candles], handle)
        with open(inputs_path, "w", encoding="utf-8") as handle:
            json.dump(inputs or {}, handle)
        proc = subprocess.run(["node", ENGINE_CLI, candles_path, inputs_path],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RuntimeError("engine-cli failed: " + proc.stderr[-2000:])
    return [{"C": 1, "P": -1, ".": 0}[ch] for ch in proc.stdout.strip()]


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ExtensionEngineParityTests(unittest.TestCase):
    def check(self, candles, inputs=None, min_arrows=10):
        lua = qcs.run(SIGNAL, candles, inputs).arrows
        js = js_arrows(candles, inputs)
        self.assertEqual(len(js), len(lua))
        diffs = [i for i, (a, b) in enumerate(zip(lua, js)) if a != b]
        self.assertEqual(diffs, [], f"first differing candles: {diffs[:10]}")
        self.assertGreaterEqual(sum(1 for a in lua if a), min_arrows, "scenario has too few arrows to compare")

    def test_default_rules(self):
        """Default method: breakout momentum."""
        for (market, generate), seed in zip(MARKETS.items(), (31, 32, 33)):
            with self.subTest(market=market):
                self.check(generate(1500, seed=seed), min_arrows=100)

    def test_vote_default_rules(self):
        for (market, generate), seed in zip(MARKETS.items(), (34, 35, 36)):
            with self.subTest(market=market):
                self.check(generate(1500, seed=seed), {METHOD: 2})

    def test_loose_rules_reach_every_vote_and_filter(self):
        for (market, generate), seed in zip(MARKETS.items(), (41, 42, 43)):
            with self.subTest(market=market):
                self.check(generate(1200, seed=seed), LOOSE_VOTE, min_arrows=100)

    def test_evidence_gate(self):
        gate = {METHOD: 2, GATE: True, "Vote: evidence window (candles)": 200, "Vote: evidence needed (z-score)": 0.5}
        for (market, generate), seed in zip(MARKETS.items(), (51, 52, 53)):
            with self.subTest(market=market):
                self.check(generate(1500, seed=seed), gate, min_arrows=1)

    def test_real_eurusd_otc_candles(self):
        candles = real_candles()
        self.assertEqual(len(candles), 1000)
        self.check(candles, min_arrows=20)
        self.check(candles, {METHOD: 2}, min_arrows=5)
        self.check(candles, LOOSE_VOTE, min_arrows=50)

    def test_adjusted_breakout(self):
        """The settings the extension learns per asset: lookback, zone, body and reverse."""
        cases = [
            {"Breakout: candles": 2},
            {"Breakout: candles": 12, "Breakout: close within (% of range)": 20},
            {"Breakout: candles": 8, "Breakout: minimum body (% of candle)": 60, "Reverse the arrows (fade)": True},
            {"Breakout: candles": 30, "Breakout: close within (% of range)": 45, "Breakout: minimum body (% of candle)": 30},
            {METHOD: 2, "Reverse the arrows (fade)": True, "Vote: minimum agreement score": 0.05,
             "Vote: minimum agreeing strategies": 1},
            # The most frequent settings: one candle, its upper / lower half (an arrow on almost every candle).
            {"Breakout: candles": 1, "Breakout: close within (% of range)": 50, "Reverse the arrows (fade)": True},
            {"Breakout: candles": 4, "Breakout: close within (% of range)": 40},
        ]
        for i, inputs in enumerate(cases):
            for (market, generate), seed in zip(MARKETS.items(), (61, 62, 63)):
                with self.subTest(inputs=inputs, market=market):
                    self.check(generate(900, seed=seed + 10 * i), inputs, min_arrows=10)
        self.check(real_candles(), cases[2], min_arrows=10)
        self.check(real_candles(), cases[5], min_arrows=500)


if __name__ == "__main__":
    unittest.main()

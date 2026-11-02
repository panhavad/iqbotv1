"""Signal research: which logic predicts the next 1-minute candle on real IQ Option prices?

    .venv\\Scripts\\python.exe research\\study.py            # all assets in research/data
    .venv\\Scripts\\python.exe research\\study.py EURUSD-OTC

Each asset is split by time: the first 60% of its candles train the methods, the next 20%
(validation) choose rules and thresholds, and the last 20% (test) is used once, at the end,
to measure what would have happened on candles no method had seen. Win rates leave out ties
(refunds). Break-even win rate = 100 / (100 + payout).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
import warnings
from itertools import combinations

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candles as cd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_CLI = os.path.join(os.path.dirname(HERE), "extension", "tests", "engine-cli.js")
SPLITS = ("train", "val", "test")


def wilson(w: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = w / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def score(pred: np.ndarray, y: np.ndarray, mask: np.ndarray) -> dict:
    """Win rate of the non-zero predictions inside mask (ties excluded)."""
    m = mask & (pred != 0) & (y != 0)
    n = int(m.sum())
    w = int((pred[m] == y[m]).sum())
    lo, hi = wilson(w, n)
    return {"n": n, "w": w, "rate": w / n if n else float("nan"), "lo": lo, "hi": hi}


def fmt(s: dict) -> str:
    if not s["n"]:
        return "      -      "
    return f"{100 * s['rate']:5.1f}% ({s['n']:>6})"


class Asset:
    def __init__(self, name: str):
        self.s = cd.load(name)
        self.name = name
        self.X, self.y, self.valid = cd.features(self.s)
        n = len(self.y)
        idx = np.arange(n)
        self.split = {
            "train": self.valid & (idx < int(0.6 * n)),
            "val": self.valid & (idx >= int(0.6 * n)) & (idx < int(0.8 * n)),
            "test": self.valid & (idx >= int(0.8 * n)),
        }
        self.days = (self.s.t[-1] - self.s.t[0]) / 86400

    def col(self, feature: str) -> np.ndarray:
        return self.X[:, cd.FEATURES.index(feature)]

    def all_splits(self, pred: np.ndarray) -> dict:
        return {k: score(pred, self.y, self.split[k]) for k in SPLITS}


# --------------------------------------------------------------------------- methods
def engine_predictions(a: Asset, inputs: dict | None = None) -> np.ndarray:
    """The current Next Minute logic (extension/src/signal-engine.js = chart script)."""
    with tempfile.TemporaryDirectory() as folder:
        cpath = os.path.join(folder, "c.json")
        ipath = os.path.join(folder, "i.json")
        with open(cpath, "w") as handle:
            json.dump([{"open": float(o), "high": float(h), "low": float(l), "close": float(c)}
                       for o, h, l, c in zip(a.s.o, a.s.h, a.s.l, a.s.c)], handle)
        with open(ipath, "w") as handle:
            json.dump(inputs or {}, handle)
        out = subprocess.run(["node", ENGINE_CLI, cpath, ipath], capture_output=True, text=True, check=True).stdout.strip()
    arrows = np.array([{"C": 1, "P": -1, ".": 0}[ch] for ch in out])
    pred = np.zeros(len(a.y))
    pred[:-1] = arrows[1:]  # the arrow on candle t+1 is decided when candle t closes
    return pred


def single_rules(a: Asset, min_trades: int):
    """Every feature, both tails, several cut-offs; the direction is learned on train."""
    rules = []
    tr = a.split["train"]
    for j, name in enumerate(cd.FEATURES):
        x = a.X[:, j]
        qs = np.nanquantile(x[tr], [0.02, 0.05, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 0.95, 0.98])
        conds = [(f"{name} <= {q:.4g}", x <= q) for q in qs[:5]] + [(f"{name} >= {q:.4g}", x >= q) for q in qs[5:]]
        if name in ("c1", "c2", "c3", "c4", "c5", "dow"):
            conds = [(f"{name} == {v:g}", x == v) for v in np.unique(x[tr])]
        if name == "streak":
            conds = [(f"streak == {v:g}", x == v) for v in range(-7, 8) if v] + \
                    [(f"streak >= {v}", x >= v) for v in (3, 4, 5, 6)] + [(f"streak <= {-v}", x <= -v) for v in (3, 4, 5, 6)]
        for label, cond in conds:
            m = tr & cond & (a.y != 0)
            if m.sum() < min_trades:
                continue
            up = (a.y[m] > 0).mean()
            direction = 1 if up >= 0.5 else -1
            pred = np.where(cond, direction, 0)
            rules.append((label + (" -> CALL" if direction > 0 else " -> PUT"), pred, cond, direction))
    return rules


def pattern_table(a: Asset, k: int, min_count: int, margin: float):
    """Last-k candle colours -> next colour, learned on train."""
    cols = np.column_stack([a.col(f"c{i}") for i in range(1, k + 1)])
    key = np.zeros(len(a.y), dtype=np.int64)
    for i in range(k):
        key = key * 3 + (cols[:, i].astype(np.int64) + 1)
    pred = np.zeros(len(a.y))
    tr = a.split["train"] & (a.y != 0)
    for value in np.unique(key[tr]):
        m = tr & (key == value)
        if m.sum() < min_count:
            continue
        up = (a.y[m] > 0).mean()
        if abs(up - 0.5) >= margin:
            pred[key == value] = 1 if up > 0.5 else -1
    return pred


def model_predictions(a: Asset, kind: str):
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    tr = a.split["train"] & (a.y != 0)
    if kind == "logistic":
        model = make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=2000))
    else:
        model = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300,
                                               min_samples_leaf=200, l2_regularization=1.0, random_state=1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model.fit(a.X[tr], (a.y[tr] > 0).astype(int))
        p = np.full(len(a.y), 0.5)
        ok = a.valid
        p[ok] = model.predict_proba(a.X[ok])[:, 1]
    return p


def threshold_pick(a: Asset, p: np.ndarray, min_trades: int):
    """Choose the confidence threshold on validation; return (threshold, prediction)."""
    best = None
    for thr in np.arange(0.500, 0.60, 0.0025):
        pred = np.where(p >= thr, 1, np.where(p <= 1 - thr, -1, 0))
        v = score(pred, a.y, a.split["val"])
        if v["n"] >= min_trades and (best is None or v["rate"] > best[0]):
            best = (v["rate"], thr, pred)
    if best is None:
        thr = 0.5
        return thr, np.where(p > 0.5, 1, -1)
    return best[1], best[2]


def search_for_90(a: Asset, rules, min_train: int, rng_seed: int = 7):
    """What the user asked for: combine conditions until the PAST shows >= 90% wins."""
    rng = np.random.default_rng(rng_seed)
    tr, va, te = a.split["train"], a.split["val"], a.split["test"]
    found = []
    tried = 0
    pool = [r for r in rules]
    for size in (2, 3):
        for _ in range(6000):
            pick = rng.choice(len(pool), size=size, replace=False)
            cond = np.ones(len(a.y), dtype=bool)
            for i in pick:
                cond &= pool[i][2]
            tried += 1
            m = tr & cond & (a.y != 0)
            n = int(m.sum())
            if n < min_train:
                continue
            for direction in (1, -1):
                w = int((a.y[m] == direction).sum())
                if w / n >= 0.90:
                    pred = np.where(cond, direction, 0)
                    found.append((" & ".join(pool[i][0].split(" -> ")[0] for i in pick) + (" -> CALL" if direction > 0 else " -> PUT"),
                                  score(pred, a.y, tr), score(pred, a.y, va), score(pred, a.y, te)))
    return tried, found


# --------------------------------------------------------------------------- report
def study(name: str, out: list[str]):
    a = Asset(name)
    ties = float(np.mean(a.y[a.valid] == 0))
    ups = float(np.mean(a.y[a.valid & (a.y != 0)] > 0))
    out.append(f"\n## {name}: {len(a.y):,} candles, {a.days:.0f} days, ties {100 * ties:.1f}%, up candles {100 * ups:.1f}%\n")
    out.append("| Method | Train | Validation | **Test (unseen)** | Test 95% CI | Trades/day (test) |")
    out.append("|---|---|---|---|---|---|")
    test_days = a.days * 0.2

    def row(label, pred):
        r = a.all_splits(pred)
        t = r["test"]
        ci = f"{100 * t['lo']:.1f}-{100 * t['hi']:.1f}%" if t["n"] else "-"
        out.append(f"| {label} | {fmt(r['train'])} | {fmt(r['val'])} | **{fmt(r['test'])}** | {ci} | {t['n'] / test_days:.0f} |")
        return r

    results = {}
    results["follow"] = row("Follow the last candle", a.col("c1"))
    results["reverse"] = row("Reverse the last candle", -a.col("c1"))
    for label, inputs in (("Current logic (default rules)", {}),
                          ("Current logic, loose (0.15 / 2)", {"Minimum agreement score": 0.15, "Minimum agreeing strategies": 2}),
                          ("Current logic, strict (0.5 / 5)", {"Minimum agreement score": 0.5, "Minimum agreeing strategies": 5})):
        results[label] = row(label, engine_predictions(a, inputs))

    min_trades = max(200, int(0.01 * a.split["train"].sum()))
    rules = single_rules(a, min_trades)
    scored = [(r[0], a.all_splits(r[1])) for r in rules]
    by_train = sorted(scored, key=lambda x: -x[1]["train"]["rate"])[:3]
    by_val = sorted([s for s in scored if s[1]["val"]["n"] >= 100], key=lambda x: -x[1]["val"]["rate"])[:3]
    for label, r in by_train:
        t = r["test"]
        out.append(f"| Best single rule on train: `{label}` | {fmt(r['train'])} | {fmt(r['val'])} | **{fmt(t)}** | {100 * t['lo']:.1f}-{100 * t['hi']:.1f}% | {t['n'] / test_days:.0f} |")
    for label, r in by_val:
        t = r["test"]
        out.append(f"| Best single rule on validation: `{label}` | {fmt(r['train'])} | {fmt(r['val'])} | **{fmt(t)}** | {100 * t['lo']:.1f}-{100 * t['hi']:.1f}% | {t['n'] / test_days:.0f} |")

    best_pattern = None
    for k in (2, 3, 4, 5):
        for margin in (0.01, 0.02, 0.03):
            pred = pattern_table(a, k, 300, margin)
            r = a.all_splits(pred)
            if r["val"]["n"] >= 200 and (best_pattern is None or r["val"]["rate"] > best_pattern[1]["val"]["rate"]):
                best_pattern = (f"Colour pattern of last {k} candles (margin {margin:.2f})", r, pred)
    if best_pattern:
        row(best_pattern[0], best_pattern[2])

    for kind in ("logistic", "boosting"):
        p = model_predictions(a, kind)
        thr, pred = threshold_pick(a, p, max(150, int(0.02 * a.split["val"].sum())))
        results[kind] = row(f"{'Logistic regression' if kind == 'logistic' else 'Gradient boosting'} (45 features, confidence >= {thr:.3f})", pred)

    tried, found = search_for_90(a, rules, min_train=30)
    out.append("")
    out.append(f"**Searching for a 90% rule (what was asked):** {tried:,} random combinations of 2-3 conditions were tried on the "
               f"training candles; {len(found)} reached 90% or more there (each with at least 30 trades).")
    if found:
        tr_n = np.mean([f[1]["n"] for f in found])
        va = [f[2] for f in found if f[2]["n"]]
        te = [f[3] for f in found if f[3]["n"]]
        va_rate = sum(v["w"] for v in va) / max(1, sum(v["n"] for v in va))
        te_rate = sum(v["w"] for v in te) / max(1, sum(v["n"] for v in te))
        out.append(f"On the training candles they won {100 * np.mean([f[1]['rate'] for f in found]):.1f}% on average "
                   f"(about {tr_n:.0f} trades each). On candles they had not seen, the same rules won "
                   f"**{100 * va_rate:.1f}%** (validation, {sum(v['n'] for v in va):,} trades) and **{100 * te_rate:.1f}%** "
                   f"(test, {sum(v['n'] for v in te):,} trades).")
        best = sorted(found, key=lambda f: -f[1]["rate"])[:3]
        for label, trs, vas, tes in best:
            out.append(f"- `{label}`: train {fmt(trs)}, validation {fmt(vas)}, test {fmt(tes)}")
    return a, results


def main(argv):
    names = argv or cd.available()
    out = ["# Signal research results", "",
           "Win rate of the arrows on the next 1-minute candle (ties left out), by time period. "
           "Break-even: 53.2% at an 88% payout, 51.3% at 95%.", ""]
    for name in names:
        print("studying", name, flush=True)
        study(name, out)
    text = "\n".join(out) + "\n"
    with open(os.path.join(HERE, "results.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text)


if __name__ == "__main__":
    main(sys.argv[1:])

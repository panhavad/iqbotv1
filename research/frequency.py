"""Round 5: more frequent arrows.

    .venv\\Scripts\\python.exe research\\frequency.py      (a few minutes; writes results-frequency.md)

The breakout arrows come on about 1 candle in 10 to 20. This round measures what rules that fire
far more often can win. Each signal family below has a frequency knob; the evidence behind each
one is summarised in results-frequency.md.

For every asset (5 OTC, 62 real markets; 1-minute candles) and every minimum share of candles
with an arrow ("coverage": any, 10%, 25%, 50%, 90%), each family is tuned like the extension's
learner does it: every version is measured on the oldest 60% of the candles, the 10 best (lower
end of the 95% range) are compared on the next 20%, and the chosen one is judged once on the
newest 20%. Machine-learning models are trained on the oldest 60% and their confidence threshold
(selective classification) is chosen on the next 20%. Where 5-second candles exist, the check is
also measured with the entry price 5 s after the open.
"""

from __future__ import annotations

import os
import sys
import warnings
from concurrent.futures import ProcessPoolExecutor

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candles as cd  # noqa: E402
from study import wilson  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OTC = ["EURUSD-OTC", "GBPUSD-OTC", "CARDANO-OTC", "ETHUSD-OTC", "BTCUSD-OTC"]
CRYPTO = ["BTCUSD", "ETHUSD", "XRPUSD"]
PAYOUT = {"EURUSD-OTC": 88, "GBPUSD-OTC": 85, "CARDANO-OTC": 82, "ETHUSD-OTC": 82, "BTCUSD-OTC": 82}
PAYOUT_REAL = 86
COVERAGE = [0.0, 0.10, 0.25, 0.50, 0.90]
LEARN_END, CHOOSE_END = 0.6, 0.8
MIN_LEARN, MIN_CHOOSE, SHORTLIST = 50, 20, 10
ML_LEVELS = [1.0, 0.9, 0.75, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.07, 0.05]


def asset_list() -> list[tuple[str, str, str]]:
    """(name, file name for cd.load, group)."""
    out = [(n, n, "OTC") for n in OTC]
    out += [(n, n, "Crypto") for n in CRYPTO if os.path.exists(os.path.join(cd.DATA, n + "-60.csv"))]
    real = sorted(f[:-7] for f in os.listdir(os.path.join(cd.DATA, "real")) if f.endswith("-60.csv"))
    for n in real:
        forex = len(n) == 6 and n.isalpha() and n not in ("BTCUSD", "ETHUSD", "XRPUSD")
        out.append((n, "real/" + n, "Forex" if forex and n[:3] in FX and n[3:] in FX else "Other"))
    return out


FX = {"EUR", "USD", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"}


# --------------------------------------------------------------------------- features
def roll(x: np.ndarray, n: int, fn) -> np.ndarray:
    return x.copy() if n == 1 else cd.rolling(x, n, fn)


def rsi(c: np.ndarray, n: int) -> np.ndarray:
    d = np.diff(c, prepend=np.nan)
    up = cd.rma(np.where(d > 0, d, 0.0) * np.where(np.isnan(d), np.nan, 1), n)
    dn = cd.rma(np.where(d < 0, -d, 0.0) * np.where(np.isnan(d), np.nan, 1), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(dn == 0, 100.0, np.where(up == 0, 0.0, 100 - 100 / (1 + up / dn)))


class Data:
    def __init__(self, s: cd.Series):
        self.s = s
        o, h, l, c = s.o, s.h, s.l, s.c
        n = len(c)
        self.n = n
        self.y = np.zeros(n)
        self.y[:-1] = np.sign(c[1:] - o[1:])
        self.ok = np.zeros(n, dtype=bool)
        self.ok[:-1] = (s.t[1:] - s.t[:-1]) == 60
        self.a, self.b = int(n * LEARN_END), int(n * CHOOSE_END)
        self.colour = np.sign(c - o)
        self.body = np.abs(c - o)
        self.rng = h - l
        prev_c = np.concatenate([[np.nan], c[:-1]])
        tr = np.nanmax(np.vstack([h - l, np.abs(h - prev_c), np.abs(l - prev_c)]), axis=0)
        self.atr = cd.rma(tr, 14)
        self.late = None  # price 5 s after the open of each candle (np.nan where unknown)

    def part(self, k: int) -> slice:
        return [slice(0, self.a), slice(self.a, self.b), slice(self.b, self.n)][k]


# --------------------------------------------------------------------------- rule families
def breakout(d: Data, n: int, zone: int, body: int, rev: bool, cache: dict) -> np.ndarray:
    """The extension's breakout rule: close within zone % of the n-candle high (CALL) / low (PUT)."""
    if n not in cache:
        cache[n] = (roll(d.s.h, n, np.max), roll(d.s.l, n, np.min))
    hh, ll = cache[n]
    span = hh - ll
    c = d.s.c
    ok = (span > 0) & (d.body >= body / 100 * d.rng)
    z = zone / 100 * span
    a = np.where(ok & (c >= hh - z), 1, np.where(ok & (c <= ll + z), -1, 0))
    return (-a if rev else a).astype(np.int8)


def family_breakout(d: Data, wide: bool):
    cache: dict = {}
    candles = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30] if wide else [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30]
    zones = [0, 10, 20, 30, 40, 50] if wide else [0, 10, 20, 30]
    for n in candles:
        for zone in zones:
            for body in (0, 30, 60):
                for rev in (False, True):
                    yield f"breakout {n}/{zone}/{body}{'/rev' if rev else ''}", breakout(d, n, zone, body, rev, cache)


def family_colour(d: Data):
    """The last candle's colour, followed or faded, for candles with a body of at least b % of their range."""
    for body in (0, 20, 40, 60, 80):
        base = np.where(d.body >= body / 100 * d.rng, d.colour, 0)
        for rev in (False, True):
            yield f"colour {body}{'/fade' if rev else ''}", (-base if rev else base).astype(np.int8)


def family_streak(d: Data):
    """After k candles of the same colour in a row (dojis break a run): continue or fade."""
    col = d.colour
    run = np.zeros(d.n, dtype=np.int32)
    for i in range(d.n):
        run[i] = 0 if col[i] == 0 else (run[i - 1] + 1 if i and col[i - 1] == col[i] else 1)
    for k in (2, 3, 4, 5, 6):
        base = np.where(run >= k, col, 0)
        for rev in (False, True):
            yield f"streak {k}{'/fade' if rev else ''}", (-base if rev else base).astype(np.int8)


def family_zscore(d: Data):
    """Distance of the close from its n-candle mean, in standard deviations: fade (revert) or follow."""
    c = d.s.c
    for n in (5, 10, 20, 50):
        m = cd.rolling(c, n, np.mean)
        sd = cd.rolling(c, n, np.std)
        with np.errstate(divide="ignore", invalid="ignore"):
            z = np.where(sd > 0, (c - m) / sd, np.nan)
        for thr in (0.0, 0.5, 1.0, 1.5, 2.0):
            base = np.where(np.abs(z) >= thr, np.sign(z), 0)
            base = np.nan_to_num(base).astype(np.int8)
            for rev in (False, True):
                yield f"z-score {n}/{thr}{'/fade' if rev else ''}", (-base if rev else base).astype(np.int8)


def family_rsi2(d: Data):
    """RSI(2) (Connors): below x -> CALL, above 100 - x -> PUT (mean reversion), or the reverse."""
    r = rsi(d.s.c, 2)
    for x in (5, 10, 20, 30, 40, 50):
        base = np.where(r < x, 1, np.where(r > 100 - x, -1, 0))
        base[np.isnan(r)] = 0
        for rev in (False, True):
            yield f"RSI2 {x}{'/momentum' if rev else ''}", (-base if rev else base).astype(np.int8)


def family_clock(d: Data):
    """Time of day: the up / down bias of each UTC hour (or minute of the hour) on the oldest 60%."""
    nxt = d.s.t + 60  # the traded candle
    learn = d.part(0)
    for unit, key in (("hour-of-day", (nxt // 3600) % 24), ("minute-of-hour", (nxt // 60) % 60)):
        buckets = int(key.max()) + 1
        ys = d.y[learn]
        valid = d.ok[learn] & (ys != 0)
        up = np.bincount(key[learn][valid], weights=(ys[valid] > 0), minlength=buckets)
        tot = np.bincount(key[learn][valid], minlength=buckets)
        with np.errstate(divide="ignore", invalid="ignore"):
            zb = np.where(tot > 0, (up - tot / 2) / np.sqrt(tot / 4), 0)
        for thr in (0.0, 1.0, 2.0):
            side = np.where(np.abs(zb) >= thr, np.sign(zb), 0)
            yield f"{unit} bias z>={thr}", side[key].astype(np.int8)


RULE_FAMILIES = {
    "Breakout (extension today: 2-30 candles, zone 0-30%)": lambda d: family_breakout(d, False),
    "Breakout, wider (1-30 candles, zone 0-50%)": lambda d: family_breakout(d, True),
    "Candle colour (follow / fade)": family_colour,
    "Streak of k candles (follow / fade)": family_streak,
    "Z-score vs moving average (revert / follow)": family_zscore,
    "RSI(2) (Connors)": family_rsi2,
    "Time of day / minute of hour": family_clock,
}


# --------------------------------------------------------------------------- machine learning
def features(d: Data) -> np.ndarray:
    s = d.s
    o, h, l, c = s.o, s.h, s.l, s.c
    atr = np.where(d.atr > 0, d.atr, np.nan)
    cols = []
    for k in range(5):
        cols.append(np.concatenate([np.full(k, np.nan), (c - o)[:d.n - k]]) / atr)
    cols.append(np.diff(c, prepend=np.nan) / atr)
    with np.errstate(divide="ignore", invalid="ignore"):
        cols.append(np.where(d.rng > 0, (c - l) / d.rng - 0.5, 0.0))
        for n in (5, 20):
            hh, ll = cd.rolling(h, n, np.max), cd.rolling(l, n, np.min)
            cols.append(np.where(hh > ll, (c - ll) / (hh - ll) - 0.5, 0.0))
        m, sd = cd.rolling(c, 20, np.mean), cd.rolling(c, 20, np.std)
        cols.append(np.clip(np.where(sd > 0, (c - m) / sd, 0.0), -5, 5))
    cols.append(rsi(c, 2) / 100 - 0.5)
    cols.append(rsi(c, 14) / 100 - 0.5)
    cols.append(d.rng / atr)
    cols.append((h - np.maximum(o, c)) / atr)
    cols.append((np.minimum(o, c) - l) / atr)
    cols.append((cd.ema(c, 5) - cd.ema(c, 20)) / atr)
    hour = ((s.t + 60) % 86400) / 3600
    cols.append(np.sin(2 * np.pi * hour / 24))
    cols.append(np.cos(2 * np.pi * hour / 24))
    return np.column_stack(cols)


def knn_features(d: Data) -> np.ndarray:
    s = d.s
    atr = np.where(d.atr > 0, d.atr, np.nan)
    cols = [np.concatenate([np.full(k, np.nan), (s.c - s.o)[:d.n - k]]) / atr for k in range(8)]
    with np.errstate(divide="ignore", invalid="ignore"):
        cols.append(np.where(d.rng > 0, (s.c - s.l) / d.rng - 0.5, 0.0))
    return np.column_stack(cols)


def ml_scores(d: Data) -> dict[str, np.ndarray]:
    """P(up) - 0.5 for every candle, from models trained on the oldest 60% only."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    out = {}
    for name, X, model in (
        ("Logistic regression (18 features)", features(d),
         make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000))),
        ("Gradient boosting (18 features)", features(d),
         HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.05, l2_regularization=1.0, random_state=0)),
        ("Nearest neighbours (last 8 candles)", knn_features(d),
         make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=150))),
    ):
        finite = np.isfinite(X).all(axis=1)
        train = finite.copy()
        train[d.a:] = False
        train &= d.ok & (d.y != 0)
        score = np.full(d.n, np.nan)
        if train.sum() < 500:
            out[name] = score
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model.fit(X[train], (d.y[train] > 0).astype(int))
            score[finite] = model.predict_proba(X[finite])[:, 1] - 0.5
        out[name] = score
    return out


# --------------------------------------------------------------------------- measuring
def stats(d: Data, arrows: np.ndarray, k: int) -> tuple[int, int, float]:
    """(wins, decided arrows, coverage) of part k (0 learn, 1 choose, 2 check)."""
    p = d.part(k)
    a, y, ok = arrows[p], d.y[p], d.ok[p]
    fired = ok & (a != 0)
    decided = fired & (y != 0)
    w = int((a[decided] == y[decided]).sum())
    return w, int(decided.sum()), float(fired.sum() / max(1, ok.sum()))


def late_stats(d: Data, arrows: np.ndarray) -> tuple[int, int]:
    """Check part, entry price 5 s after the open of the traded candle (ties are refunds)."""
    if d.late is None:
        return 0, 0
    p = d.part(2)
    idx = np.arange(d.n)[p]
    idx = idx[d.ok[p] & (arrows[p] != 0) & (idx + 1 < d.n)]
    entry = d.late[idx + 1]
    keep = np.isfinite(entry)
    idx, entry = idx[keep], entry[keep]
    move = np.sign(d.s.c[idx + 1] - entry)
    dec = move != 0
    return int((move[dec] == arrows[idx][dec]).sum()), int(dec.sum())


def lower(w: int, n: int) -> float:
    return wilson(w, n)[0] if n else 0.0


def choose(d: Data, versions: list[tuple[str, np.ndarray]], cover: float):
    """The learner's choice for a minimum coverage: best 10 on learn, best of those on choose."""
    ranked = []
    for label, arr in versions:
        w, n, cov = stats(d, arr, 0)
        if n >= MIN_LEARN and cov >= cover:
            ranked.append((lower(w, n), label, arr))
    if not ranked:
        return None
    ranked.sort(key=lambda r: -r[0])
    best = None
    for _, label, arr in ranked[:SHORTLIST]:
        w, n, cov = stats(d, arr, 1)
        if n >= MIN_CHOOSE and cov >= 0.8 * cover:
            key = lower(w, n)
            if best is None or key > best[0]:
                best = (key, label, arr)
    return (best or (0, ranked[0][1], ranked[0][2]))[1:]


def choose_threshold(d: Data, score: np.ndarray, cover: float):
    """Selective classification: the confidence threshold with the best choose-part lower bound."""
    p = d.part(1)
    conf = np.abs(score[p][d.ok[p] & np.isfinite(score[p])])
    if conf.size < 100:
        return None
    best = None
    for level in ML_LEVELS:
        if level < cover:
            continue
        q = 0.0 if level >= 1.0 else float(np.quantile(conf, 1 - level))
        arr = np.where(np.isfinite(score) & (np.abs(score) >= q), np.sign(score), 0).astype(np.int8)
        w, n, cov = stats(d, arr, 1)
        if n >= MIN_CHOOSE and cov >= 0.8 * cover:
            key = lower(w, n)
            if best is None or key > best[0]:
                best = (key, f"top {round(100 * level)}% most confident", arr)
    return best[1:] if best else None


def run_asset(item: tuple[str, str, str]) -> dict:
    name, path, group = item
    s = cd.load(path)
    d = Data(s)
    if path.startswith("real/") and os.path.exists(os.path.join(cd.DATA, path + "-5.csv")):
        f = cd.load(path, 5)
        late = np.full(d.n, np.nan)
        first = {int(t): c for t, c in zip(f.t, f.c) if t % 60 == 0}
        for i, t in enumerate(s.t):
            late[i] = first.get(int(t), np.nan)
        d.late = late
    hours = d.ok.sum() / 60
    res = {"name": name, "group": group, "candles": d.n, "late": d.late is not None, "rows": []}

    def record(family: str, cover: float, picked) -> None:
        if picked is None:
            return
        label, arr = picked
        w, n, cov = stats(d, arr, 2)
        lw, ln = late_stats(d, arr)
        res["rows"].append({"family": family, "cover": cover, "label": label, "w": w, "n": n, "cov": cov,
                            "lw": lw, "ln": ln})

    all_rules = []
    for family, gen in RULE_FAMILIES.items():
        versions = list(gen(d))
        if not family.startswith("Breakout (extension"):
            all_rules += versions
        for cover in COVERAGE:
            record(family, cover, choose(d, versions, cover))
    for cover in COVERAGE:
        record("All rule families together (wider breakout + the rest)", cover, choose(d, all_rules, cover))
    for family, score in ml_scores(d).items():
        for cover in COVERAGE:
            record(family, cover, choose_threshold(d, score, cover))
    res["hours"] = float(hours)
    return res


# --------------------------------------------------------------------------- report
def cell(w: int, n: int, be: float) -> str:
    if not n:
        return "-"
    lo, hi = wilson(w, n)
    mark = "**" if lo > be else ""
    return f"{mark}{100 * w / n:.1f}%{mark} ({n:,})"


def main() -> None:
    items = asset_list()
    workers = max(1, min(8, (os.cpu_count() or 2) - 1))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run_asset, items))
    be = {r["name"]: 100 / (100 + PAYOUT.get(r["name"], PAYOUT_REAL)) for r in results}
    groups = ["OTC", "Forex", "Crypto", "Other"]
    families = list(RULE_FAMILIES) + ["All rule families together (wider breakout + the rest)",
                                      "Logistic regression (18 features)", "Gradient boosting (18 features)",
                                      "Nearest neighbours (last 8 candles)"]
    count = {g: sum(1 for r in results if r["group"] == g) for g in groups}
    out = ["# Round 5: more frequent arrows", "",
           f"{len(results)} assets, 1-minute candles: " + ", ".join(f"{count[g]} {g}" for g in groups) + ". "
           "Each family is tuned on the oldest 60% of an asset's candles for a minimum share of candles with an "
           "arrow (coverage), compared on the next 20% and judged once on the newest 20% (the check). "
           "Cells: check win rate of all assets of the group together (arrows); **bold** when the lower end of "
           f"its 95% range beats break-even ({10000 / (100 + PAYOUT_REAL):.1f}% at an {PAYOUT_REAL}% payout). "
           "Coverage 25% is about 15 arrows an hour, 50% about 30, 90% about 54.", ""]
    for g in groups:
        rows = [r for r in results if r["group"] == g]
        if not rows:
            continue
        out += [f"## {g} ({len(rows)} assets)", "",
                "| Family | Any coverage | At least 10% | 25% | 50% | 90% |", "|---|---|---|---|---|---|"]
        for fam in families:
            cells = []
            for cover in COVERAGE:
                w = n = 0
                arrows_per_hour = []
                for r in rows:
                    for x in r["rows"]:
                        if x["family"] == fam and x["cover"] == cover:
                            w += x["w"]
                            n += x["n"]
                            arrows_per_hour.append(60 * x["cov"])
                txt = cell(w, n, 100 / (100 + PAYOUT_REAL))
                if arrows_per_hour:
                    txt += f", {np.median(arrows_per_hour):.0f}/h"
                cells.append(txt)
            out.append(f"| {fam} | " + " | ".join(cells) + " |")
        # assets whose own check beats break-even
        out += ["", "Assets whose own check (lower end of the 95% range) beats break-even, all rule families together:", ""]
        line = []
        for cover in COVERAGE:
            hits = []
            for r in rows:
                for x in r["rows"]:
                    if x["family"].startswith("All rule") and x["cover"] == cover and x["n"]:
                        if wilson(x["w"], x["n"])[0] > be[r["name"]]:
                            hits.append(f"{r['name']} {100 * x['w'] / x['n']:.1f}% of {x['n']} ({x['label']})")
            line.append(f"- coverage {'any' if cover == 0 else f'{round(100 * cover)}%+'}: " +
                        (f"{len(hits)} of {len(rows)}: " + "; ".join(hits) if hits else f"none of {len(rows)}"))
        out += line + [""]
    late = [r for r in results if r["late"]]
    if late:
        out += ["## Entry 5 s after the open (8 real markets with 5-second candles)", "",
                "All rule families together; the same arrows, judged with the entry price at the open and 5 s later "
                "(the extension buys about 0.1 s after the open, between the two).", "",
                "| Coverage | Entry at the open | Entry 5 s later |", "|---|---|---|"]
        for cover in COVERAGE:
            w = n = lw = ln = 0
            for r in late:
                for x in r["rows"]:
                    if x["family"].startswith("All rule") and x["cover"] == cover:
                        w, n, lw, ln = w + x["w"], n + x["n"], lw + x["lw"], ln + x["ln"]
            out.append(f"| {'any' if cover == 0 else f'{round(100 * cover)}%+'} | {cell(w, n, 100 / (100 + PAYOUT_REAL))} | "
                       f"{cell(lw, ln, 100 / (100 + PAYOUT_REAL))} |")
        out.append("")
    with open(os.path.join(HERE, "results-frequency.md"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()

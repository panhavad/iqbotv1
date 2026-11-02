"""Second, deeper search round (see study.py for the first one).

    .venv\\Scripts\\python.exe research\\deep_search.py

E1  Learn from the current logic's own wins and losses (meta-labelling): a model is trained on
    the arrows of the training period, labelled win / loss, and trades only the arrows it trusts.
E2  One model trained on all OTC assets together (5x more data).
E3  Walk-forward: retrain every day on the 14 days before it, trade the next day.
E4  Massive rule search: 150,000 combinations of 2-4 conditions, and what their past win rate
    says about the future.
"""

from __future__ import annotations

import os
import sys
import warnings

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import candles as cd  # noqa: E402
from study import Asset, engine_predictions, fmt, score, single_rules, wilson  # noqa: E402

OTC = ["EURUSD-OTC", "GBPUSD-OTC", "CARDANO-OTC", "ETHUSD-OTC", "BTCUSD-OTC"]
HERE = os.path.dirname(os.path.abspath(__file__))


def gb(**kw):
    from sklearn.ensemble import HistGradientBoostingClassifier

    args = dict(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=100, l2_regularization=1.0, random_state=1)
    args.update(kw)
    return HistGradientBoostingClassifier(**args)


def pick_threshold(p, win, mask_val, min_n):
    """Highest validation win rate among thresholds that keep at least min_n trades."""
    best = (0.5, None)
    for thr in np.arange(0.50, 0.70, 0.005):
        m = mask_val & (p >= thr)
        n = int(m.sum())
        if n < min_n:
            break
        rate = win[m].mean()
        if best[1] is None or rate > best[1]:
            best = (thr, rate)
    return best[0]


def e1_meta(assets, out):
    out.append("\n## E1 - Learn which arrows of the current logic win (your idea)\n")
    out.append("| Asset | Arrows train / val / test | All arrows, test | Arrows the model trusts, test | 95% CI |")
    out.append("|---|---|---|---|---|")
    pooled = {"all": [0, 0], "kept": [0, 0]}
    for a in assets:
        pred = engine_predictions(a, {"Minimum agreement score": 0.15, "Minimum agreeing strategies": 2})
        fired = a.valid & (pred != 0) & (a.y != 0)
        win = (pred == a.y).astype(int)
        Xm = np.column_stack([a.X, pred])
        tr, va, te = (a.split[k] & fired for k in ("train", "val", "test"))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = gb(min_samples_leaf=50).fit(Xm[tr], win[tr])
            p = np.zeros(len(a.y))
            p[fired] = model.predict_proba(Xm[fired])[:, 1]
        thr = pick_threshold(p, win, va, max(60, int(0.1 * va.sum())))
        kept = te & (p >= thr)
        all_w, all_n = int(win[te].sum()), int(te.sum())
        k_w, k_n = int(win[kept].sum()), int(kept.sum())
        lo, hi = wilson(k_w, k_n)
        pooled["all"][0] += all_w; pooled["all"][1] += all_n
        pooled["kept"][0] += k_w; pooled["kept"][1] += k_n
        out.append(f"| {a.name} | {int(tr.sum())} / {int(va.sum())} / {all_n} | {100 * all_w / max(1, all_n):.1f}% | "
                   f"**{100 * k_w / max(1, k_n):.1f}%** ({k_n} arrows) | {100 * lo:.1f}-{100 * hi:.1f}% |")
    aw, an = pooled["all"]
    kw, kn = pooled["kept"]
    lo, hi = wilson(kw, kn)
    out.append(f"| **All OTC assets** | | {100 * aw / an:.1f}% ({an}) | **{100 * kw / max(1, kn):.1f}%** ({kn} arrows) | {100 * lo:.1f}-{100 * hi:.1f}% |")


def e2_pooled(assets, out):
    out.append("\n## E2 - One model trained on all OTC assets together\n")
    Xtr = np.vstack([a.X[a.split["train"] & (a.y != 0)] for a in assets])
    ytr = np.concatenate([(a.y[a.split["train"] & (a.y != 0)] > 0).astype(int) for a in assets])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = gb(max_iter=300, min_samples_leaf=300).fit(Xtr, ytr)
    probs = []
    for a in assets:
        p = np.full(len(a.y), 0.5)
        p[a.valid] = model.predict_proba(a.X[a.valid])[:, 1]
        probs.append(p)
    conf = [np.abs(p - 0.5) for p in probs]
    # One confidence threshold for all assets, chosen on pooled validation (keep >= 2% of candles).
    best = None
    for q in (0.5, 0.8, 0.9, 0.95, 0.98):
        thr = np.quantile(np.concatenate([c[a.split["val"]] for c, a in zip(conf, assets)]), q)
        w = n = 0
        for c, p, a in zip(conf, probs, assets):
            pred = np.where(c >= thr, np.where(p > 0.5, 1, -1), 0)
            s = score(pred, a.y, a.split["val"])
            w += s["w"]; n += s["n"]
        if best is None or w / n > best[1]:
            best = (thr, w / n, q)
    thr = best[0]
    out.append(f"Training rows: {len(ytr):,}. Confidence cut chosen on validation: top {100 * (1 - best[2]):.0f}% of candles.\n")
    out.append("| Asset | Validation | **Test (unseen)** | Test 95% CI |")
    out.append("|---|---|---|---|")
    tw = tn = 0
    for c, p, a in zip(conf, probs, assets):
        pred = np.where(c >= thr, np.where(p > 0.5, 1, -1), 0)
        v, t = score(pred, a.y, a.split["val"]), score(pred, a.y, a.split["test"])
        tw += t["w"]; tn += t["n"]
        out.append(f"| {a.name} | {fmt(v)} | **{fmt(t)}** | {100 * t['lo']:.1f}-{100 * t['hi']:.1f}% |")
    lo, hi = wilson(tw, tn)
    out.append(f"| **All** | | **{100 * tw / tn:.1f}% ({tn})** | {100 * lo:.1f}-{100 * hi:.1f}% |")


def e3_walk_forward(a, out, train_days=14, keep=0.05):
    out.append(f"\n## E3 - Walk-forward on {a.name}: retrain every day on the previous {train_days} days\n")
    day = (a.s.t // 86400)
    days = np.unique(day)
    w = n = 0
    daily = []
    for d in days[train_days:]:
        tr = a.valid & (a.y != 0) & (day >= d - train_days) & (day < d)
        te = a.valid & (day == d)
        if tr.sum() < 5000 or te.sum() < 500:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = gb(max_iter=150, min_samples_leaf=200).fit(a.X[tr], (a.y[tr] > 0).astype(int))
            p_tr = model.predict_proba(a.X[tr])[:, 1]
            p = model.predict_proba(a.X[te])[:, 1]
        cut = np.quantile(np.abs(p_tr - 0.5), 1 - keep)
        pred = np.zeros(len(a.y))
        idx = np.where(te)[0]
        pred[idx] = np.where(np.abs(p - 0.5) >= cut, np.where(p > 0.5, 1, -1), 0)
        s = score(pred, a.y, te)
        w += s["w"]; n += s["n"]
        daily.append(s["rate"])
    lo, hi = wilson(w, n)
    out.append(f"{len(daily)} trading days, the most confident {100 * keep:.0f}% of candles traded each day: "
               f"**{100 * w / n:.1f}% won** over {n:,} trades (95% CI {100 * lo:.1f}-{100 * hi:.1f}%). "
               f"Best day {100 * max(daily):.0f}%, worst day {100 * min(daily):.0f}%, "
               f"days above 53.2%: {sum(r > 0.532 for r in daily)} of {len(daily)}.")


def e4_search(a, out, combos=150_000, seed=11):
    out.append(f"\n## E4 - Massive rule search on {a.name}: {combos:,} combinations of 2-4 conditions\n")
    rules = single_rules(a, 200)
    conds = np.array([r[2] for r in rules])  # (rules, candles) booleans
    tr, va, te = a.split["train"], a.split["val"], a.split["test"]
    y = a.y
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(combos):
        size = rng.integers(2, 5)
        pick = rng.choice(len(rules), size=size, replace=False)
        cond = np.logical_and.reduce(conds[pick])
        m = tr & cond & (y != 0)
        n = int(m.sum())
        if n < 10:
            continue
        up = int((y[m] > 0).sum())
        direction = 1 if 2 * up >= n else -1
        w = up if direction > 0 else n - up
        rows.append((w / n, n, pick, direction))
    rows.sort(key=lambda r: -r[0])

    def future(selected):
        vw = vn = tw = tn = 0
        for _, _, pick, direction in selected:
            cond = np.logical_and.reduce(conds[pick])
            for mask, acc in ((va, "v"), (te, "t")):
                m = mask & cond & (y != 0)
                k = int(m.sum())
                hit = int((y[m] == direction).sum())
                if acc == "v":
                    vw += hit; vn += k
                else:
                    tw += hit; tn += k
        return vw, vn, tw, tn

    out.append("| Rules selected by their past (training) win rate | How many | Past win rate | Validation | **Test (unseen)** |")
    out.append("|---|---|---|---|---|")
    for label, sel in (
        ("90% or more on 10+ past trades", [r for r in rows if r[0] >= 0.9]),
        ("70% or more on 30+ past trades", [r for r in rows if r[0] >= 0.7 and r[1] >= 30]),
        ("60% or more on 100+ past trades", [r for r in rows if r[0] >= 0.6 and r[1] >= 100]),
        ("55% or more on 300+ past trades", [r for r in rows if r[0] >= 0.55 and r[1] >= 300]),
        ("Top 20 by past win rate (100+ trades)", [r for r in rows if r[1] >= 100][:20]),
    ):
        if not sel:
            out.append(f"| {label} | 0 | - | - | - |")
            continue
        sel = sel[:400]
        past = np.average([r[0] for r in sel], weights=[r[1] for r in sel])
        vw, vn, tw, tn = future(sel)
        out.append(f"| {label} | {len(sel)} | {100 * past:.1f}% | {100 * vw / max(1, vn):.1f}% ({vn:,}) | "
                   f"**{100 * tw / max(1, tn):.1f}% ({tn:,})** |")
    out.append(f"\n{len(rows):,} of the {combos:,} combinations had 10+ trades in the training period.")


def main():
    assets = [Asset(n) for n in OTC]
    out = ["# Deeper search (round 2)", "", "Same data and time splits as results.md. All OTC assets unless stated.", ""]
    print("E1", flush=True); e1_meta(assets, out)
    print("E2", flush=True); e2_pooled(assets, out)
    print("E3", flush=True); e3_walk_forward(assets[0], out)
    print("E4", flush=True); e4_search(assets[0], out)
    btc = Asset("BTCUSD")
    print("E3 BTC", flush=True); e3_walk_forward(btc, out, train_days=10)
    text = "\n".join(out) + "\n"
    with open(os.path.join(HERE, "results-deep.md"), "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text)


if __name__ == "__main__":
    main()

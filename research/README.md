# Signal research: what predicts the next 1-minute candle on IQ Option?

You asked for a logic that wins 90% of the time, trained on as much past data as possible. This
folder holds that search: the data, the code and every result. Short answer: **no logic reaches
90%, or even the 53% needed to make money, on the OTC assets.** One real effect was found on
**real Bitcoin** (not OTC): about **58%**, coming and going in stretches. That became the new
default signal, and real Bitcoin can be traded at 1 minute as a Digital option on weekdays.

## Data

All candles come from IQ Option itself (`get-candles`, through the logged-in test browser):

| Asset | 1-minute candles | Period |
|---|---|---|
| EUR/USD (OTC) | 87,124 | 60 days |
| GBP/USD (OTC), CARDANO (OTC), ETH (OTC), BTC (OTC) | 65,000 each | 45 days |
| BTC/USD, ETH/USD, XRP/USD (real markets) | 44,000 each | 30 days |
| EUR/USD (real market) | 45,000 | 45 days |

Plus 1 year of 15-minute candles, 4 months of 5-minute candles, and 7 days of 5-second Bitcoin
candles (to check the real entry price). The CSV files are not committed; `fetch_history.js`
downloads them again.

## Method: why "it won 90% in the past" means nothing

With enough tries, some rule always fits the past by luck. So every test splits each asset
**by time**: the first 60% of its candles to build the rules (train), the next 20% to choose
between them (validation), and the **last 20% only once, at the end (test)**. The test period
is what would have happened to real money. Win rates leave out ties (refunds), and every result
has a 95% confidence range.

Break-even: **53.2%** at an 88% payout, **51.3%** at 95% (Blitz).

## Results on the OTC assets (what you trade)

| What was tried | Best on past data | **On the unseen test period** |
|---|---|---|
| The old 15-strategy vote (default rules) | 50-52% | **47-52%** |
| 45 indicator features, every threshold, both directions | up to 57% | **45-52%** |
| Colour patterns of the last 2-5 candles | 51-53% | **49-51%** |
| Logistic regression and gradient boosting (45 features) | up to 68% | **46-54%**, small samples |
| **Your idea**: learn which of the old logic's arrows win (14,632 arrows) | - | **49.3%** (all OTC assets) |
| One model trained on all OTC assets (206,535 candles) | 51-52% | **50.3%** |
| Retrained every day on the last 14 days (walk-forward) | - | **49.4%** of 3,543 trades |
| **150,000 rule combinations**: the 32 that won 92% in the past | 92.2% | **51.3%** |
| ... the top 20 by past win rate (65%) | 65.0% | **43.8%** |

The rules that looked best in the past did *worse* than a coin flip afterwards. On these OTC
prices the next candle behaves like a coin flip, whatever the method (`results.md`,
`results-deep.md`).

## The one real effect: momentum on real Bitcoin

On the real Bitcoin market, a 1-minute candle that **closes at the high of the last 5 candles**
tends to be followed by another up candle (and a close at the 5-candle low by a down candle).
The rule was chosen on Bitcoin's first 80% and then checked on data it had never seen
(`results-momentum.md`):

| Data | Win rate (trades, 95% range) |
|---|---|
| Bitcoin, last 20% (unseen) | **59.8%** (1,633; 57.4-62.1%), about 260 arrows a day |
| ... buying 5 s after the open instead of at the open | **58.0%** (1,818; 55.7-60.2%) |
| Real ETH (never used to choose) | 53.2% (3,309; 51.5-54.9%) |
| Real XRP, real EUR/USD, all OTC assets | 48-51%: nothing |
| Bitcoin on 5-minute or 15-minute candles | 47-49%: nothing |

So the effect is real, but **only on 1-minute candles of real Bitcoin** (weaker on ETH). On
1 Nov 2026 (a Sunday) IQ Option offered no 1-minute Binary or Blitz option on real Bitcoin; round 3
found that it is offered as a 1-minute **Digital** option on weekdays (below).

## Round 3: real markets, Digital options and a replay of the extension

Downloaded afterwards (`results-real.md`): 60 days of 1-minute candles of the **59 real-market
assets** that IQ Option offers with a 1-minute or shorter option (indices, forex, commodities, stocks;
`real-assets.json`), two more months of Bitcoin, ETH and XRP (back to 2 Sep 2026), and 5-second
candles of 8 forex pairs and indices.

- **Real Bitcoin can be traded at 1 minute as a Digital option**, on weekdays from 05:00 to 17:00
  UTC (IQ Option's Digital schedule). Its Blitz options start at 3 minutes, where the arrows win only
  51.0% (section 5), and it has no 1-minute Binary option.
- **The Bitcoin rule on a month it had never seen** (September 2026): **53.1%** of 3,103 arrows.
  Better than chance (p < 0.001), but below break-even: the effect comes and goes.
- **The extension's own edge check, replayed walk-forward** on September to November: it was open
  22% of the time, and its trades won **59.8%** of 2,505; in the never-seen September **61.6%** of
  607. Trading only while the recent arrows beat break-even catches the good stretches. These win
  rates assume entry at the candle open; buying 2 s later cost about 2 points on Bitcoin.
- **Following the breakout on the other 58 real markets**: no lasting edge (the replayed edge check
  almost never opened, and lost when it did).
- **Fading it on real forex** (PUT after a close at the 5-candle high) looked good on the second half
  of the data (54.6% to 58.8% on 8 pairs). With the price 5 s after the open it falls to **53.5%**,
  and **50.1%** on Digital, where a tie loses: most of the reversal happens in the first seconds, and
  it is strongest at 21:00-24:00 UTC, when forex options are closed. Not tradable, so not added.

## Round 4: learning the best logic for each asset, in the extension

You asked for the logic to be learned asset by asset: run the current logic over as many candles as
possible, count arrows, wins and losses, adjust it and count again until it reaches 90%, store the
best logic per asset and use it when that asset is selected. The extension now does exactly that,
continuously ([extension/README.md](../extension/README.md#learning-the-best-logic-for-each-asset),
`extension/src/learner.js`): 264 versions of the breakout (lookback, zone, body, follow or reverse)
on each asset's last 20,000 candles, chosen on the older 80% and checked on the newest 20%, then
checked again with the price 5 s after the open.

Results on 2 Nov 2026, all 123 assets open at the time: **no asset's logic reached 90%** on its
check candles. The best version of each asset won a median 54.9% (up to 65.6%) on the candles it was
adjusted on, and a median **50.4%** (middle half 49.3-51.2%) on the newest candles. The highest
check, real NZD/USD at 61.0% from the open, fell to 54.8% with the realistic entry; no asset passes
the extension's trading gate. This repeats rounds 1-3 on more assets: on IQ Option's 1-minute
candles, adjusting a rule until it looks good on past candles produces a rule that is about a coin
flip on the next ones.

## What changed because of this research

- The chart script and the extension have a **Signal method** setting. The new default is
  **Breakout momentum (5 candles)**, the rule above. The old 15-strategy vote is still there.
- The extension measures the method on the asset you select (its last 5,000 candles, or its
  learned logic's check) and shows the win rate next to break-even. With **Only trade where it has
  an edge** switched on, it trades only where the arrows have beaten break-even (lower end of the
  95% range): on the OTC assets that means no trades, because the arrows have no edge there. Since
  version 1.3 this is off by default, at the user's request: the extension buys every arrow.
- The extension can buy **Digital** options (round 3), so real Bitcoin can be traded at 1 minute on
  weekdays. Its payout is read from IQ Option's price stream, and break-even follows it.

## Reproduce

```powershell
# from the repository root
.venv\Scripts\python.exe -m pip install -r research\requirements.txt
powershell -ExecutionPolicy Bypass -File extension\tools\start-test-browser.ps1   # logged-in test browser
node research\fetch_history.js 76 EURUSD-OTC 60           # <activeId> <name> <days> [candleSeconds]
node research\fetch_history.js 1916 BTCUSD 30
node research\fetch_history.js 1916 BTCUSD 7 5            # 5-second candles
.venv\Scripts\python.exe research\study.py                # round 1   -> results.md
.venv\Scripts\python.exe research\deep_search.py          # round 2   -> results-deep.md
.venv\Scripts\python.exe research\momentum.py             # Bitcoin   -> results-momentum.md (300 / 900 for 5 / 15 min)
node research\assets.js                                   # what can be traded right now (--all: also closed)
node research\fetch_real.js 60                            # round 3: the 59 real markets -> data\real\
node research\fetch_history.js 1916 BTCUSD 92             # older Bitcoin candles (also 1918 ETHUSD, 1921 XRPUSD)
node research\fetch_history.js 1878 real/USDCAD 8 5       # 5-second candles (also GBPCAD, CHFJPY, EURUSD, AUDUSD, EURGBP, NZDCAD, AU200)
.venv\Scripts\python.exe research\real_markets.py         # round 3   -> results-real.md
```

Asset ids used: EUR/USD (OTC) 76, GBP/USD (OTC) 81, CARDANO (OTC) 1974, ETH (OTC) 1941,
BTC (OTC) 2270, BTC/USD 1916, ETH/USD 1918, XRP/USD 1921, EUR/USD 1; round 3: `real-assets.json`.

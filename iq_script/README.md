# IQ Option chart script: next 1-minute HIGHER / LOWER

Two Quadcode Script (QCS) indicators for the IQ Option traderoom, made for **1-minute candles**
(any asset):

| File | What it shows |
|---|---|
| [NextMinuteSignal.lua](NextMinuteSignal.lua) | A green **CALL** arrow (buy HIGHER) or red **PUT** arrow (buy LOWER) on the candle to trade, plus a win / loss mark for every arrow. Also sends the platform "advice" (buy / sell / neutral). |
| [NextMinuteScoreboard.lua](NextMinuteScoreboard.lua) | Optional panel under the chart: the **real win rate** of those arrows on your chart, its 95% confidence band and the break-even line. |
| [extension/](extension/README.md) | Optional Chrome extension that trades the same arrows automatically on the asset you select (practice account by default). Read its README first. |
| [research/](research/README.md) | How the signal was trained and tested on about 600,000 real IQ Option candles, with every result. |

## Read this first: 90% is not possible

No indicator can guarantee 90% wins on 1-minute options, and this one does not pretend to. At an
88% payout you need **53.2%** wins just to break even (`100 / (100 + 88)`).

The signal logic was trained and tested on about 600,000 real IQ Option candles, with the newest
part of the data kept aside to check every rule on candles it had never seen
([research/README.md](research/README.md)):

- On the **OTC assets** (EUR/USD, GBP/USD, CARDANO, ETH, BTC (OTC)) nothing predicts the next
  candle: every method, including 150,000 trained rule combinations, won about **50%** on unseen
  candles. Rules that won 90% in the past won about 51% afterwards. OTC prices come from the broker.
- On **real Bitcoin**, a candle that closes at the high (low) of the last 5 candles is followed by
  an up (down) candle about **58%** of the time, in stretches (53% in a month the rule had never
  seen). That rule is now the default **Signal method**. Real Bitcoin's 1-minute option is the
  **Digital** option, open on weekdays from 05:00 to 17:00 UTC; the [extension](extension/README.md)
  trades it only while its recent arrows beat break-even.

The scoreboard shows the real win rate of the arrows on your own chart, so you can check this
yourself on any asset.

## Install (about 1 minute)

1. Open your asset's chart in the traderoom (for example EUR/USD (OTC)) and set the chart type to
   **Candles** and the **candle size to 1 minute**. The arrows are not drawn on the **Line** chart type.
2. Open **Indicators > Scripts**.
3. Choose **Import script** and pick `NextMinuteSignal.lua`, or choose **Add manually**, delete the sample code, paste the whole file, and click **Save**.
4. Click the **+** button under the code to add the script to the chart.
5. Optional: do the same with `NextMinuteScoreboard.lua`. It opens as a panel under the chart.

**Updating from an older copy:** importing adds a second script with the same name; it does not
change a copy that is already on the chart. Remove the old copy from the chart (**Indicators >
Added**, trash icon), delete the old script in **Scripts**, then import and add the new file.

These are the platform's own script options: Import (.lua or .txt), Add manually and Save. See
the [QCS documentation](https://quadcode-tech.github.io/quadcodescript-docs/Script-Options).

## How to trade an arrow (demo account first)

```
      ^ CALL    <- arrow under the candle that has just opened: buy HIGHER now
     |#|           expiry = the end of THIS candle (the first expiry in the list)
      o         <- after it closes: green dot = won, red X = lost, grey = tie
```

- An arrow appears **as soon as a new candle opens**. It was decided from the candles that
  had already closed, so it never moves, changes or disappears. In other words, it does not repaint.
- Buy right away, in the first seconds. Choose the expiry at the end of that same minute (the
  first one in the expiration list). IQ Option stops selling that expiry 30 seconds before it ends.
- The marks assume the trade was opened at the candle's open price. If you enter later, your
  entry price is different, so your result can differ from the mark.
- On the live candle, the mark shows whether the trade is winning **right now**.
- No arrow means no trade.

## Settings

| Group | Setting | Default | Meaning |
|---|---|---|---|
| Signal rules | Signal method | Breakout momentum | **Breakout momentum:** an arrow when a candle closes at the high (CALL) or low (PUT) of the last 5 candles. **15-strategy vote:** the earlier logic (see below). |
| | Breakout: candles | 5 | How many candles (this one included) the high and low are taken from. |
| | Breakout: close within (% of range) | 0 | 0: the close must be the high / low. 20: within the top / bottom 20% of the range. More means more arrows. |
| | Breakout: minimum body (% of candle) | 0 | Arrow only when the candle's body is at least this share of its high-low range. |
| | Reverse the arrows (fade) | off | CALL becomes PUT and PUT becomes CALL (both methods). |
| | Vote: minimum agreement score | 0.30 | How strongly the weighted votes must agree (0 to 1). Higher means fewer arrows. |
| | Vote: minimum agreeing strategies | 3 | How many strategies must point the same way. |
| | Vote: evidence gate | off | Follow a strategy family only if it has been winning on this chart, and fade it if it has been losing. Off by default: the traderoom loads only about 440 one-minute candles, too few for this test. |
| | Vote: evidence window | 1000 | How many recent candles the gate looks at. |
| | Vote: evidence needed (z-score) | 2.0 | How sure the gate must be. Lower means more arrows, more of them luck. |
| | Use the settings learned for each asset | on | Where the script's table of learned settings has the asset on the chart, its breakout settings replace the four "Breakout" / "Reverse" inputs above. The table is empty in the files here; the Chrome extension fills it in your account. Off: the inputs above apply everywhere. |
| Result marks | Show win / loss marks | on | The marks under each candle that had an arrow. |
| Scoreboard | Payout % | 88 | Enter the payout shown in the traderoom. It sets the break-even line. |
| | Recent window | 240 | Number of candles for the "recent" win-rate line. |

If you add both scripts, give them the **same "Signal rules" settings** so they score the same arrows.
The Chrome extension learns the breakout settings for each asset ([extension/README.md](extension/README.md#learning-the-best-logic-for-each-asset))
and writes them into both scripts in your account (Indicators > Scripts), as a table with one row per
asset (`LEARNED`, between the `LEARNED SETTINGS` markers in the script). The chart then draws each
learned asset's arrows with its own settings; reload the traderoom page after an update to see them
([details](extension/README.md#the-chart-shows-the-learned-logic-too)).

## Reading the scoreboard

- **Blue line:** the win rate of all arrows on the chart. **Orange line:** the last 240 candles.
- **Shaded band:** where the true win rate lies, with 95% confidence. With few trades the band is wide.
- **Red line:** break-even. The arrows only have a real edge if the **whole band** is above it.
  If the line sits around 50%, they are a coin flip.

## How it decides

**Breakout momentum (default).** When a candle closes at the highest high of the last 5 candles
(this one included), the next candle gets a CALL arrow; at the lowest low, a PUT arrow. On real
Bitcoin this was right about 58% of the time on candles it had not seen; on the OTC assets about
50% ([research](research/README.md)).

**15-strategy vote.** Fifteen classic strategies vote on the next candle:

- **Trend:** EMA 9/21/50 stack, 5-minute trend (Elder), Heikin-Ashi, EMA 5/10 cross, EMA 21
  pullback, MACD 12/26/9, Parabolic SAR, Bollinger squeeze breakout.
- **Mean reversion:** RSI 14 (30/70), Connors RSI-2, Bollinger 20/2 rejection,
  Stochastic 14/3/3, support/resistance rejection, 4-candle streak fade.
- **Patterns:** engulfing, hammer / shooting star, morning / evening star.

The votes are then weighted and filtered:

1. **ADX regime:** trend votes count more when ADX is 25 or higher, mean-reversion votes when it is 18 or lower.
2. **Evidence gate (optional, off by default):** for each family it counts how often its direction won on the following candle, using closed candles only.
3. **Agreement filter:** a strong enough agreement, at least 3 agreeing strategies, at least one entry
   trigger, and little disagreement.
4. **Volatility filter:** no arrow when volatility is abnormal.

Martingale (doubling after a loss) is deliberately not part of it.

## What was verified, and what was not

**In the real traderoom** (EUR/USD (OTC), 1-minute candles): both scripts import
without errors and their settings open. With the default settings the CALL and PUT arrows and the
win / loss marks are drawn, an arrow stays on its candle when the candle closes, and the scoreboard
draws its win-rate line, band and break-even line. The chart hands the script about 440 candles of
history. With the evidence gate on, not a single arrow appeared on them, which is why the gate is
now off by default.

The details were tested offline with a QCS emulator in [tests/qcs_emulator.lua](tests/qcs_emulator.lua):

- **API sources:** the [official documentation](https://quadcode-tech.github.io/quadcodescript-docs/)
  and the platform's own script library (github.com/quadcode-tech/quadcodescript-library).
- **Engines:** a real Lua 5.3 VM, and fengari (Lua in JavaScript). Both give identical output.
- **Strictness:** the emulator is stricter than the platform. It fails on series comparisons,
  history functions called inside `if`, unknown enum names, wrong `plot_shape` argument order,
  undefined globals and look-ahead offsets.
- **Indicators:** EMA, SMA, ATR, RSI, standard deviation, Parabolic SAR, highest and lowest match the
  reference indicators (themselves checked against the `ta` library). RSI is built exactly like the
  platform's own RSI script.
- **No repainting:** an arrow is identical whether its candle has just opened, spikes, or has closed.
  History never changes when new candles arrive.

Results of the 15-strategy vote on synthetic price data (not real IQ Option prices), break-even 53.2%:

| Market | Gate off (default, textbook rules) | Gate on |
|---|---|---|
| Random (nothing to find) | 50.7% over 4,205 trades: a coin flip | 4 arrows in 96,000 candles: it stays quiet |
| Ranging | 42.2%, rules systematically wrong | 53.8%, wrong rules faded |
| Trending | 56.6% | 57.5% |

**On real prices** both methods were measured on about 600,000 IQ Option candles: about 50% on
every OTC asset, and about 58% for Breakout momentum on real Bitcoin (details and every number in
[research/README.md](research/README.md)). The scoreboard shows the real win rate of the arrows on
your own chart.

If the script editor reports an error, send the message: the most likely cause is a platform
detail that differs from the documentation.

## For developers

```powershell
python -m venv .venv                                            # once, inside iq_script
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt # lupa: a real Lua 5.3 VM for the emulator
cd tests; npm install; cd ..                                    # optional: fengari for the cross-engine test
.venv\Scripts\python.exe build.py                               # rebuild both scripts from src/
.venv\Scripts\python.exe -m unittest discover -s tests -t .     # offline test-suite (about 10 minutes)
node --test extension/tests                                     # Chrome extension unit tests (seconds)
```

`src/core.lua` holds the shared signal logic. `build.py` combines it with the head and tail
files into the two importable scripts, and into `extension/src/lua-scripts.js` (the scripts the
extension writes into your account); edit `src/`, not the built files. New chart inputs go last:
the chart stores input values by position. The tests are
self-contained: `tests/reference.py` supplies the synthetic prices and the reference indicators,
and `tests/test_reference.py` pins those indicators to independent values.
The Chrome extension has a JavaScript port of `src/core.lua` (`extension/src/signal-engine.js`):
change both together. `tests/test_extension_engine.py` (needs Node.js) checks that they give the same
arrows, candle by candle.

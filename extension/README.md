# Next Minute Auto Trader (Chrome extension)

Trades the **Next Minute HIGHER/LOWER** arrows automatically on IQ Option, on the asset and option
type you select in the traderoom. When a new candle opens with a CALL or PUT arrow, it buys HIGHER
or LOWER right away, exactly as the [chart script](../README.md) tells you to trade by hand.

**It starts on the PRACTICE account and stays there until you change it.**

## Read this first

- **The OTC assets have no edge.** The signal was trained and tested on about 600,000 real
  IQ Option candles ([research](../research/README.md)). On every OTC asset, every method, from the
  old 15-strategy vote to 150,000 trained rule combinations, won about **50%** on candles it had
  not seen. At an 88% payout you need **53.2%** just to break even. No logic reached 90%.
- **The one real effect** is momentum on **real Bitcoin** (not OTC): about **58%**. That is the
  default method. Real Bitcoin can be traded at 1 minute only as a **Digital** option, on weekdays
  from 05:00 to 17:00 UTC (see [What it trades](#what-it-trades-your-traderoom-selection)).
- **It buys every arrow the moment it appears**: about 0.1 s after the candle opens (see
  [How it works](#how-it-works)), on every asset, also where the logic has not beaten break-even;
  the panel then says so. **Buy** limits it to the CALL (higher) or the PUT (lower) arrows, and the
  panel shows the win rate of each direction apart. Tick "Only trade where it has an edge"
  (Settings) to trade only where the arrows have recently beaten break-even: on the OTC assets that
  means no trades.
- **It learns the best logic for each asset** (on its own history, one asset after another) and
  uses it when you select that asset. It aims for the 90% you asked for, but judges every logic on
  candles it did not learn from: so far none came near 90% (see [Learning](#learning-the-best-logic-for-each-asset)).
- **Your account may be at risk.** Brokers often forbid automated trading, and IQ Option's terms
  reportedly prohibit automated tools and allow such accounts to be blocked. Read the current
  [Terms & Conditions](https://iqoption.com/en/terms-and-conditions/terms-conditions) before you use
  it, and especially before real money.
- Use the practice account. Only switch to real money if you accept losing the stakes.

## Install

1. Open `chrome://extensions` in Chrome and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension` folder.
3. Open the [traderoom](https://iqoption.com/traderoom) while logged in. The panel appears over the
   chart (drag it by its title). The toolbar button hides or shows it, or opens the traderoom.

**Exit:** the ⏻ button in the panel's title bar (press it twice) stops everything: auto-trading,
learning and the extension's connection, and removes the panel. The toolbar icon then shows **OFF**,
also after a page reload; click it to start the extension again (auto-trading starts off).

After changing the files, click the reload icon of the extension in `chrome://extensions`, then
reload the traderoom tab. After moving the folder, choose **Load unpacked** again with its new place.
Don't **Remove** the extension first: removing deletes its saved data. The extension keeps the same
ID wherever its folder is (fixed `key` in `manifest.json`), so its settings and learned logic stay.

## What it trades: your traderoom selection

The extension follows what the traderoom shows, as it changes: choose another asset or option type
and the panel switches at once (within half a second for Binary, Blitz and Digital, and a warning
for an unsupported type clears as soon as you choose a supported one). A new candle size, and a
Margin / CFD selection, follow when the traderoom saves its layout, 1 to 3 seconds later; the saved
layout is also read every 3 seconds. Assets are named as the traderoom names them (for example
"1000Sats (OTC)", "USD/JPY (OTC)"). The arrows are computed on the chart's candle size, so the trades
match the arrows on your chart.

| Option type in the traderoom | What the extension buys |
|---|---|
| **Binary** with 1-minute candles | An option that expires at the end of the candle. |
| **Blitz** | An option whose expiry equals the candle size (30 s, 1, 2 or 5 min, if that asset offers it), counted from the purchase. Set the chart's candle size to the expiry you want. The expiry chosen in the trade panel is not visible to the extension. |
| **Digital** with 1, 5 or 15-minute candles | An at-the-money option (strike = the price when it is bought) that expires at the end of the candle. Its payout changes all the time; the extension reads it from IQ Option's price stream just before buying and checks it against the minimum payout. |
| Margin / CFD, other | Nothing: the panel says it is not supported. |

If the selection cannot be traded (for example Binary on 5-minute candles), the panel says why.

**Real Bitcoin:** select **Digital** in the traderoom's asset list, then Bitcoin, with 1-minute
candles. IQ Option opens real Bitcoin Digital on weekdays from 05:00 to 17:00 UTC (14:00 to 02:00
in Japan); outside those hours the panel shows it as closed and nothing is bought. Bitcoin has no
1-minute Binary option, and its Blitz options start at 3 minutes, where the effect is gone
(51.0% at 3 minutes, [research](../research/README.md)).

### The traderoom's "+ NEW OPTION" button

The extension never uses the traderoom's HIGHER / LOWER buttons: it buys over its own connection,
so it carries on with the next position whatever the traderoom shows. But when an option ends (and
already when its buying window closes, 30 s before), IQ Option replaces HIGHER / LOWER with
**+ NEW OPTION** and waits there. While auto-trading is on, the extension presses that button itself
right after the option has ended, so the traderoom is always ready for the next position too:

- Only between deals. Pressed while an option of the asset is still running, the button opens a new
  traderoom tab, so the extension waits until every position on the asset (its own or yours) is
  closed. The log shows `Pressed "+ NEW OPTION" in the traderoom`.
- Never HIGHER or LOWER. The traderoom is drawn on a canvas; the extension reads the column of pixels
  through the trade panel's buttons and presses only an orange button with plain background under
  it. HIGHER always has LOWER right under it. Any other picture (another theme, layout or window size)
  means no press.
- Only in the tab that trades, only while auto-trading is on and the tab is visible.

## The panel

| Item | Meaning |
|---|---|
| Title bar | **–** folds the panel to its title; **⏻** exits (see [Install](#install)). |
| Asset line | What is followed: asset, option type, candle size, expiry and payout; under it the connection, the seconds to the next candle and the price. |
| **Win rate** card | How the logic used here did on this asset: for a learned logic, its result on the newest candles of its learning history, which were never used to choose it (with the price 5 s after the open where that was measured: "entry +5 s"); otherwise the panel's rules replayed on the last 5,000 candles. Arrows tested, and the win rate needed to break even. Below: the **CALL** and the **PUT** arrows apart, each with its win rate and number of arrows (hover for its 95% range); a direction that is not bought is dimmed. Colours: green when even the low end of the 95% range beats break-even, red below break-even, plain in between. |
| **Candle** card | The arrow of the candle that is open now: CALL (higher), PUT (lower) or no arrow, and what was done with it (for example "bought 0.2 s after the open", or "not bought (CALL only)"). |
| Reason line | What it does here: trading every arrow, or the CALL or PUT arrows only, at once (with their win rate here when it is below break-even), or why not: an option type it cannot trade, a closed asset, no edge (only with "Only trade where it has an edge" on), or auto-trading off. |
| **AUTO-TRADE** | Switches automatic trading on and off. Green = practice, red = real money. |
| **Buy** | Which arrows auto-trade buys: **Both** (default), **▲ CALL only** (higher) or **▼ PUT only** (lower). The other arrows still show on the chart and in the panel, and are not bought. |
| Practice / Real | Which balance pays the stakes, with both balances, updated as they change (trades from the extension or the traderoom, results, deposits). Changing it always switches auto-trading off. Real money also needs the tick "I accept trading with REAL money". |
| Stake | Amount of each option (minimum 1), and this session's trades and P/L. |
| **Logic for this asset** | The logic used here (learned, and when; or the panel's rules), the default logic's win rate next to the learned one's on the same newest candles (and the learned one's with the price 5 s after the open), and whether the target (90%) was reached. **Learn now** / **Learn again** learns this asset at once, with a progress bar. The last line tells whether the chart script has the learned logic, with **Reload chart** when the chart must reload to show this asset's new logic (see [The chart](#the-chart-shows-the-learned-logic-too)). |
| Settings (folded) | Trading: buy within (s after open, max 25), minimum payout, stop after trades / losses in a row / session loss, and **Only trade where it has an edge** (off: every arrow is bought; on: only where even the low end of the win rate's 95% range beats break-even, judged on the arrows that are bought: all of them, or only the CALL or the PUT ones). Learning: use the learned logic for each asset (on), learn all open assets in the background (on), candles to learn from (20,000; up to 60,000), target win rate (90%). Signal rules: used where no logic has been learned, as in the chart script. |
| Trades & activity (folded) | Session (also the CALL and the PUT trades apart; for a session started before this was added, from the next session), recent trades and log. Results come from IQ Option; one marked `*` was estimated from the candle close because IQ Option sent no result. |

## Safety rules built in

- Off and on the practice account by default. Real money needs an explicit tick, and changing the
  account switches auto-trading off.
- Optional, off by default ("Only trade where it has an edge" in Settings): no trade where the logic
  has not recently beaten break-even (for a learned logic: on its check candles), judged on the
  arrows that are bought (all, or only the CALL or the PUT ones).
- At most one order per candle, also across page reloads.
- Only one traderoom tab trades. Other tabs show **Standby** with the settings locked, and take over
  when the trading tab closes.
- No order after the entry window, below the minimum payout, while the asset is closed or suspended,
  or with too little balance.
- Stops on the trade, loss-streak and session-loss limits.
- The only traderoom button it ever presses is **+ NEW OPTION**, and only between deals (see above).
- After a page reload (within 5 minutes) auto-trading continues. When the traderoom is opened again
  later, auto-trading is off and the real-money tick is cleared.

## Learning the best logic for each asset

The extension learns, for every asset, the version of the signal that worked best on that asset's
own history, keeps it, and uses it whenever you select that asset (with the same candle size).

1. **The asset you select comes first.** When it has no learned logic yet, when its logic is more
   than 6 hours old, or when you press **Learn now** / **Learn again**, the extension downloads its candles
   (20,000 by default: about 14 days of 1-minute candles; up to 60,000), newest first.
2. **It runs the current logic** (5-candle breakout) and counts its arrows, wins and losses, then
   **adjusts it and counts again**: lookback 2 to 30 candles, how close to the high / low the close
   must be (0 to 30% of the range), a minimum candle body (0, 30 or 60%), and follow or reverse.
   That is 264 versions, about a quarter of a second of work.
3. **It stops early when a version reaches the target win rate** (90% by default) on candles it was
   not adjusted on. Otherwise it keeps the best version.
4. **Realistic entry.** When the chosen version beats a coin flip on its check candles, the extension
   downloads 5-second candles for that period and measures it again with the price 5 s after each
   candle's open (a cautious measure: the extension used to buy about 2 s after the open, and now
   buys about 0.1 s after it). On real markets much of a 1-minute edge happens in the first seconds.
   That second measurement is the one the panel shows; with "Only trade where it has an edge" on,
   a logic that could not be measured this way is not traded.
5. **Then the other open assets, one by one** ("Learn all open assets", on by default): every asset
   that can be traded with a 1-minute option at the moment, each learned again after 24 hours. About
   20 seconds per asset; the requests are paced and stay away from candle opens.

**How "best" is decided, and why the panel shows a lower number than the best one found.** With 264
versions, some always look good on past candles by luck: in the [research](../research/README.md),
rules that won 92% on past candles won 51% afterwards. So the history is split by time:

| Part | Candles (of 20,000) | Used for |
|---|---|---|
| Oldest 60% | 12,000 | Every version is measured here ("adjusted on"). |
| Next 20% | 4,000 | The 10 best versions are compared here; the best one is chosen. |
| Newest 20% | 4,000 | The chosen version is measured once (**check**). Nothing was chosen here. |

The **check** result is what the panel shows and what decides whether the asset is traded: with
"Only trade where it has an edge" on, an asset is traded only when the low end of the check's 95%
range beats break-even (with the price 5 s after the open, where that was measured).

The check is also counted for the **CALL** and the **PUT** arrows apart, so you can see whether one
direction does better and choose **Buy: CALL only** or **PUT only**. Each direction has about half
the arrows, so its 95% range is wider and a difference between the two is often chance: on EUR/USD
(2 Nov 2026) CALL won 52.3% and PUT 55.9% from the open, but CALL 56.8% and PUT 48.9% with the price
5 s after the open (about 180 arrows each). An asset learned before the split was added is learned
again as soon as you select it (about a minute).

**What it found on 2 Nov 2026** (all 123 assets open at the time, 20,000 candles each):

| | Result |
|---|---|
| Versions that reached 90% on their check candles | **0 of 123 assets** |
| Best version per asset, on the candles it was adjusted on | median 54.9%, highest 65.6% |
| The chosen version on the newest candles (check) | median **50.4%** (middle half of the assets: 49.3-51.2%) |
| Assets whose learned logic passes "Only trade where it has an edge" | **none** |

The highest check was real NZD/USD, a reversed 2-candle breakout: **61.0%** of 282 arrows from the
open, but **54.8%** with the price 5 s after the open, not enough at an 86% payout. The best after
that, USD/JPY, checked at 52.3% of 1,820 with the realistic entry. So with "Only trade where it has
an edge" on, none would be traded. The learning
keeps running (each asset again after 24 hours): if an asset's behaviour changes, the next learning
shows it.

### The chart shows the learned logic too

The extension keeps the **Next Minute HIGHER/LOWER** script in your account (Indicators > Scripts),
and **Next Minute Scoreboard** if you have it, up to date: it saves the current script (same script,
same place on your chart) with a table of the logic learned for every asset. The script looks up the
asset on the chart in that table (input **Use the settings learned for each asset**, on by default),
so the chart's arrows are the extension's arrows on every learned asset; on other assets it uses
its inputs.

- The chart reads its script only when the page loads. When this asset's logic on the chart is out
  of date, the panel shows **Reload chart** (it reloads the traderoom page).
- IQ Option refuses scripts longer than about 25,000 characters, so the saved copy has no comment
  lines or indentation: about 21,000 characters with 130 assets, room for about 300 (the selected
  asset is always kept). The commented source stays in [NextMinuteSignal.lua](../NextMinuteSignal.lua).
- Only scripts named "Next Minute HIGHER/LOWER" or "Next Minute Scoreboard" are changed, and only
  when their code changes; your other scripts are never touched. Import the script once
  ([chart script](../README.md)) for this to work.
- Checked on 2 Nov 2026: after the reload, the chart's arrows on 1000Sats (OTC) were exactly the
  learned 12-candle logic's (CALL 12:59 to 13:01, PUT 13:04 to 13:06), where the default logic had
  none.

## How it works

- The content script opens its own connection to IQ Option (`wss://ws.iqoption.com/echo/websocket`)
  with your login cookie, the same way the traderoom does. Nothing is sent anywhere else, and no
  password is stored.
- [src/signal-engine.js](src/signal-engine.js) is a line-by-line JavaScript port of the chart
  script's logic ([../src/core.lua](../src/core.lua)). It reads the closed candles of the followed
  asset from IQ Option and decides exactly like the script: the test suite compares both, candle by
  candle, for both methods, on synthetic markets and on 1,000 real EUR/USD (OTC) candles. In the
  traderoom, the five arrows the chart showed over 3 hours were the five arrows the extension computed,
  and after the switch to Breakout momentum the chart's one arrow in an hour (PUT at 07:38 on
  EUR/USD (OTC), 2 Nov 2026) was the extension's only arrow too.
- The arrow of a candle depends only on the candles before it, so it is known the moment the
  previous candle closes. IQ Option streams the followed candle about once a second and, when a
  candle ends, sends its final update about 0.1 s later (measured: 6 to 156 ms, for 30-second to
  5-minute candles), with the same values as the closed candle it publishes about 0.9 s after the
  end (44 of 44 compared). The extension decides the next arrow from that final update and buys at
  once; a moment later it compares the update with the published candle (and recomputes from the
  published candles should they ever differ). Without a final update it fetches the closed candle,
  as before. Live on 2 Nov 2026 (EUR/USD Blitz, practice): 14 candles decided 0.03 to 0.13 s after
  the open; the two arrows were bought 0.09 and 0.10 s after the open (the order left 5 ms after the
  final update) and IQ Option confirmed each about 0.35 s later. Before, orders were confirmed 1.4 to
  3 s after the open. A live Blitz test on the
  practice account (EUR/USD (OTC), 1-minute candles) bought at 09:04:02, expired at 09:05:01 and
  was settled by IQ Option's own result. Live Digital tests on 2 Nov 2026 (practice, EUR/USD (OTC),
  83% payout read from the price stream) bought at 09:50:01, 09:54:01, 09:58:01 and 10:13:01, each
  expiring at the end of its candle and settled by IQ Option (2 won, 2 lost).
- For Digital options it reads the asset's options (one per expiry) and their prices the way the
  traderoom does, and buys the at-the-money option that expires at the end of the candle, using the
  option's own name from IQ Option (for example `do76A20261102D003100T1MCSPT`).
- [src/page-hooks.js](src/page-hooks.js) runs inside the page for two things only, and changes
  nothing there. It reads pixels of the traderoom canvas right after IQ Option draws a frame (the
  canvas is cleared after each frame), for the **+ NEW OPTION** button; it records the drawing
  context IQ Option creates and never creates one. And it passes on the traderoom's selection the
  moment the traderoom asks the server about a new asset (`get-traders-mood`: asset and option type)
  or saves its layout, so the extension follows a new selection at once.
- Balances are pushed by IQ Option as they change (`internal-billing.balance-changed`), and read
  again after every position opens or closes, from any source, and every minute.
- Asset names come from the traderoom's own translations (`/api/lang/route-translations`, in the
  traderoom's language), so they read as in the traderoom.

### Differences from the chart

- The chart's win / loss marks, and the win rates measured from the open, assume entry at the
  candle's open price. The extension buys about 0.1 s after the open, so its entry price, and
  sometimes the result, can still differ a little. (On real Bitcoin, buying 2 s after the open
  instead of at the open cost about 2 points of win rate, 59.8% to 58.0%.)
- The 15-strategy vote starts its indicators from the history it has loaded; the chart and the
  extension may have loaded different amounts, so a different vote arrow is possible in rare
  borderline cases. The breakout method only looks at the last 5 candles, so it always agrees.

### Keep it running

- Keep the traderoom tab open. The extension asks Chrome not to discard the tab, and it keeps working
  in a background tab, but a closed tab, a sleeping computer or a lost connection means no trades.

## For developers

```powershell
node --test extension/tests                                      # unit tests: client, trader, safety rules
.venv\Scripts\python.exe -m unittest tests.test_extension_engine # JS engine = chart script, candle by candle
```

Run them from the repository root. [tests/fixtures/eurusd-otc-1m.json](tests/fixtures/eurusd-otc-1m.json)
holds the 1,000 real candles used by the tests.

| File | Purpose |
|---|---|
| [manifest.json](manifest.json) | Manifest V3: content scripts on the traderoom, `storage` permission only. |
| [background.js](background.js) | Toolbar button, and keeps the traderoom tab from being discarded. |
| [src/content.js](src/content.js) | Starts and exits the trader, its learning, the presser and the panel; stores settings and learned logic; keeps the chart script up to date; one-tab lock. |
| [src/signal-engine.js](src/signal-engine.js) | The Next Minute signal (port of `src/core.lua`). Keep both in step. |
| [src/iq-client.js](src/iq-client.js) | IQ Option WebSocket client: login, candles, payout, asset names, Binary / Blitz / Digital orders, results, chart scripts. |
| [src/trader.js](src/trader.js) | Follows the selection, candle cycle, Digital options and prices, balances, learned logic per asset, safety checks, orders, results and stop rules. |
| [src/learner.js](src/learner.js) | Learns the best logic of an asset (264 versions, learn / choose / check split) and the learning queue. |
| [src/chart-script.js](src/chart-script.js) | Writes the learned table into the account's chart scripts (compact copy under IQ Option's length limit). |
| [src/lua-scripts.js](src/lua-scripts.js) | The two chart scripts as text, generated by `build.py` from `src/*.lua`: do not edit. |
| [src/new-option.js](src/new-option.js) | Finds and presses the traderoom's **+ NEW OPTION** button between deals. |
| [src/page-hooks.js](src/page-hooks.js) | Runs in the page: reads a pixel column of the traderoom canvas on request, and passes on the traderoom's selection. |
| [src/panel.js](src/panel.js) | The on-page panel (Shadow DOM). |
| [tools/start-test-browser.ps1](tools/start-test-browser.ps1) | Opens a separate test Chrome that stays logged in, with this extension loaded (see below). |
| [tools/test-browser.js](tools/test-browser.js) | The launcher behind it: starts that Chrome and loads the extension over a DevTools pipe. |

### Test browser that stays logged in

`tools/start-test-browser.ps1` opens Chrome with its own profile in `%LOCALAPPDATA%\iqbot\chrome-profile`
and a DevTools port on `127.0.0.1:9555`, so test scripts (for example Playwright `connectOverCDP`)
can drive the traderoom. Log in once in that window: the login is kept in that profile, so later
test runs need no new login (the IQ Option session lasts about 30 days). It never touches your
everyday Chrome profile.

It also loads this `extension` folder at every start (`-Headless` runs it without a window). Chrome
137 and later ignore `--load-extension`, so [tools/test-browser.js](tools/test-browser.js) loads it
over a DevTools pipe (`Extensions.loadUnpacked`); Chrome keeps such an extension for that session
only, which is why it is loaded again each time, always from where the repository is now. The fixed
`key` in [manifest.json](manifest.json) gives the extension the same ID everywhere
(`ijjacjebpolkbjnhibdnimfhpcnnipmg`), so its settings and learned logic stay with it. The launcher
needs Node.js and runs in the background until that Chrome is closed (log:
`%LOCALAPPDATA%\iqbot\test-browser.log`).

// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AutoTrader, digitalPayouts, digitalSymbol } = require('../src/trader.js');
const { createEngine } = require('../src/signal-engine.js');
const { FakeIqClient, realCandles, immediateTimer, trendCandles, digitalInstruments } = require('./fakes.js');

const CANDLES = realCandles();

// Candles whose arrow (decided when the previous candle closed) is CALL or PUT.
const SIGNALS = (() => {
  const engine = createEngine();
  const out = [];
  CANDLES.forEach((c, k) => {
    const { decision } = engine.update({ open: c.open, high: c.max, low: c.min, close: c.close });
    if (decision !== 0 && k + 1 < CANDLES.length) out.push({ t: k + 1, from: CANDLES[k + 1].from, decision });
  });
  return out;
})();

async function setup(settings, clientOptions) {
  const first = SIGNALS[0];
  const client = new FakeIqClient(CANDLES, Object.assign({ time: first.from + 2 }, clientOptions));
  // These tests are about the order flow, so the edge rule is off unless a test switches it on.
  const trader = new AutoTrader({ client, settings: Object.assign({ enabled: true, requireEdge: false }, settings), setTimer: immediateTimer });
  await trader.start();
  return { client, trader, first };
}

async function runSignal(client, trader, sig, lateSec = 2) {
  client.time = sig.from + lateSec;
  await trader.cycle(sig.from);
}

function settle(client, order, result) {
  client.emit('position-changed', { status: 'closed', raw_event: { binary_options_option_changed1: { option_id: order.id, result } } });
}

// Waits until fn() is true (timers and server replies are asynchronous), or fails after timeoutMs.
async function until(fn, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > end) assert.fail('condition not met in ' + timeoutMs + ' ms: ' + fn.toString());
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('the real candles contain arrows to trade', () => {
  assert.ok(SIGNALS.length >= 10, 'found ' + SIGNALS.length);
});

test('buys the arrow at the candle open on the practice balance, expiring at the candle close', async () => {
  const { client, trader, first } = await setup({ stake: 2 });
  assert.equal(client.orders.length, 1);
  assert.deepEqual(client.orders[0], {
    id: client.orders[0].id, kind: 'turbo', balanceId: 111, activeId: 76, direction: first.decision > 0 ? 'call' : 'put',
    expiresAt: first.from + 60, expirationSize: 60, amount: 2, price: CANDLES[first.t - 1].close, payout: 88,
  });
  assert.equal(trader.lastSignal.decision, first.decision);
  assert.equal(trader.lastSignal.traded, true);
  assert.ok(client.subs.some((s) => s.name === 'candle-generated' && s.filters.active_id === 76 && s.filters.size === 60));
  for (const type of ['turbo-option', 'blitz-option']) {
    assert.ok(client.subs.some((s) => s.name === 'portfolio.position-changed' && s.filters.user_balance_id === 111 && s.filters.instrument_type === type), type);
  }
  assert.match(trader.getState().targetLabel, /EUR\/USD \(OTC\) Binary, 1 min candles/);
});

test('the traded direction is the chart arrow for every signal candle', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  for (const sig of SIGNALS.slice(1, 15)) await runSignal(client, trader, sig);
  const expected = SIGNALS.slice(0, 15).map((s) => [s.from + 60, s.decision > 0 ? 'call' : 'put']);
  assert.deepEqual(client.orders.map((o) => [o.expiresAt, o.direction]), expected);
});

test('only shows the signal while auto-trading is off', async () => {
  const { client, trader, first } = await setup({ enabled: false });
  assert.equal(client.orders.length, 0);
  assert.equal(trader.lastSignal.decision, first.decision);
  assert.match(trader.lastSignal.note, /auto-trading is off/);
});

test('never trades real money without the explicit confirmation', async () => {
  const unconfirmed = await setup({ account: 'real', realConfirmed: false });
  assert.equal(unconfirmed.client.orders.length, 0);
  assert.match(unconfirmed.trader.lastSignal.note, /real money is not confirmed/);

  const confirmed = await setup({ account: 'real', realConfirmed: true });
  assert.equal(confirmed.client.orders.length, 1);
  assert.equal(confirmed.client.orders[0].balanceId, 222);
});

test('changing the account switches auto-trading off', async () => {
  const { trader } = await setup();
  trader.setSettings({ account: 'real' });
  assert.equal(trader.settings.enabled, false);
  trader.setSettings({ enabled: true });
  assert.match(trader.skipReason(SIGNALS[1].from), /off|real money is not confirmed/);
});

test('skips late entries, low payouts, closed assets and low balances', async () => {
  const late = await setup({ entryWindowSec: 5 }, { time: SIGNALS[0].from + 6 });
  assert.equal(late.client.orders.length, 0);
  assert.match(late.trader.lastSignal.note, /too late/);

  const payout = await setup({ minPayout: 90 });
  assert.equal(payout.client.orders.length, 0);
  assert.match(payout.trader.lastSignal.note, /payout 88% below 90%/);

  const closed = await setup({}, { asset: { name: 'front.EURUSD-OTC', enabled: true, suspended: true, payout: 88 } });
  assert.equal(closed.client.orders.length, 0);
  assert.match(closed.trader.lastSignal.note, /closed/);

  const poor = await setup({ stake: 5 }, { balances: [{ id: 111, type: 4, amount: 3, currency: 'USD', user_id: 1 }] });
  assert.equal(poor.client.orders.length, 0);
  assert.match(poor.trader.lastSignal.note, /balance too low/);
});

test('places at most one order per candle', async () => {
  const { client, trader, first } = await setup();
  await trader.cycle(first.from);
  client.emit('candle-generated', { active_id: 76, size: 60, from: first.from, open: 1, close: 1, min: 1, max: 1 });
  client.time = first.from + 3;
  trader.onTick();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.orders.length, 1);
  assert.equal(await trader.maybeTrade(first.from, first.decision), undefined);
  assert.equal(client.orders.length, 1);
});

test('settles results and stops after the loss streak limit', async () => {
  const { client, trader } = await setup({ maxLossStreak: 2, maxTrades: 100, maxSessionLoss: 0 });
  settle(client, client.orders[0], 'win');
  assert.equal(trader.session.wins, 1);
  assert.equal(trader.session.pnl, 0.88);
  await runSignal(client, trader, SIGNALS[1]);
  settle(client, client.orders[1], 'loose');
  await runSignal(client, trader, SIGNALS[2]);
  settle(client, client.orders[2], 'loose');
  assert.equal(trader.session.losses, 2);
  assert.equal(trader.settings.enabled, false);
  assert.match(trader.session.stopReason, /2 losses in a row/);
  await runSignal(client, trader, SIGNALS[3]);
  assert.equal(client.orders.length, 3);
});

test('stops at the session loss limit and at the trade limit', async () => {
  const loss = await setup({ maxSessionLoss: 1.5, maxLossStreak: 100, maxTrades: 100 });
  settle(loss.client, loss.client.orders[0], 'loose');
  assert.equal(loss.trader.settings.enabled, true);
  await runSignal(loss.client, loss.trader, SIGNALS[1]);
  settle(loss.client, loss.client.orders[1], 'loose');
  assert.equal(loss.trader.settings.enabled, false);
  assert.match(loss.trader.session.stopReason, /session loss limit/);

  const count = await setup({ maxTrades: 2, maxLossStreak: 100, maxSessionLoss: 0 });
  settle(count.client, count.client.orders[0], 'equal');
  await runSignal(count.client, count.trader, SIGNALS[1]);
  settle(count.client, count.client.orders[1], 'win');
  assert.equal(count.trader.session.ties, 1);
  assert.equal(count.trader.settings.enabled, false);
  assert.match(count.trader.session.stopReason, /trade limit/);
});

test('reads the balances again after a buy and after a result', async () => {
  const { client, trader } = await setup({ stake: 2 });
  await until(() => trader.getState().balances.practice.amount === 9998); // the stake is taken when the option is bought
  client.balancesList[0].amount = 10001.76;
  settle(client, client.orders[0], 'win');
  await until(() => trader.getState().balances.practice.amount === 10001.76);
});

test('estimates a result from the candle close when the server sends none', async () => {
  const { client, trader, first } = await setup();
  const trade = trader.trades[0];
  client.time = first.from + 60 + 21;
  trader.onTick();
  await until(() => trade.result !== null);
  const candle = CANDLES.find((c) => c.from === first.from);
  const diff = candle.close - trade.entry;
  const expected = diff === 0 ? 'tie' : (trade.direction === 'call' ? diff > 0 : diff < 0) ? 'win' : 'loss';
  assert.equal(trade.result, expected);
  assert.equal(trade.estimated, true);
});

test('a refused order is reported and not counted', async () => {
  const candles = CANDLES;
  const client = new FakeIqClient(candles, { time: SIGNALS[0].from + 2 });
  client.refuseOrders = true;
  const trader = new AutoTrader({ client, settings: { enabled: true, requireEdge: false }, setTimer: immediateTimer });
  await trader.start();
  assert.equal(trader.session.trades, 0);
  assert.equal(trader.trades[0].status, 'failed');
  assert.match(trader.logLines[0] + trader.logLines[1], /Order refused/);
});

test('never trades the same candle twice, even after a page reload', async () => {
  const { client, trader, first } = await setup();
  assert.equal(client.orders.length, 1);
  assert.equal(trader.session.lastTradeFrom, first.from);
  // A new tab / reload: a fresh trader restored from the stored session, still inside the entry window.
  const again = new AutoTrader({ client, settings: { enabled: true }, session: JSON.parse(JSON.stringify(trader.session)), setTimer: immediateTimer });
  await again.start();
  assert.equal(client.orders.length, 1);
  assert.match(again.lastSignal.note, /already traded this candle/);
  // Switching auto-trading off and on again keeps the guard.
  again.setSettings({ enabled: false });
  again.setSettings({ enabled: true });
  assert.equal(again.skipReason(first.from), 'already traded this candle');
});

test('keeps the engine between candles and fetches only the new candles', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const counts = [];
  const original = client.candles.bind(client);
  client.candles = (...args) => { counts.push(args[3]); return original(...args); };
  const sig = SIGNALS[1];
  for (let from = SIGNALS[0].from + 60; from <= sig.from; from += 60) {
    client.time = from + 1;
    await trader.cycle(from);
  }
  assert.ok(counts.length > 0 && counts.every((n) => n <= 3), 'requested counts: ' + counts.join(','));
  assert.equal(client.orders.length, 2);
  assert.equal(client.orders[1].direction, sig.decision > 0 ? 'call' : 'put');
});

test('changing the signal rules rebuilds the engine with them', async () => {
  const { trader } = await setup();
  assert.ok(trader.engine);
  trader.setSettings({ rules: { minScore: 0.9 } });
  assert.equal(trader.engine, null);
  assert.equal(trader.settings.rules.minScore, 0.9);
  assert.equal(trader.settings.rules.minAgree, 3);
});
test('the server clock starts the decision right after the minute turns', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const sig = SIGNALS[1];
  for (let from = SIGNALS[0].from + 60; from < sig.from; from += 60) { client.time = from + 1; await trader.cycle(from); }
  client.time = sig.from + 0.1;
  trader.onClock();
  assert.equal(trader.cycleFrom, sig.from - 60, 'too early: before 0.2 s');
  client.time = sig.from + 0.3;
  trader.onClock();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(trader.cycleFrom, sig.from);
  assert.equal(client.orders.length, 2);
});

// A live update of the candle `c` as IQ Option streams it; `final`: the one sent when it closes.
function update(c, final, size = 60) {
  return { active_id: 76, size, from: c.from, to: c.from + size, at: (final ? c.from + size : c.from + size - 1) * 1e9,
    open: c.open, close: c.close, min: c.min, max: c.max };
}

// Runs every candle up to (not including) the one of `sig`, so the engine is one candle behind it.
async function upTo(client, trader, sig) {
  for (let from = SIGNALS[0].from + 60; from < sig.from; from += 60) { client.time = from + 1; await trader.cycle(from); }
}

test('buys the moment the closed candle\'s final update arrives, before the candle can be fetched', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const sig = SIGNALS[1];
  await upTo(client, trader, sig);
  const prev = CANDLES[sig.t - 1];
  client.publishDelay = 0.9; // as on IQ Option
  const events = [];
  const candles = client.candles.bind(client);
  const openOption = client.openOption.bind(client);
  client.candles = (...args) => { events.push('fetch'); return candles(...args); };
  client.openOption = (order) => { events.push('order'); return openOption(order); };
  client.time = sig.from - 0.9;
  client.emit('candle-generated', update(prev, false));
  assert.equal(trader.cycleFrom, sig.from - 60, 'an update during the candle decides nothing');
  client.time = sig.from + 0.1;
  client.emit('candle-generated', update(prev, true));
  await until(() => client.orders.length === 2);
  assert.equal(events[0], 'order', 'nothing fetched before the order: ' + events.join(','));
  assert.equal(client.orders[1].direction, sig.decision > 0 ? 'call' : 'put');
  assert.equal(client.orders[1].expiresAt, sig.from + 60);
  assert.deepEqual([trader.engineLast, trader.lastSignal.note], [sig.from - 60, 'traded']);
  assert.ok(Math.abs(trader.lastSignal.boughtAfter - 0.1) < 1e-6, String(trader.lastSignal.boughtAfter));
  assert.match(trader.getState().log.join('\n'), /Bought (CALL|PUT) 1 EUR\/USD \(OTC\) Binary 0\.1 s after the open/);
  // A moment later the published candle is compared with it: the same, so nothing changes.
  client.time = sig.from + 1;
  await until(() => events.filter((e) => e === 'fetch').length >= 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(trader.engine);
  assert.doesNotMatch(trader.getState().log.join('\n'), /other values/);
});

test('a Blitz bought right after the open expires one candle later, even with the clock estimate a little behind', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 },
    { selection: { activeId: 76, activeType: 'blitz-option', candleSize: 60 } });
  const sig = SIGNALS[1];
  await upTo(client, trader, sig);
  client.time = sig.from - 0.04; // the final update arrived; the server clock estimate is 40 ms behind
  client.emit('candle-generated', update(CANDLES[sig.t - 1], true));
  await until(() => client.orders.length === 2);
  assert.deepEqual([client.orders[1].kind, client.orders[1].expiresAt], ['blitz', sig.from + 60]);
});

test('when the final update does not come, the closed candle is fetched as before', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const sig = SIGNALS[1];
  await upTo(client, trader, sig);
  client.emit('candle-generated', update(CANDLES[sig.t - 1], false)); // updates of the candle were coming in
  client.time = sig.from + 1.2;
  await trader.cycle(sig.from);
  assert.equal(client.orders.length, 2, trader.lastSignal.note);
  assert.equal(client.orders[1].direction, sig.decision > 0 ? 'call' : 'put');
});

test('a candle published with other values than its final update is recomputed from the closed candles', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const sig = SIGNALS[1];
  await upTo(client, trader, sig);
  const prev = CANDLES[sig.t - 1];
  client.time = sig.from + 0.1;
  client.emit('candle-generated', update(Object.assign({}, prev, { close: prev.close + 0.0001, max: Math.max(prev.max, prev.close + 0.0001) }), true));
  await until(() => trader.engine === null);
  assert.match(trader.getState().log.join('\n'), /published with other values than its last live update/);
  const next = sig.from + 60;
  client.time = next + 1;
  await trader.cycle(next);
  assert.ok(trader.engine, 'rebuilt from the published candles');
  assert.equal(trader.engineLast, sig.from);
  const engine = createEngine();
  for (const c of CANDLES.filter((x) => x.from < next)) engine.update({ open: c.open, high: c.max, low: c.min, close: c.close });
  assert.equal(trader.lastSignal.decision, engine.nextDecision);
});

test('a rules change while candles are loading does not break the next decision', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const original = client.candles.bind(client);
  client.candles = async (...args) => {
    const list = await original(...args);
    trader.setSettings({ rules: { minScore: 0.3 } }); // same value, but still a settings change mid-request
    trader.engine = null;                             // as if the rules had changed while waiting
    return list;
  };
  const from = SIGNALS[0].from + 60;
  client.time = from + 1;
  await trader.cycle(from);
  assert.ok(trader.engine, 'engine rebuilt');
  assert.equal(trader.engineLast, from - 60);
  assert.doesNotMatch(trader.lastSignal.note, /no data/);
});
test('follows the asset and option type selected in the traderoom', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  assert.equal(client.orders.length, 1);
  // The user switches the traderoom to CARDANO (OTC) Blitz.
  client.selection = { activeId: 1974, activeType: 'blitz-option', candleSize: 60 };
  const sig = SIGNALS[1];
  client.time = sig.from - 30;
  await trader.checkLayout(false);
  assert.equal(trader.target.activeId, 1974);
  assert.equal(trader.target.kind, 'blitz');
  assert.ok(client.unsubs.some((s) => s.name === 'candle-generated' && s.filters.active_id === 76));
  assert.ok(client.subs.some((s) => s.name === 'candle-generated' && s.filters.active_id === 1974 && s.filters.size === 60));
  assert.match(trader.getState().targetLabel, /CARDANO \(OTC\) Blitz, 1 min candles, expiry 1 min, payout 84%/);
  client.time = sig.from + 2;
  await trader.cycle(sig.from);
  const order = client.orders[client.orders.length - 1];
  assert.deepEqual(
    { kind: order.kind, activeId: order.activeId, expiresAt: order.expiresAt, expirationSize: order.expirationSize, payout: order.payout },
    { kind: 'blitz', activeId: 1974, expiresAt: sig.from + 2 + 60, expirationSize: 60, payout: 84 });
  assert.equal(order.direction, sig.decision > 0 ? 'call' : 'put');
  // Reading the same selection again changes nothing.
  const subs = client.subs.length;
  await trader.checkLayout(false);
  assert.equal(client.subs.length, subs);
});

test('explains and skips selections it cannot trade', async () => {
  const cases = [
    [{ activeId: 76, activeType: 'fx-option', candleSize: 60 }, /FX options is not supported/],
    [{ activeId: 76, activeType: 'turbo-option', candleSize: 300 }, /1-minute candles/],
    [{ activeId: 1916, activeType: 'blitz-option', candleSize: 60 }, /no 1 min expiry/],
    [{ activeId: 1916, activeType: 'turbo-option', candleSize: 60 }, /no Binary options/],
    [{ activeId: 76, activeType: 'digital-option', candleSize: 120 }, /1, 5 or 15-minute candles/],
    [{ activeId: 1974, activeType: 'digital-option', candleSize: 60 }, /no Digital options/],
  ];
  for (const [selection, why] of cases) {
    const { client, trader } = await setup({}, { selection });
    assert.match(trader.target.reason, why, JSON.stringify(selection));
    assert.equal(client.orders.length, 0, JSON.stringify(selection));
    assert.match(trader.skipReason(SIGNALS[0].from), why);
  }
});

test('names every selection like the traderoom, also when it cannot be traded', async () => {
  const forex = await setup({}, { selection: { activeId: 85, activeType: 'forex', candleSize: 60 } });
  assert.match(forex.trader.getState().targetLabel, /^USD\/JPY \(OTC\)/);
  assert.match(forex.trader.target.reason, /Forex is not supported/);
  const binary = await setup({}, { selection: { activeId: 85, activeType: 'binary-option', candleSize: 60 } });
  assert.match(binary.trader.getState().targetLabel, /^USD\/JPY \(OTC\) Binary/);
  assert.match(binary.trader.target.reason, /only 15 min Binary options here/);
  assert.equal(binary.client.orders.length, 0);
});

test('switching Forex back to Binary on the same chart clears the warning and re-checks the open candle at once', async () => {
  const { client, trader, first } = await setup({}, { selection: { activeId: 76, activeType: 'forex', candleSize: 60 } });
  assert.notEqual(trader.lastSignal.decision, 0);
  assert.match(trader.lastSignal.note, /not traded: Forex is not supported/);
  assert.equal(client.orders.length, 0);
  client.selection = { activeId: 76, activeType: 'turbo-option', candleSize: 60 };
  client.time = first.from + 4;
  await trader.applyLayout(await client.layout());
  assert.equal(trader.target.reason, '');
  assert.equal(trader.lastSignal.note, 'traded', 'bought inside the entry window');
  assert.equal(client.orders.length, 1);
  assert.equal(client.orders[0].direction, first.decision > 0 ? 'call' : 'put');
});

test('selections that arrive quickly are applied in order, the newest last', async () => {
  const { client, trader } = await setup();
  const seen = [];
  const original = trader.retarget.bind(trader);
  trader.retarget = async (layout, force) => { seen.push(layout.activeId); return original(layout, force); };
  await Promise.all([
    trader.applyLayout({ activeId: 1974, activeType: 'blitz-option', candleSize: 60 }),
    trader.applyLayout({ activeId: 76, activeType: 'blitz-option', candleSize: 60 }),
    trader.applyLayout({ activeId: 1974, activeType: 'turbo-option', candleSize: 60 }),
  ]);
  assert.deepEqual(seen, [1974, 1974], 'the middle one was replaced by the newest before it ran');
  assert.equal(trader.target.activeId, 1974);
  assert.equal(trader.target.kind, 'turbo');
  void client;
});

test('follows the traderoom the moment an asset is chosen, before the traderoom saves it', async () => {
  const { client, trader } = await setup();
  assert.equal(trader.target.activeId, 76);
  const t0 = client.time;
  await trader.selectionHint(1974, 'blitz-option');
  assert.deepEqual([trader.target.activeId, trader.target.kind, trader.target.candleSize], [1974, 'blitz', 60]);
  // Until the traderoom saves the new selection, the poll still reads the old one: ignored.
  client.time = t0 + 4;
  await trader.checkLayout(false);
  assert.equal(trader.target.activeId, 1974);
  // Saved (here with 30-second candles): the poll applies it.
  client.selection = { activeId: 1974, activeType: 'blitz-option', candleSize: 30 };
  client.time = t0 + 6;
  await trader.checkLayout(false);
  assert.deepEqual([trader.target.activeId, trader.target.candleSize, trader.hint], [1974, 30, null]);
  // Unknown instrument types and the selection already followed are not hints.
  assert.equal(trader.selectionHint(76, 'something-else'), null);
  assert.equal(trader.selectionHint(1974, 'blitz-option'), null);
  // A hint the traderoom never saves is dropped after 10 seconds.
  await trader.selectionHint(76, 'turbo-option');
  assert.equal(trader.target.activeId, 76);
  client.time = t0 + 20;
  await trader.checkLayout(false);
  assert.deepEqual([trader.target.activeId, trader.target.candleSize], [1974, 30]);
  // The saved selection always counts.
  await trader.selectionHint(76, 'turbo-option');
  await trader.layoutSaved({ activeId: 76, activeType: 'turbo-option', candleSize: 60 });
  assert.deepEqual([trader.target.activeId, trader.target.kind, trader.target.candleSize, trader.hint], [76, 'turbo', 60, null]);
});

test('balances change live: pushed changes, positions from any source, and a regular read', async () => {
  const { client, trader } = await setup();
  assert.ok(client.subs.some((s) => s.name === 'internal-billing.balance-changed' && !s.filters && s.version === '1.0'));
  client.emit('balance-changed', { current_balance: { id: 222, amount: 100, currency: 'USD' } });
  assert.equal(trader.getState().balances.real.amount, 100, 'a deposit shows at once');
  // A position opened in the traderoom (not by the extension) moves the balance.
  client.balancesList[0].amount = 9990;
  client.emit('position-changed', { id: 'p1', external_id: 5, active_id: 76, status: 'open', instrument_type: 'turbo-option', raw_event: {} });
  await until(() => trader.getState().balances.practice.amount === 9990);
  // A change in an unknown format: everything is read again.
  client.balancesList[1].amount = 150;
  client.emit('balance-changed', { something: 'else' });
  await until(() => trader.getState().balances.real.amount === 150);
});

test('a Blitz trade on 30-second candles expires 30 s after it is bought', async () => {
  const { client, trader } = await setup({}, { selection: { activeId: 76, activeType: 'blitz-option', candleSize: 30 } });
  assert.equal(trader.target.reason, '');
  assert.equal(trader.size, 30);
  assert.equal(trader.candleStart(SIGNALS[0].from + 44), SIGNALS[0].from + 30);
  assert.match(trader.getState().targetLabel, /EUR\/USD \(OTC\) Blitz, 30 s candles, expiry 30 s, payout 95%/);
  void client;
});

const DIGITAL = { activeId: 76, activeType: 'digital-option', candleSize: 60 };
const PRICES = 'trading-settings.digital-option-client-price-generated';
const INSTRUMENTS = 'digital-option-instruments.instrument-generated';

function setupDigital(settings, clientOptions) {
  return setup(settings, Object.assign({ selection: DIGITAL, instruments: digitalInstruments(76, SIGNALS[0].from + 60) }, clientOptions));
}

test('Digital: buys the at-the-money option that expires at the end of the candle, at the streamed payout', async () => {
  const { client, trader, first } = await setupDigital();
  const direction = first.decision > 0 ? 'call' : 'put';
  const inst = client.instruments[0];
  assert.equal(trader.target.reason, '');
  assert.match(trader.getState().targetLabel, /EUR\/USD \(OTC\) Digital, 1 min candles, expiry to the end of the candle, payout 83\.1%/);
  assert.equal(client.orders.length, 1);
  assert.deepEqual(client.orders[0], {
    id: client.orders[0].id, kind: 'digital', balanceId: 111, activeId: 76,
    instrumentId: inst.data.find((x) => x.strike === 'SPT' && x.direction === direction).symbol,
    instrumentIndex: inst.index, amount: 1,
  });
  const trade = trader.trades[0];
  assert.deepEqual([trade.kind, trade.exp, trade.payout], ['digital', first.from + 60, direction === 'call' ? 83.2 : 83.1]);
  assert.ok(client.subs.some((s) => s.name === INSTRUMENTS && s.filters.asset_id === 76 && s.version === '3.0'));
  for (const i of client.instruments) {
    assert.ok(client.subs.some((s) => s.name === PRICES && s.filters.instrument_index === i.index && s.version === '1.0'), String(i.index));
  }
  assert.ok(client.subs.some((s) => s.name === 'portfolio.position-changed' && s.filters.instrument_type === 'digital-option'));
});

test('Digital: settles from the position events with the P/L of IQ Option', async () => {
  const { client, trader } = await setupDigital();
  const order = client.orders[0];
  const position = (status, extra) => client.emit('position-changed', Object.assign({
    instrument_type: 'digital-option', external_id: 777, status,
    raw_event: { digital_options_position_changed1: { order_ids: [order.id] } },
  }, extra));
  position('open', { open_quote: 1.102745 });
  assert.equal(trader.trades[0].entry, 1.102745);
  assert.equal(trader.trades[0].result, null);
  client.balancesList[0].amount = 10000.83;
  position('closed', { pnl: 0.83, pnl_realized: 0.83, close_quote: 1.1029 });
  const trade = trader.trades[0];
  assert.deepEqual([trade.result, trade.pnl, trade.exit], ['win', 0.83, 1.1029]);
  assert.deepEqual([trader.session.wins, trader.session.pnl], [1, 0.83]);
  await until(() => trader.getState().balances.practice.amount === 10000.83);
  // A losing trade: matched by the position id once the position is known.
  const other = await setupDigital();
  const lost = other.client.orders[0];
  other.client.emit('position-changed', { instrument_type: 'digital-option', external_id: 888, status: 'open',
    raw_event: { digital_options_position_changed1: { order_ids: [lost.id] } } });
  other.client.emit('position-changed', { instrument_type: 'digital-option', external_id: 888, status: 'closed', pnl: -1, close_quote: 1.1,
    raw_event: { digital_options_position_changed1: {} } });
  assert.deepEqual([other.trader.trades[0].result, other.trader.trades[0].pnl, other.trader.session.losses], ['loss', -1, 1]);
});

test('Digital: no trade without an option for the candle, a known payout, an open market or enough payout', async () => {
  const none = await setupDigital({}, { instruments: [] });
  assert.equal(none.client.orders.length, 0);
  assert.match(none.trader.lastSignal.note, /no Digital option expiring at/);
  const unknown = await setupDigital({}, { digitalAsks: null });
  assert.equal(unknown.client.orders.length, 0);
  assert.match(unknown.trader.lastSignal.note, /payout not known yet/);
  assert.match(unknown.trader.getState().targetLabel, /Digital, 1 min candles, expiry to the end of the candle$/);
  const low = await setupDigital({}, { digitalAsks: { call: 60, put: 60 } });
  assert.equal(low.client.orders.length, 0);
  assert.match(low.trader.lastSignal.note, /payout 66\.7% below 80%/);
  const closed = await setupDigital({}, { digitalAssets: { 76: { name: 'EUR/USD (OTC)', enabled: false, suspended: false, payout: NaN, expirations: [60] } } });
  assert.equal(closed.client.orders.length, 0);
  assert.match(closed.trader.lastSignal.note, /asset closed for trading/);
});

test('Digital: tracks new options, drops expired ones and stops the streams when the selection changes', async () => {
  const { client, trader, first } = await setupDigital();
  const [a, b] = client.instruments;
  const next = digitalInstruments(76, first.from + 180, 1, 60, 6000)[0];
  client.time = a.expiration + 1;
  client.emit('instrument-generated', next);
  assert.ok(client.subs.some((s) => s.name === PRICES && s.filters.instrument_index === next.index));
  assert.ok(client.unsubs.some((s) => s.name === PRICES && s.filters.instrument_index === a.index), 'expired option dropped');
  assert.equal(trader.digitalInstrument(a.expiration), null);
  // Options of another period or asset are ignored.
  client.emit('instrument-generated', digitalInstruments(76, first.from + 300, 1, 300, 7000)[0]);
  client.emit('instrument-generated', digitalInstruments(1916, first.from + 180, 1, 60, 8000)[0]);
  assert.equal(trader.digital.instruments.size, 2);
  // The user switches the same asset to Binary: the Digital streams stop, the candles do not.
  client.selection = { activeId: 76, activeType: 'turbo-option', candleSize: 60 };
  await trader.checkLayout(false);
  assert.equal(trader.digital, null);
  assert.ok(client.unsubs.some((s) => s.name === INSTRUMENTS && s.filters.asset_id === 76));
  for (const index of [b.index, next.index]) assert.ok(client.unsubs.some((s) => s.name === PRICES && s.filters.instrument_index === index), String(index));
  assert.ok(!client.unsubs.some((s) => s.name === 'candle-generated'), 'same candles: still subscribed');
});

test('Digital: waits a little for the first payout of the price stream instead of skipping the candle', async () => {
  const first = SIGNALS[0];
  const client = new FakeIqClient(CANDLES, { time: first.from + 2, selection: DIGITAL, instruments: digitalInstruments(76, first.from + 60), digitalAsks: null });
  const trader = new AutoTrader({ client, settings: { enabled: true, requireEdge: false }, setTimer: (fn, ms) => setTimeout(fn, Math.min(ms, 20)) });
  // The first prices arrive 60 ms after the subscription, while the candle's decision is waiting.
  setTimeout(() => {
    for (const inst of client.instruments) {
      client.emit('digital-option-client-price-generated', { instrument_index: inst.index, asset_id: 76,
        prices: [{ strike: 'SPT', call: { ask: 54.591917 }, put: { ask: 54.608083 } }] });
    }
  }, 60);
  await trader.start();
  assert.equal(client.orders.length, 1, trader.lastSignal && trader.lastSignal.note);
  assert.equal(client.orders[0].kind, 'digital');
});

test('keeps the open positions of the account, from any source, and announces when one closes', async () => {
  const { client, trader } = await setup({ maxTrades: 1000 });
  const closed = [];
  trader.on('position-closed', (id) => closed.push(id));
  const manual = (status, extra) => client.emit('position-changed', Object.assign({ id: 'abc', external_id: 1, active_id: 76, status,
    instrument_type: 'digital-option', raw_event: { digital_options_position_changed1: { instrument_expiration: (client.time + 60) * 1000 } } }, extra));
  assert.equal(trader.hasOpenPosition(76), false);
  manual('open');
  assert.equal(trader.hasOpenPosition(76), true, 'a position opened in the traderoom counts');
  assert.equal(trader.hasOpenPosition(1974), false, 'other assets do not');
  manual('closed', { pnl: -1 });
  assert.equal(trader.hasOpenPosition(76), false);
  assert.deepEqual(closed, [76]);
  // A close that was missed (disconnection) does not block for ever.
  manual('open');
  client.time += 60 + 31;
  assert.equal(trader.hasOpenPosition(76), false);
});

test('Digital option names and payouts are read like the traderoom does', () => {
  assert.equal(digitalSymbol(76, 1793579460, 60, 'call'), 'do76A20261102D003100T1MCSPT');
  assert.equal(digitalSymbol(1916, 1793579400, 300, 'put'), 'do1916A20261102D003000T5MPSPT');
  assert.deepEqual(digitalPayouts({ prices: [{ strike: '1.1', call: { ask: 70 } }, { strike: 'SPT', call: { ask: 54.591917 }, put: { ask: 54.608083 } }] }),
    { call: 83.2, put: 83.1 });
  assert.equal(digitalPayouts({ prices: [] }), null);
});
test('by default every arrow is bought, also where the logic has no edge', async () => {
  const later = SIGNALS.find((s) => s.t > 600);
  const client = new FakeIqClient(CANDLES, { time: later.from + 2 });
  const trader = new AutoTrader({ client, settings: { enabled: true }, setTimer: immediateTimer });
  await trader.start();
  assert.equal(trader.settings.requireEdge, false);
  assert.ok(trader.edge && trader.edge.n > 20 && !(trader.edge.lo >= trader.breakEven()), 'no edge here: ' + JSON.stringify(trader.edge));
  assert.equal(client.orders.length, 1);
  assert.equal(client.orders[0].direction, later.decision > 0 ? 'call' : 'put');
  assert.equal(trader.lastSignal.note, 'traded');
});

test('measures the method on the followed asset and, with "only trade where it has an edge", does not trade without one', async () => {
  const later = SIGNALS.find((s) => s.t > 600);
  const client = new FakeIqClient(CANDLES, { time: later.from + 2 });
  const trader = new AutoTrader({ client, settings: { enabled: true, requireEdge: true }, setTimer: immediateTimer });
  await trader.start();
  const e = trader.edge;
  assert.ok(e && e.n > 20, 'arrows measured: ' + (e && e.n));
  assert.equal(e.candles, later.t, 'every closed candle before the trade is replayed');
  assert.ok(e.rate > 0.3 && e.rate < 0.7);
  assert.ok(Math.abs(trader.getState().edge.breakEven - 100 / 188) < 1e-12);
  assert.equal(client.orders.length, 0);
  assert.match(trader.lastSignal.note, /no proven edge here: .* break-even 53\.2%/);
  assert.match(trader.getState().log.join('\n'), /candles of EUR\/USD \(OTC\): \d+ arrows/);
});

test('trades when the recent arrows clearly beat break-even', async () => {
  const candles = trendCandles(3000, 40);
  const engine = createEngine();
  let at = null;
  candles.forEach((c, k) => {
    const d = engine.update({ open: c.open, high: c.max, low: c.min, close: c.close }).decision;
    if (!at && k > 2500 && d !== 0) at = candles[k + 1].from;
  });
  const client = new FakeIqClient(candles, { time: at + 2 });
  const trader = new AutoTrader({ client, settings: { enabled: true, requireEdge: true }, setTimer: immediateTimer });
  await trader.start();
  assert.ok(trader.edge.lo > trader.breakEven(), JSON.stringify(trader.getState().edge));
  assert.equal(client.orders.length, 1);
});

test('"Buy: CALL only" or "PUT only" buys the arrows of that direction and leaves the others out', async () => {
  const call = SIGNALS.find((s) => s.decision > 0);
  const put = SIGNALS.find((s) => s.decision < 0);
  for (const [directions, sig, bought] of [['call', call, true], ['call', put, false], ['put', put, true], ['put', call, false], ['both', put, true]]) {
    const client = new FakeIqClient(CANDLES, { time: sig.from + 2 });
    const trader = new AutoTrader({ client, settings: { enabled: true, directions }, setTimer: immediateTimer });
    await trader.start();
    const label = directions + ' / ' + (sig.decision > 0 ? 'CALL' : 'PUT') + ' arrow';
    assert.equal(client.orders.length, bought ? 1 : 0, label);
    if (bought) {
      assert.equal(client.orders[0].direction, sig.decision > 0 ? 'call' : 'put', label);
      assert.equal(trader.lastSignal.filtered, undefined, label);
    } else {
      assert.equal(trader.lastSignal.note, 'not traded: only ' + directions.toUpperCase() + ' arrows are bought', label);
      assert.equal(trader.lastSignal.filtered, directions, label);
    }
  }
  assert.equal(new AutoTrader({ client: new FakeIqClient(CANDLES), settings: { directions: 'sideways' } }).settings.directions, 'both');
});

test('the recent results are counted for the CALL and the PUT arrows apart', async () => {
  const later = SIGNALS.find((s) => s.t > 600);
  const client = new FakeIqClient(CANDLES, { time: later.from + 2 });
  const trader = new AutoTrader({ client, settings: { enabled: false }, setTimer: immediateTimer });
  await trader.start();
  const engine = createEngine();
  let cw = 0, cn = 0, pw = 0, pn = 0, previous = 0;
  for (const c of CANDLES.slice(0, later.t)) {
    const move = Math.sign(c.close - c.open);
    if (previous > 0 && move !== 0) { cn += 1; if (move > 0) cw += 1; }
    if (previous < 0 && move !== 0) { pn += 1; if (move < 0) pw += 1; }
    previous = engine.update({ open: c.open, high: c.max, low: c.min, close: c.close }).decision;
  }
  const e = trader.edge;
  assert.ok(cn > 10 && pn > 10, JSON.stringify([cn, pn]));
  assert.deepEqual([e.call.wins, e.call.n, e.put.wins, e.put.n], [cw, cn, pw, pn]);
  assert.deepEqual([e.call.n + e.put.n, e.call.wins + e.put.wins], [e.n, e.wins]);
  assert.match(trader.getState().log.join('\n'), /% won \(CALL [\d.]+% of \d+, PUT [\d.]+% of \d+\)/);
});

test('with "only trade where it has an edge", the bought direction is judged on its own results', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  const sig = SIGNALS[1];
  client.time = sig.from + 2;
  const r = (w, n) => ({ wins: w, n, rate: w / n, lo: w / n - 0.07, hi: w / n + 0.07 });
  trader.edge = Object.assign(r(50, 100), { candles: 5000, call: r(90, 100), put: r(10, 100) });
  trader.setSettings({ requireEdge: true, directions: 'call' });
  assert.equal(trader.skipReason(sig.from, undefined, 'call'), '');
  assert.equal(trader.skipReason(sig.from, undefined, 'put'), 'only CALL arrows are bought');
  trader.setSettings({ directions: 'put' });
  assert.match(trader.skipReason(sig.from, undefined, 'put'), /^no proven edge here: 10\.0% of 100 recent PUT arrows won, break-even 53\.2%$/);
  trader.setSettings({ directions: 'both' });
  assert.match(trader.skipReason(sig.from, undefined, 'call'), /^no proven edge here: 50\.0% of 100 recent arrows won/);
  trader.edge = Object.assign(r(50, 100), { candles: 5000, call: null, put: null }); // learned before the split existed
  trader.setSettings({ directions: 'call' });
  assert.equal(trader.skipReason(sig.from, undefined, 'call'), 'the CALL arrows are measured apart at the next learning');
  assert.match(trader.getState().log.join('\n'), /Buying CALL arrows only\.[\s\S]*Buying CALL and PUT arrows\.[\s\S]*Buying PUT arrows only\./);
});

test('the session counts the results of CALL and PUT trades apart', async () => {
  const { client, trader } = await setup({ maxTrades: 1000, maxLossStreak: 1000, maxSessionLoss: 0 });
  for (const sig of SIGNALS.slice(1, 10)) await runSignal(client, trader, sig);
  for (const order of client.orders) settle(client, order, order.direction === 'call' ? 'win' : 'loose');
  const calls = client.orders.filter((o) => o.direction === 'call').length;
  const puts = client.orders.length - calls;
  assert.ok(calls > 0 && puts > 0, JSON.stringify([calls, puts]));
  assert.deepEqual(trader.session.sides, { call: { wins: calls, losses: 0, ties: 0 }, put: { wins: 0, losses: puts, ties: 0 } });
  assert.deepEqual([trader.session.wins, trader.session.losses], [calls, puts]);
  // A session saved by an older version (without the split) is counted per direction from the next session.
  const old = new AutoTrader({ client: new FakeIqClient(CANDLES), session: { trades: 3, wins: 2, losses: 1, ties: 0, pnl: 0.7, lossStreak: 1, lastTradeFrom: 5 } });
  assert.equal(old.session.sides, null);
  old.setSettings({ enabled: true });
  assert.deepEqual(old.session.sides, { call: { wins: 0, losses: 0, ties: 0 }, put: { wins: 0, losses: 0, ties: 0 } });
  const empty = new AutoTrader({ client: new FakeIqClient(CANDLES), session: { trades: 0, wins: 0, losses: 0, ties: 0, pnl: 0, lossStreak: 0 } });
  assert.ok(empty.session.sides, 'nothing to miss: counted at once');
});

test('the method can be switched to the 15-strategy vote', async () => {
  const { trader } = await setup();
  trader.setSettings({ rules: { method: 'vote' } });
  assert.equal(trader.settings.rules.method, 'vote');
  assert.equal(trader.engine, null);
});
// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { learn, breakoutArrows, outcomes, score, stats, versions, describe, CURRENT } = require('../src/learner.js');
const { createEngine } = require('../src/signal-engine.js');
const { realCandles, trendCandles } = require('./fakes.js');

const toEngine = (rows) => rows.map((c) => ({ from: c.from, open: c.open, high: c.max, low: c.min, close: c.close }));
const REAL = toEngine(realCandles());

// A random walk: no version can predict it.
function randomCandles(n, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  let price = 1.1;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = +(open + (rnd() - 0.5) * 0.0004).toFixed(6);
    const high = +(Math.max(open, close) + rnd() * 0.0001).toFixed(6);
    const low = +(Math.min(open, close) - rnd() * 0.0001).toFixed(6);
    out.push({ from: 1793000040 + 60 * i, open, high, low, close });
    price = close;
  }
  return out;
}

test('the learner gives the same arrows as the signal engine, for every adjusted version', () => {
  const all = versions();
  assert.equal(all.length, 432);
  assert.ok(all.some((r) => r.brkCandles === 1 && r.brkZone === 50), 'the 1-candle, upper / lower half version is tried');
  const picks = all.filter((_, k) => k % 7 === 0).concat([CURRENT, { method: 'breakout', brkCandles: 1, brkZone: 50, brkBody: 0, reverse: true }]);
  for (const rules of picks) {
    for (const candles of [REAL, randomCandles(600, 7)]) {
      const engine = createEngine(rules);
      const expected = candles.map((c) => engine.update(c).decision);
      assert.deepEqual(Array.from(breakoutArrows(candles, rules)), expected, JSON.stringify(rules));
    }
  }
});

test('counts wins on the next candle only, without ties or gaps', () => {
  const candles = [
    { from: 0, open: 1, high: 2, low: 1, close: 2 },
    { from: 60, open: 2, high: 3, low: 2, close: 3 }, // up
    { from: 120, open: 3, high: 3, low: 3, close: 3 }, // tie
    { from: 300, open: 3, high: 4, low: 2, close: 2 }, // after a gap
  ];
  const y = outcomes(candles, 60);
  assert.deepEqual(Array.from(y).map((v) => (Number.isNaN(v) ? 'gap' : v)), [1, 0, 'gap', 'gap']);
  assert.deepEqual(score(Int8Array.from([1, 1, 1, 1]), y, 0, 4), { w: 1, n: 1, cw: 1, cn: 1, f: 2, m: 2 });
  assert.deepEqual(score(Int8Array.from([-1, 0, 0, 0]), y, 0, 4), { w: 0, n: 1, cw: 0, cn: 0, f: 1, m: 2 });
  assert.equal(stats(score(Int8Array.from([1, 1, 1, 1]), y, 0, 4)).coverage, 1, 'the tie counts as an arrow given');
  assert.equal(stats(score(Int8Array.from([0, 1, 0, 0]), y, 0, 4)).coverage, 0.5);
});

test('counts the CALL and the PUT arrows apart, everywhere the logic is measured', async () => {
  const rules = { method: 'breakout', brkCandles: 5, brkZone: 10, brkBody: 0, reverse: false };
  const arrows = breakoutArrows(REAL, rules);
  const y = outcomes(REAL, 60);
  let cw = 0, cn = 0, pw = 0, pn = 0;
  for (let i = 0; i < REAL.length; i++) {
    if (!arrows[i] || !(y[i] === 1 || y[i] === -1)) continue;
    if (arrows[i] === 1) { cn += 1; if (y[i] === 1) cw += 1; } else { pn += 1; if (y[i] === -1) pw += 1; }
  }
  assert.ok(cn > 20 && pn > 20, JSON.stringify([cn, pn]));
  const st = stats(score(arrows, y, 0, REAL.length));
  assert.deepEqual([st.call.wins, st.call.n, st.put.wins, st.put.n], [cw, cn, pw, pn]);
  assert.ok(Math.abs(st.call.rate - cw / cn) < 1e-12 && Math.abs(st.put.rate - pw / pn) < 1e-12);
  assert.ok(st.call.lo < st.call.rate && st.call.hi > st.call.rate);
  const r = await learn(REAL, { size: 60 });
  for (const part of [r.learn, r.choose, r.check, r.current.check]) {
    assert.equal(part.call.n + part.put.n, part.n);
    assert.equal(part.call.wins + part.put.wins, part.wins);
  }
});

test('reaches the target where the market really repeats itself, and checks it on unseen candles', async () => {
  const candles = toEngine(trendCandles(6000, 40));
  const r = await learn(candles, { size: 60, target: 0.9 });
  assert.equal(r.reached, true);
  assert.equal(r.rules.reverse, false);
  assert.ok(r.check.rate >= 0.9 && r.check.n >= 30, JSON.stringify(r.check));
  assert.deepEqual(r.parts, { learn: 3600, choose: 1200, check: 1200 });
});

test('learns to reverse the arrows where the market turns every candle', async () => {
  const candles = toEngine(trendCandles(3000, 1));
  const r = await learn(candles, { size: 60, target: 0.9 });
  assert.equal(r.rules.reverse, true, describe(r.rules));
  assert.ok(r.current.check.rate < 0.1, 'the current logic loses there');
  assert.ok(r.check.rate > 0.9);
});

test('does not claim the target on random prices: the check stays near a coin flip', async () => {
  const r = await learn(randomCandles(20000, 11), { size: 60, target: 0.9 });
  assert.equal(r.reached, false);
  assert.ok(r.tried > 100);
  assert.ok(r.check.n >= 100, 'enough arrows to judge: ' + r.check.n);
  assert.ok(r.check.lo < 0.5 && r.check.hi > 0.45, JSON.stringify(r.check));
  // The best version on the learning candles looks better than it is.
  assert.ok(r.bestLearn.learn.rate >= r.check.rate, JSON.stringify(r.bestLearn));
});

test('describes rules in words', () => {
  assert.equal(describe(CURRENT), 'breakout 5 candles, close at the high / low');
  assert.equal(describe({ method: 'breakout', brkCandles: 8, brkZone: 10, brkBody: 30, reverse: true }),
    'breakout 8 candles, close within 10%, body at least 30%, reversed (fade)');
  assert.equal(describe({ method: 'breakout', brkCandles: 1, brkZone: 50, brkBody: 0, reverse: true }),
    'breakout 1 candle, close in the upper / lower half, reversed (fade)');
});

test('chooses the logic once for each frequency: more arrows, among versions that give them that often', async () => {
  const { FREQUENCIES } = require('../src/learner.js');
  const r = await learn(REAL, { size: 60 });
  assert.deepEqual(Object.keys(r.levels), FREQUENCIES.map(String));
  assert.deepEqual(r.rules, r.levels['0'].rules, 'the top level is the best win rate (no minimum)');
  let previous = -1;
  for (const f of FREQUENCIES) {
    const lv = r.levels[String(f)];
    assert.ok(lv, 'a logic for ' + f);
    assert.ok(lv.learn.coverage >= f, f + ': ' + lv.learn.coverage);
    assert.ok(lv.choose.coverage >= 0.8 * f, f + ': ' + lv.choose.coverage);
    assert.ok(lv.check.coverage > previous - 0.05, 'more frequent: ' + previous + ' -> ' + lv.check.coverage);
    previous = lv.check.coverage;
    assert.equal(lv.check.call.n + lv.check.put.n, lv.check.n);
  }
  assert.ok(r.levels['0.9'].check.coverage > 0.85, 'almost every candle: ' + r.levels['0.9'].check.coverage);
  // A frequency that no version reaches has no logic.
  const rare = await learn(REAL, { size: 60, frequencies: [0, 1.01] });
  assert.equal(rare.levels['1.01'], null);
});

// ---- learning queue and its use by the trader ------------------------------------------------
const { AutoTrader } = require('../src/trader.js');
const { FakeIqClient } = require('./fakes.js');
const { createLearningQueue } = require('../src/learner.js');

async function learningSetup(candles, settings, time, clientOptions) {
  const last = candles[candles.length - 1];
  const client = new FakeIqClient(candles, Object.assign({ time: time || last.from + 60 + 30 }, clientOptions));
  const trader = new AutoTrader({ client, settings: Object.assign({ enabled: false, learnCandles: 4000 }, settings),
    setTimer: (fn) => setImmediate(fn) });
  await trader.start();
  const queue = createLearningQueue({ client, trader, gapMs: 0, sleep: async () => {} });
  return { client, trader, queue };
}

test('learns the selected asset first, applies its logic, then learns the other open assets one by one', async () => {
  const candles = trendCandles(5000, 1); // turns every candle: the reversed breakout wins
  const { client, trader, queue } = await learningSetup(candles);
  assert.equal(trader.rules().reverse, false, 'the panel rules before learning');
  assert.equal(await queue.step(), true);
  const mine = trader.learned['76/60'];
  assert.ok(mine && mine.rules.reverse === true, JSON.stringify(mine && mine.rules));
  assert.equal(mine.candles, 4000);
  assert.equal(mine.name, 'EUR/USD (OTC)');
  assert.equal(trader.rules().reverse, true, 'the learned logic is applied to the selected asset');
  assert.equal(trader.edge.learned, true, 'judged on its check candles');
  assert.equal(trader.edge.n, mine.check.n);
  // Next: the other open assets.
  assert.equal(await queue.step(), true);
  assert.ok(trader.learned['1974/60'], 'CARDANO learned in the background');
  assert.equal(await queue.step(), false, 'everything is fresh');
  assert.match(trader.getState().learning.note, /every open asset is learned/);
  assert.deepEqual(trader.getState().best.map((b) => b.name).sort(), ['CARDANO (OTC)', 'EUR/USD (OTC)']);
  // On request the selected asset is learned again.
  const before = mine.learnedAt;
  client.time += 5;
  queue.learnNow();
  assert.equal(await queue.step(), true);
  assert.ok(trader.learned['76/60'].learnedAt > before);
});

test('without "learn all" only the selected asset is learned; switched off, the panel rules apply', async () => {
  const { trader, queue } = await learningSetup(trendCandles(5000, 1), { learnAll: false });
  assert.equal(await queue.step(), true);
  assert.equal(await queue.step(), false);
  assert.equal(trader.learned['1974/60'], undefined);
  trader.setSettings({ useLearned: false });
  assert.equal(trader.rules().reverse, false);
  assert.equal(trader.getState().learnedHere, null);
});

test('the trader decides with the learned logic of the selected asset', async () => {
  const candles = trendCandles(5000, 1);
  // Clock inside the data: candles 0-4499 are closed, 4500 is forming.
  const { client, trader, queue } = await learningSetup(candles, { enabled: true, requireEdge: false }, candles[4500].from + 30);
  await queue.step();
  const rules = trader.rules();
  assert.equal(rules.reverse, true, 'the learned logic, not the panel rules');
  // The next candle (4501) opens: the trader decides it from candles 0-4500 with the learned logic.
  const engine = createEngine(rules);
  let expected = 0;
  for (const c of toEngine(candles.slice(0, 4501))) expected = engine.update(c).decision;
  const next = candles[4501].from;
  client.time = next + 1;
  await trader.cycle(next);
  assert.equal(trader.lastSignal.from, next);
  assert.equal(trader.lastSignal.decision, expected);
  assert.notEqual(expected, 0);
});

// One 5-second candle per minute (the first one): its close is the price 5 s after the open.
function fiveSecond(candles, movesEarly) {
  return candles.map((c) => ({ from: c.from, open: c.open, max: c.max, min: c.min, close: movesEarly ? c.close : c.open }));
}

test('measures the arrows again with the price 5 s after the open', () => {
  const { lateScore } = require('../src/learner.js');
  const candles = [
    { from: 0, open: 1, high: 2, low: 1, close: 2 },
    { from: 60, open: 2, high: 3, low: 2, close: 3 },
    { from: 120, open: 3, high: 3, low: 1, close: 1 },
    { from: 180, open: 1, high: 2, low: 1, close: 1.5 },
  ];
  const prices = new Map([[60, 2.9], [180, 1.5]]); // 120: no 5-second candle
  assert.deepEqual(lateScore(candles, Int8Array.from([1, -1, 1, 0]), 0, 4, prices, 60), { w: 1, n: 1, cw: 1, cn: 1, total: 3, missing: 1 });
  // A PUT arrow that wins with the later price.
  assert.deepEqual(lateScore(candles, Int8Array.from([-1, 0, 0, 0]), 0, 4, new Map([[60, 3.1]]), 60), { w: 1, n: 1, cw: 0, cn: 0, total: 1, missing: 0 });
});

test('a selected asset learned before the logic was chosen per frequency (and CALL / PUT split) is learned again', async () => {
  const { client, trader, queue } = await learningSetup(trendCandles(5000, 1), { learnAll: false });
  assert.equal(await queue.step(), true);
  assert.ok(trader.edge.call && trader.edge.put);
  assert.equal(await queue.step(), false, 'fresh');
  const old = JSON.parse(JSON.stringify(trader.learned['76/60'])); // as saved by version 1.3.0
  delete old.levels;
  delete old.check.call;
  delete old.check.put;
  trader.setLearned('76/60', old);
  assert.deepEqual([trader.edge.call, trader.edge.put], [null, null]);
  assert.equal(trader.rules().brkCandles, old.rules.brkCandles, 'its one logic is used meanwhile');
  client.time += 5;
  assert.equal(await queue.step(), true, 'learned again');
  assert.ok(trader.learned['76/60'].check.call && trader.learned['76/60'].levels);
  assert.equal(trader.edge.call.n + trader.edge.put.n, trader.edge.n);
});

test('with "only trade where it has an edge", a learned logic whose wins come in the first seconds is not traded', async () => {
  const candles = trendCandles(5000, 1);
  const { client, trader, queue } = await learningSetup(candles, { enabled: true, requireEdge: true }, candles[4500].from + 30,
    { series: { 5: fiveSecond(candles, true) } });
  await queue.step();
  const mine = trader.learned['76/60'];
  assert.ok(mine.check.rate > 0.9, 'from the open it looks perfect');
  assert.equal(mine.late.n, 0, 'with the price 5 s later every arrow is a tie');
  assert.ok(mine.lateCoverage > 0.9);
  assert.equal(trader.edge.unconfirmed, true);
  const next = candles[4501].from;
  client.time = next + 1;
  await trader.cycle(next);
  assert.notEqual(trader.lastSignal.decision, 0);
  assert.equal(client.orders.length, 0);
  assert.match(trader.lastSignal.note, /realistic entry/);
});

test('with "only trade where it has an edge", a learned logic that holds with the price 5 s after the open is traded', async () => {
  const candles = trendCandles(5000, 1);
  const { client, trader, queue } = await learningSetup(candles, { enabled: true, requireEdge: true }, candles[4500].from + 30,
    { series: { 5: fiveSecond(candles, false) } });
  await queue.step();
  const mine = trader.learned['76/60'];
  assert.ok(mine.late.n >= 30 && mine.late.rate > 0.9, JSON.stringify(mine.late));
  assert.equal(trader.edge.late, true);
  assert.equal(trader.edge.unconfirmed, false);
  assert.equal(trader.getState().best[0].late, true);
  const next = candles[4501].from;
  client.time = next + 1;
  await trader.cycle(next);
  assert.equal(client.orders.length, 1, trader.lastSignal.note);
});
test('"Learn now" interrupts a background asset and learns the selected one at once', async () => {
  const candles = trendCandles(5000, 1);
  const { client, trader, queue } = await learningSetup(candles);
  await queue.step(); // the selected asset first; next comes a background asset
  const original = client.candles.bind(client);
  let calls = 0;
  client.candles = async (...args) => {
    if (args[0] === 1974 && ++calls === 2) queue.learnNow(); // pressed while CARDANO downloads
    return original(...args);
  };
  assert.equal(await queue.step(), true);
  assert.equal(trader.learned['1974/60'], undefined, 'the background asset is left for later');
  assert.equal(trader.getState().learning.forced, true);
  const before = trader.learned['76/60'].learnedAt;
  client.time += 5;
  assert.equal(await queue.step(), true);
  assert.ok(trader.learned['76/60'].learnedAt > before, 'the selected asset was learned again');
  assert.equal(trader.getState().learning.forced, false);
  assert.equal(await queue.step(), true);
  assert.ok(trader.learned['1974/60'], 'then the background asset');
});
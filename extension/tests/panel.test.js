// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { whyText, tradedEdge, tone, sessionSides, frequencyOptions, perHour, rulesText } = require('../src/panel.js');

const target = (extra) => Object.assign({ activeId: 2159, kind: 'blitz', name: '1000Sats (OTC)', enabled: true, suspended: false, reason: '' }, extra);
const state = (extra) => Object.assign({
  status: 'ready', statusText: 'Connected', target: target(),
  settings: { enabled: true, requireEdge: true },
  edge: { rate: 0.496, lo: 0.485, n: 7951, breakEven: 100 / 185 },
  lastSignal: null, nextCandleIn: 30,
}, extra);
const off = { enabled: false, requireEdge: true };

test('the reason line says why it does not trade here, and whether it would while auto-trade is off', () => {
  assert.deepEqual(whyText(state()), ['warn', 'Not traded: no edge here (49.6% won, break-even 54.1%).']);
  assert.deepEqual(whyText(state({ settings: off })), ['muted', 'Auto-trade is off. It would not trade here: no edge here (49.6% won, break-even 54.1%).']);
  const forex = target({ kind: null, reason: 'Margin forex is not supported: choose Binary, Blitz or Digital' });
  assert.deepEqual(whyText(state({ target: forex })), ['warn', 'Not traded: Margin forex is not supported: choose Binary, Blitz or Digital.']);
  assert.deepEqual(whyText(state({ target: forex, settings: off }))[0], 'warn', 'an unsupported selection is a warning either way');
  assert.deepEqual(whyText(state({ target: target({ enabled: false }) })), ['warn', 'Not traded: 1000Sats (OTC) is closed for trading now.']);
  const edge = { rate: 0.6, lo: 0.56, n: 900, breakEven: 100 / 185 };
  assert.deepEqual(whyText(state({ edge })), ['ok', 'Trading every arrow at once.']);
  assert.deepEqual(whyText(state({ edge, settings: off })), ['muted', 'Auto-trade is off. Switch it on to buy every arrow at once.']);
  assert.deepEqual(whyText(state({ edge: { rate: 0.56, lo: 0.52, n: 300, breakEven: 100 / 185 } }))[1], 'Not traded: not enough proof yet (56.0% won, break-even 54.1%).');
  assert.deepEqual(whyText(state({ status: 'connecting', statusText: 'Connecting to IQ Option...' })), ['warn', 'Connecting to IQ Option...']);
});

test('by default it trades every arrow, and says so when the logic is below break-even here', () => {
  const every = { enabled: true, requireEdge: false };
  assert.deepEqual(whyText(state({ settings: every })), ['warn', 'Trading every arrow at once. Here it won 49.6%, below break-even (54.1%).']);
  assert.deepEqual(whyText(state({ settings: every, edge: { rate: 0.58, lo: 0.52, n: 300, breakEven: 100 / 185 } })), ['ok', 'Trading every arrow at once.']);
  assert.deepEqual(whyText(state({ settings: every, edge: null })), ['ok', 'Trading every arrow at once.'], 'not measured yet: no number to show');
  assert.deepEqual(whyText(state({ settings: { enabled: false, requireEdge: false } })), ['muted', 'Auto-trade is off. Switch it on to buy every arrow at once.']);
  const late = { from: 1793592240, decision: -1, traded: false, note: 'not traded: too late (12 s after the open)' };
  assert.deepEqual(whyText(state({ settings: every, lastSignal: late })), ['warn', 'Last arrow not traded: too late (12 s after the open).']);
});

const r = (w, n) => ({ wins: w, n, rate: w / n, lo: w / n - 0.06, hi: w / n + 0.06 });
const SPLIT = Object.assign(r(496, 1000), { breakEven: 100 / 185, call: r(255, 500), put: r(241, 500) });

test('with "Buy: CALL only" or "PUT only" the reason line speaks of those arrows and their win rate', () => {
  const callOnly = { enabled: true, requireEdge: false, directions: 'call' };
  assert.deepEqual(whyText(state({ settings: callOnly, edge: SPLIT })), ['warn', 'Trading CALL arrows only, at once. Here they won 51.0%, below break-even (54.1%).']);
  const strongPut = Object.assign({}, SPLIT, { put: r(300, 500) });
  assert.deepEqual(whyText(state({ settings: { enabled: true, requireEdge: false, directions: 'put' }, edge: strongPut })), ['ok', 'Trading PUT arrows only, at once.']);
  assert.deepEqual(whyText(state({ settings: { enabled: false, directions: 'put' }, edge: strongPut })), ['muted', 'Auto-trade is off. Switch it on to buy PUT arrows at once.']);
  // A PUT arrow left out on purpose is not a problem to report.
  const skipped = { from: 1793592240, decision: -1, traded: false, note: 'not traded: only CALL arrows are bought', filtered: 'call' };
  assert.deepEqual(whyText(state({ settings: callOnly, edge: SPLIT, lastSignal: skipped }))[0], 'warn', 'below break-even still warns');
  assert.match(whyText(state({ settings: callOnly, edge: SPLIT, lastSignal: skipped }))[1], /^Trading CALL arrows only/);
  // "Only trade where it has an edge": judged on the bought direction.
  assert.deepEqual(whyText(state({ settings: { enabled: true, requireEdge: true, directions: 'put' }, edge: SPLIT })),
    ['warn', 'Not traded: no edge for PUT arrows here (48.2% won, break-even 54.1%).']);
  const unsplit = Object.assign({}, SPLIT, { call: null, put: null });
  assert.deepEqual(whyText(state({ settings: { enabled: true, requireEdge: true, directions: 'call' }, edge: unsplit })),
    ['warn', 'Not traded: the CALL arrows are measured apart at the next learning.']);
});

test('win rate colours, the bought direction\'s results, and the session per direction', () => {
  const be = 100 / 185;
  assert.equal(tone(r(620, 1000), be), 'good', 'proven above break-even');
  assert.equal(tone(r(560, 1000), be), '', 'above break-even, not proven');
  assert.equal(tone(r(500, 1000), be), 'bad');
  assert.equal(tone(r(620, 1000), be, true), '', 'unconfirmed learned logic: not green');
  assert.equal(tone(null, be), '');
  assert.equal(tradedEdge({ edge: SPLIT, settings: { directions: 'both' } }), SPLIT);
  assert.deepEqual(tradedEdge({ edge: SPLIT, settings: { directions: 'put' } }), Object.assign({}, SPLIT.put, { breakEven: be }));
  assert.equal(tradedEdge({ edge: Object.assign({}, SPLIT, { call: null }), settings: { directions: 'call' } }), null);
  const ses = { sides: { call: { wins: 3, losses: 1, ties: 0 }, put: { wins: 1, losses: 2, ties: 1 } } };
  assert.equal(sessionSides(ses), 'CALL 3W / 1L (75%) - PUT 1W / 2L / 1T (33%)');
  assert.equal(sessionSides({ sides: { call: { wins: 2, losses: 0, ties: 0 }, put: { wins: 0, losses: 0, ties: 0 } } }), 'CALL 2W / 0L (100%)');
  assert.equal(sessionSides({ sides: null }), '');
  assert.equal(sessionSides({}), '');
});

test('the "Arrows" choices show this asset\'s arrows an hour and win rate for each frequency', () => {
  const lv = (coverage, rate, late) => ({ check: { coverage, rate, n: 400 }, late: late ? { rate: late, n: 200 } : undefined });
  const learnedHere = { levels: { 0: lv(0.08, 0.545, 0.53), 0.1: lv(0.12, 0.54), 0.25: lv(0.3, 0.52), 0.5: null, 0.9: lv(0.97, 0.51) } };
  const st = { learnedHere, target: { candleSize: 60 }, frequencies: [0, 0.1, 0.25, 0.5, 0.9] };
  assert.deepEqual(frequencyOptions(st).map((o) => o.value + ' ' + o.text), [
    '0 Best win rate (fewest) - 4.8/h, 53.0%',
    '0.1 1 candle in 10 or more - 7.2/h, 54.0%',
    '0.25 1 candle in 4 or more - 18/h, 52.0%',
    '0.5 1 candle in 2 or more - not possible here',
    '0.9 Almost every candle - 58/h, 51.0%',
  ]);
  assert.deepEqual(frequencyOptions({ learnedHere: null, target: null }).map((o) => o.text)[2], '1 candle in 4 or more', 'nothing learned: the names only');
  assert.equal(perHour(0.25, 300), '3/h');
  assert.equal(perHour(0.5, 30), '60/h');
  assert.equal(rulesText({ method: 'breakout', brkCandles: 1, brkZone: 50, brkBody: 0, reverse: true }), 'Breakout 1 candle, close in the upper / lower half, reversed');
});

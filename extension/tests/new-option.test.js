// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findNewOption, createNewOptionPresser, COLUMN_FROM_RIGHT, CENTRE_FROM_RIGHT } = require('../src/new-option.js');

// Pixel column of the trade panel (108 px from the right edge), recorded in the traderoom
// (EUR/USD (OTC) Digital, window 1487 x 907) as "kind from-to".
const parse = (text) => text.split('|').map((s) => {
  const [kind, range] = s.trim().split(' ');
  const [from, to] = range.split('-').map(Number);
  return { kind, from, to };
});
const TOP = 'dark 0-13 | other 14-14 | dark 15-58 | other 59-59 | dark 60-73 | grey 74-74 | dark 75-93 | grey 94-102 | dark 103-114 | ' +
  'grey 115-116 | dark 117-120 | grey 121-122 | dark 123-151 | grey 152-160 | dark 161-172 | grey 173-175 | dark 176-181 | grey 182-183';
const NEW_OPTION = parse(TOP + ' | dark 184-205 | orange 206-305 | dark 306-643 | grey 644-653 | dark 654-869 | grey 870-870 | dark 871-906');
const HIGHER_LOWER = parse(TOP + ' | dark 184-321 | orange 322-431 | dark 432-439 | grey 440-549 | dark 550-643 | grey 644-653 | dark 654-906');

test('finds "+ NEW OPTION": an orange button with plain background under it', () => {
  assert.deepEqual(findNewOption(NEW_OPTION), { y: 256 });
});

test('never takes HIGHER for it: LOWER is right under HIGHER', () => {
  assert.equal(findNewOption(HIGHER_LOWER), null);
});

test('presses nothing on any other picture', () => {
  assert.equal(findNewOption(null), null);
  assert.equal(findNewOption([]), null);
  assert.equal(findNewOption(parse('dark 0-906')), null, 'not drawn / no panel');
  assert.equal(findNewOption(parse('dark 0-321 | orange 322-431 | dark 432-460')), null, 'window cut off under the button');
  assert.equal(findNewOption(parse('dark 0-321 | orange 322-431 | other 432-549 | dark 550-906')), null, 'something under the button');
  assert.equal(findNewOption(parse('dark 0-100 | orange 101-500 | dark 501-906')), null, 'too tall to be the button');
  assert.equal(findNewOption(parse('dark 0-300 | orange 301-320 | dark 321-906')), null, 'too small to be the button');
  assert.equal(findNewOption(parse('grey 0-321 | orange 322-431 | grey 432-906')), null, 'another theme');
});

function presser(bands, active = true) {
  const clicks = [];
  let presses = 0;
  let time = 0;
  const p = createNewOptionPresser({
    isActive: () => active,
    probe: async (fromRight) => { assert.equal(fromRight, COLUMN_FROM_RIGHT); return bands; },
    click: (fromRight, y) => clicks.push([fromRight, y]),
    onPress: () => { presses += 1; },
    now: () => time,
    setInterval: () => 0,
    clearInterval: () => {},
  });
  return { p, clicks, presses: () => presses, advance: (ms) => { time += ms; } };
}

test('presses the button in the middle of the trade panel, at most once every 3 s', async () => {
  const t = presser(NEW_OPTION);
  assert.equal(await t.p.check(), true);
  assert.deepEqual(t.clicks, [[CENTRE_FROM_RIGHT, 256]]);
  assert.equal(t.presses(), 1);
  t.advance(1000);
  assert.equal(await t.p.check(), false, 'too soon');
  t.advance(2500);
  assert.equal(await t.p.check(), true);
  assert.equal(t.clicks.length, 2);
});

test('does nothing while auto-trading is off, or on the HIGHER / LOWER panel', async () => {
  const off = presser(NEW_OPTION, false);
  assert.equal(await off.p.check(), false);
  assert.equal(off.clicks.length, 0);
  const ready = presser(HIGHER_LOWER);
  assert.equal(await ready.p.check(), false);
  assert.equal(ready.clicks.length, 0);
  const silent = createNewOptionPresser({ isActive: () => true, probe: async () => { throw new Error('no page'); }, click: () => assert.fail('clicked'),
    setInterval: () => 0, clearInterval: () => {} });
  assert.equal(await silent.check(), false);
});

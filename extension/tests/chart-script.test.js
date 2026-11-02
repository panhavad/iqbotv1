// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { updateChartScripts, buildScript, compact, withLearned, tableLines, kindOf, differsFor, MAX_LENGTH } = require('../src/chart-script.js');
const lua = require('../src/lua-scripts.js');

const rules = (brkCandles, brkZone, brkBody, reverse) => ({ method: 'breakout', brkCandles, brkZone, brkBody, reverse });
const LEARNED = {
  '76/60': { name: 'EUR/USD (OTC)', rules: rules(3, 20, 30, false), check: { rate: 0.492, n: 1632 } },
  '76/30': { name: 'EUR/USD (OTC)', rules: rules(8, 0, 0, true), check: { rate: 0.5, n: 900 } },
  '1916/60': { name: 'Bitcoin', rules: rules(5, 0, 0, false), check: { rate: 0.61, n: 282 } },
  '85/60': { name: 'USD/JPY (OTC)', tooShort: true, rules: rules(5, 0, 0, false) },
  '9/60': { name: 'Vote', rules: { method: 'vote' } },
};

test('the learned table has the 1-minute logic of every learned asset; the selected chart comes first with its own size', () => {
  assert.deepEqual(tableLines(LEARNED), ['[76]={3,20,30,false},', '[1916]={5,0,0,false},']);
  assert.deepEqual(tableLines(LEARNED, '1916/60'), ['[1916]={5,0,0,false},', '[76]={3,20,30,false},']);
  assert.deepEqual(tableLines(LEARNED, '76/30'), ['[76]={8,0,0,true},', '[1916]={5,0,0,false},']);
});

test('the account copy is compact: the same code without comment lines or indentation', () => {
  for (const kind of ['signal', 'scoreboard']) {
    const small = compact(lua[kind], kind);
    assert.equal(kindOf(small), kind);
    assert.ok(small.length < 0.8 * lua[kind].length, small.length + ' of ' + lua[kind].length);
    assert.ok(!/\n\s*--(?! LEARNED SETTINGS)/.test(small.split('\n').slice(2).join('\n')), 'no comment lines left but the markers');
    assert.ok(!/\n[ \t]/.test(small), 'no indentation');
    small.split('\n').forEach((line) => assert.ok(/^[\x20-\x7E]*$/.test(line), 'plain ASCII'));
  }
});

test('fills the LEARNED table and stays under IQ Option\'s length limit, keeping the selected asset', () => {
  const built = buildScript(lua, 'signal', LEARNED, '76/60');
  assert.deepEqual([built.assets, built.dropped], [2, 0]);
  assert.match(built.code, /local LEARNED = \{\n\[76\]=\{3,20,30,false\},\n\[1916\]=\{5,0,0,false\},\n\}\n-- LEARNED SETTINGS END/);
  assert.equal(buildScript(lua, 'signal', LEARNED, '1916/60').code, built.code, 'the selected asset does not reorder the table');
  assert.equal(buildScript(lua, 'signal', LEARNED).code, built.code);
  const many = {};
  for (let id = 1; id <= 3000; id++) many[id + '/60'] = { name: 'A' + id, rules: rules(2 + (id % 20), id % 30, 0, id % 2 === 0) };
  const big = buildScript(lua, 'scoreboard', many, '2500/60');
  assert.ok(big.code.length <= MAX_LENGTH, String(big.code.length));
  assert.ok(big.dropped > 0 && big.assets > 100, JSON.stringify([big.assets, big.dropped]));
  const ids = [...big.code.matchAll(/^\[(\d+)\]=/gm)].map((m) => Number(m[1]));
  assert.equal(ids.length, big.assets);
  assert.ok(ids.includes(2500), 'the selected asset is kept');
  assert.deepEqual(ids, ids.slice().sort((a, b) => a - b), 'sorted by asset id');
  assert.throws(() => withLearned('plot (close)', []), /no LEARNED SETTINGS section/);
});

test('saves the user\'s Next Minute scripts only, and only when they change', async () => {
  const saved = [];
  const account = [
    { id: 1, script: '-- an old copy\ninstrument { name = "Next Minute HIGHER/LOWER", short_name = "NEXT 1M", overlay = true }\n' },
    { id: 2, script: 'instrument { name = "My own script" }\nplot (close)' },
    { id: 3, script: buildScript(lua, 'scoreboard', LEARNED).code }, // already up to date
  ];
  const client = { scripts: async () => account, saveScript: async (id, script) => { saved.push({ id, script }); return { id }; } };
  const r = await updateChartScripts(client, lua, LEARNED);
  assert.deepEqual([r.found, r.updated, r.assets, r.dropped], [2, 1, 2, 0]);
  assert.deepEqual(saved, [{ id: 1, script: buildScript(lua, 'signal', LEARNED).code }]);
  assert.deepEqual(r.scripts.map((s) => [s.kind, s.before === account[s.kind === 'signal' ? 0 : 2].script, s.after === buildScript(lua, s.kind, LEARNED).code]),
    [['signal', true, true], ['scoreboard', true, true]]);
});

test('tells whether the chart, which loaded its script with the page, shows an asset differently', () => {
  const loaded = buildScript(lua, 'signal', LEARNED).code;
  const more = Object.assign({}, LEARNED, { '2159/60': { rules: rules(12, 30, 0, false) } });
  const changed = Object.assign({}, LEARNED, { '76/60': { rules: rules(4, 20, 30, false) } });
  assert.equal(differsFor(loaded, buildScript(lua, 'signal', more).code, 76), false, 'another asset was added');
  assert.equal(differsFor(loaded, buildScript(lua, 'signal', more).code, 2159), true, 'this asset was added');
  assert.equal(differsFor(loaded, buildScript(lua, 'signal', changed).code, 76), true, 'this asset changed');
  assert.equal(differsFor(loaded, buildScript(lua, 'signal', changed).code, 1916), false);
  assert.equal(differsFor(lua.signal, loaded, 1916), true, 'the chart runs another version of the script');
  assert.equal(differsFor(loaded, loaded, 76), false);
});

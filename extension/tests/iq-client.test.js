// node --test extension/tests
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { IqClient } = require('../src/iq-client.js');
const { FakeWebSocket } = require('./fakes.js');

function makeClient(ssid = 'test-ssid') {
  let now = 1000;
  const client = new IqClient({ getSsid: () => ssid, WebSocketImpl: FakeWebSocket, now: () => now });
  return { client, tick: (ms) => { now += ms; } };
}

async function connected() {
  const { client, tick } = makeClient();
  const p = client.connect();
  const ws = FakeWebSocket.last;
  ws.serverOpen();
  const auth = ws.lastSent('authenticate');
  ws.serverSend({ name: 'authenticated', msg: true, request_id: auth.request_id });
  await p;
  return { client, ws, tick };
}

test('authenticates with the session cookie (protocol 3) and asks for results', async () => {
  const { ws } = await connected();
  const auth = ws.lastSent('authenticate');
  assert.equal(auth.msg.ssid, 'test-ssid');
  assert.equal(auth.msg.protocol, 3);
  assert.deepEqual(ws.lastSent('setOptions').msg, { sendResults: true });
});

test('rejects a failed authentication and a missing login', async () => {
  const { client } = makeClient();
  const p = client.connect();
  const ws = FakeWebSocket.last;
  ws.serverOpen();
  ws.serverSend({ name: 'authenticated', msg: false, request_id: ws.lastSent('authenticate').request_id });
  await assert.rejects(p, /Authentication failed/);
  await assert.rejects(makeClient('').client.connect(), /Not logged in/);
});

test('matches replies by request_id and waits past the bare "result" acknowledgement', async () => {
  const { client, ws } = await connected();
  const p = client.request('get-candles', '2.0', { active_id: 76 });
  const req = ws.lastSent('get-candles');
  assert.equal(req.name, 'sendMessage');
  assert.equal(req.msg.version, '2.0');
  ws.serverSend({ name: 'result', request_id: req.request_id, msg: { success: true } });
  ws.serverSend({ name: 'candles', request_id: req.request_id, msg: { candles: [{ from: 1 }] } });
  const reply = await p;
  assert.equal(reply.name, 'candles');
});

test('rejects refused requests', async () => {
  const { client, ws } = await connected();
  const a = client.request('binary-options.open-option', '2.0', {});
  ws.serverSend({ name: 'result', request_id: ws.lastSent('binary-options.open-option').request_id, msg: { success: false, message: 'Time for purchasing options is over' } });
  await assert.rejects(a, /Time for purchasing options is over/);
  const b = client.request('binary-options.open-option', '2.0', {});
  ws.serverSend({ name: 'option', request_id: ws.lastSent('binary-options.open-option').request_id, status: 4100, msg: { message: 'expired' } });
  await assert.rejects(b, /4100/);
});

test('tracks the server clock from timeSync', async () => {
  const { client, ws, tick } = await connected();
  ws.serverSend({ name: 'timeSync', msg: 1793550000123 });
  tick(500);
  assert.equal(client.serverTimeMs(), 1793550000623);
});

test('pushes server messages to subscribers', async () => {
  const { client, ws } = await connected();
  let got = null;
  client.on('candle-generated', (m) => { got = m; });
  client.subscribe('candle-generated', { active_id: 76, size: 60 });
  assert.deepEqual(ws.lastSent('subscribeMessage').msg, { name: 'candle-generated', params: { routingFilters: { active_id: 76, size: 60 } } });
  ws.serverSend({ name: 'candle-generated', msg: { active_id: 76, size: 60, from: 60 } });
  assert.equal(got.from, 60);
});

test('a Binary order is the same as the traderoom HIGHER button sends', async () => {
  const { client, ws } = await connected();
  const p = client.openOption({ kind: 'turbo', balanceId: 111, activeId: 76, direction: 'call', expiresAt: 1793550660, expirationSize: 60, amount: 1, price: 1.104505, payout: 88 });
  const sent = ws.lastSent('binary-options.open-option');
  // Body recorded from the traderoom (balance id replaced).
  assert.deepEqual(sent.msg, {
    name: 'binary-options.open-option', version: '2.0',
    body: { user_balance_id: 111, active_id: 76, option_type_id: 3, direction: 'call', expired: 1793550660,
      refund_value: 0, price: 1, value: 1104505, profit_percent: 88 },
  });
  ws.serverSend({ name: 'result', request_id: sent.request_id, msg: { success: true } });
  ws.serverSend({ name: 'option', request_id: sent.request_id, status: 2000, msg: { id: 5, value: 1.104515, exp: 1793550660 } });
  assert.deepEqual(await p, { id: 5, value: 1.104515, exp: 1793550660 });
});

test('a Blitz order is the same as the traderoom sends for a 1-minute Blitz', async () => {
  const { client, ws } = await connected();
  const p = client.openOption({ kind: 'blitz', balanceId: 111, activeId: 1974, direction: 'call', expiresAt: 1793571199, expirationSize: 60, amount: 1, price: 0.203045, payout: 84 });
  const sent = ws.lastSent('binary-options.open-option');
  // Body recorded from the traderoom (CARDANO (OTC), Blitz, 1 min; balance id replaced).
  assert.deepEqual(sent.msg.body, {
    user_balance_id: 111, active_id: 1974, option_type_id: 12, direction: 'call', expired: 1793571199,
    refund_value: 0, price: 1, value: 203045, profit_percent: 84, expiration_size: 60,
  });
  ws.serverSend({ request_id: sent.request_id, name: 'option', status: 2000, msg: { id: 7, value: 0.203165, exp: 1793571199, type: 'blitz' } });
  assert.equal((await p).type, 'blitz');
});

test('a Digital order is the same as the traderoom sends, and a refusal is an error', async () => {
  const { client, ws } = await connected();
  const p = client.openDigital({ balanceId: 111, activeId: 76, instrumentId: 'do76A20261102D003100T1MCSPT', instrumentIndex: 4063969, amount: 1 });
  const sent = ws.lastSent('digital-options.place-digital-option');
  // Body recorded from the traderoom (EUR/USD (OTC), Digital, 1 min; balance id replaced).
  assert.equal(sent.msg.version, '3.0');
  assert.deepEqual(sent.msg.body, {
    user_balance_id: 111, instrument_id: 'do76A20261102D003100T1MCSPT', amount: '1', instrument_index: 4063969, asset_id: 76,
  });
  ws.serverSend({ request_id: sent.request_id, name: 'digital-option-placed', msg: { id: 21284857609 }, status: 2000 });
  assert.deepEqual(await p, { id: 21284857609 });
  const refused = client.openDigital({ balanceId: 111, activeId: 76, instrumentId: 'x', instrumentIndex: 1, amount: 1 });
  const again = ws.lastSent('digital-options.place-digital-option');
  ws.serverSend({ request_id: again.request_id, name: 'digital-option-placed', msg: { message: 'Time for purchasing options is over' }, status: 4103 });
  await assert.rejects(refused, /Time for purchasing options is over/);
});

test('reads Digital trading hours from the schedule, names, and instruments', async () => {
  const { client, ws } = await connected();
  client.sync = { server: 1793595601 * 1000 + 60000, local: client.now() }; // Mon 2 Nov 2026 05:01 UTC
  const p = client.digitalAsset(1916);
  const sent = ws.lastSent('digital-option-instruments.get-underlying-list');
  assert.deepEqual([sent.msg.version, sent.msg.body], ['3.0', { filter_suspended: true }]);
  ws.serverSend({ request_id: sent.request_id, name: 'underlying-list', msg: { underlying: [
    { active_id: 1916, name: 'BTCUSD-op', underlying: 'BTCUSD-op', is_enabled: true, is_suspended: false,
      schedule: [{ open: 1793336401, close: 1793379600 }, { open: 1793595601, close: 1793638800 }] },
    { active_id: 76, name: 'EURUSD-OTC', underlying: 'EURUSD-OTC', is_enabled: true, is_suspended: false, schedule: [{ open: 1793500000, close: 1793560000 }] },
  ] } });
  // The asset's name comes from the Binary / Blitz data when the asset is there.
  await new Promise((r) => setImmediate(r));
  const init = ws.lastSent('get-initialization-data');
  ws.serverSend({ request_id: init.request_id, name: 'initialization-data', msg: {
    turbo: { actives: {} }, blitz: { actives: { 1916: { description: 'front.Bitcoin', provider: 'feed', enabled: true, is_suspended: true, option: { profit: { commission: 14 } } } } },
  } });
  assert.deepEqual(await p, { name: 'Bitcoin', enabled: true, suspended: false, payout: NaN, expirations: [60, 300, 900] });
  const closed = await client.digitalAsset(76); // cached list; outside its hours; not in the Binary / Blitz data
  assert.deepEqual([closed.name, closed.enabled], ['EURUSD (OTC)', false]);
  assert.equal(await client.digitalAsset(1), null);
  const q = client.digitalInstruments(1912);
  const req = ws.lastSent('digital-option-instruments.get-instruments');
  assert.deepEqual([req.msg.version, req.msg.body], ['3.0', { instrument_type: 'digital-option', asset_id: 1912 }]);
  ws.serverSend({ request_id: req.request_id, name: 'instruments', msg: { instruments: [{ index: 1, expiration: 60, period: 60 }] } });
  assert.deepEqual(await q, [{ index: 1, expiration: 60, period: 60 }]);
});

test('reads the traderoom selection from the traderoom_gl_grid user setting', async () => {
  const { client, ws } = await connected();
  const p = client.layout();
  const sent = ws.lastSent('get-user-settings');
  assert.deepEqual(sent.msg.body, { configs: [{ name: 'traderoom_gl_grid', version: 2 }] });
  // Reply shape recorded from IQ Option (indicator strings shortened).
  ws.serverSend({ request_id: sent.request_id, name: 'user-settings', status: 2000, msg: { configs: [{ name: 'traderoom_gl_grid', version: 2, config: {
    name: 'default', gridSchemeName: 'default_1_1', fixedNumberOfPlotters: 1,
    plotters: [{ activeId: 1974, activeType: 'blitz-option', isMinimized: false, plotType: 'candles', candleDuration: 60, indicators: '{}', scriptedIndicators: '{}' }],
    selectedActiveId: 1974, selectedActiveType: 'blitz-option' } }] } });
  assert.deepEqual(await p, { activeId: 1974, activeType: 'blitz-option', candleSize: 60 });
});

test('reads payout and expiries per option kind and caches them', async () => {
  const { client, ws } = await connected();
  const p = client.assetInfo(76, 'blitz');
  const sent = ws.lastSent('get-initialization-data');
  ws.serverSend({ request_id: sent.request_id, name: 'initialization-data', msg: {
    turbo: { actives: {
      76: { name: 'front.EURUSD-OTC', description: 'front.EUR/USD (OTC)', provider: 'OTC', enabled: true, is_suspended: false, option: { profit: { commission: 12 }, expiration_times: [60] } },
      1974: { name: 'front.CARDANO-OTC', description: 'front.ADAUSD', provider: 'OTC', enabled: true, is_suspended: false, option: { profit: { commission: 18 }, expiration_times: [60] } },
      1916: { name: 'front.BTCUSD-op', description: 'front.Bitcoin', provider: 'feed', enabled: true, is_suspended: true, option: { profit: { commission: 13 }, expiration_times: [60] } },
    } },
    blitz: { actives: { 76: { name: 'front.EURUSD-OTC', description: 'front.EUR/USD (OTC)', provider: 'OTC', enabled: true, is_suspended: false, option: { profit: { commission: 5 }, expiration_times: [30, 45, 60, 120, 180, 300] } } } },
  } });
  assert.deepEqual(await p, { name: 'EUR/USD (OTC)', enabled: true, suspended: false, payout: 95, expirations: [30, 45, 60, 120, 180, 300] });
  const before = ws.sent.length;
  assert.equal((await client.assetInfo(76, 'turbo')).payout, 88);
  assert.equal(ws.sent.length, before, 'served from the cache');
  assert.equal((await client.assetInfo(1974, 'turbo')).name, 'ADAUSD (OTC)', 'OTC shown even when the name hides it');
  assert.equal((await client.assetInfo(1916, 'turbo')).name, 'Bitcoin');
  assert.equal((await client.assetInfo(1916, 'turbo')).suspended, true);
  assert.equal(await client.assetInfo(999, 'turbo'), null);
});

test('names assets as the traderoom shows them, with the traderoom\'s translations', async () => {
  let now = 1000;
  let calls = 0;
  let fail = true;
  const getTranslations = async () => {
    calls += 1;
    if (fail) throw new Error('offline');
    return { 'desktop.SATSUSD-OTC': '1000Sats (OTC)', 'desktop.EURUSD-op': 'EUR/USD', 'desktop.EUR/USD': 'EUR/USD ×1000', 'desktop.USDJPY': 'USD/JPY' };
  };
  const client = new IqClient({ getSsid: () => 's', WebSocketImpl: FakeWebSocket, now: () => now, getTranslations });
  const p = client.connect();
  const ws = FakeWebSocket.last;
  ws.serverOpen();
  ws.serverSend({ name: 'authenticated', msg: true, request_id: ws.lastSent('authenticate').request_id });
  await p;
  const init = {
    turbo: { actives: {
      2159: { name: 'front.SATSUSD-OTC', description: 'front.SATSUSD-OTC', provider: 'OTC', enabled: true, option: { profit: { commission: 10 }, expiration_times: [60] } },
      1861: { name: 'front.EURUSD-op', description: 'front.EUR/USD', provider: 'feed', enabled: true, option: { profit: { commission: 10 }, expiration_times: [60] } },
      2428: { name: 'front.ETHBTC-OTC', description: 'front.ETHBTC-OTC', provider: 'OTC', enabled: true, option: { profit: { commission: 10 }, expiration_times: [60] } },
    } },
  };
  const first = client.assetInfo(2159, 'turbo');
  ws.serverSend({ request_id: ws.lastSent('get-initialization-data').request_id, name: 'initialization-data', msg: init });
  assert.equal((await first).name, 'SATSUSD (OTC)', 'translations unavailable: the name is derived');
  now += 600001; // asked again after 10 minutes
  fail = false;
  const again = client.assetInfo(2159, 'turbo');
  ws.serverSend({ request_id: ws.lastSent('get-initialization-data').request_id, name: 'initialization-data', msg: init });
  assert.equal((await again).name, '1000Sats (OTC)');
  assert.equal((await client.assetInfo(1861, 'turbo')).name, 'EUR/USD', 'the name is translated, not the description');
  assert.equal((await client.assetInfo(2428, 'turbo')).name, 'ETHBTC (OTC)', 'not translated: derived');
  assert.equal(await client.assetName(2159), '1000Sats (OTC)');
  assert.equal(calls, 2, 'kept once read');
});

test('fails pending requests when the connection drops', async () => {
  const { client, ws } = await connected();
  let closed = false;
  client.on('close', () => { closed = true; });
  const p = client.request('get-candles', '2.0', {});
  ws.close();
  await assert.rejects(p, /closed/);
  assert.equal(closed, true);
});

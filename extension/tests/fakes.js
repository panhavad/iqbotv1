// Test doubles: a fake WebSocket for IqClient and a fake IQ Option client for AutoTrader.
'use strict';
const fs = require('fs');
const path = require('path');

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.last = this;
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  // Server side helpers.
  serverOpen() { this.readyState = 1; this.onopen(); }
  serverSend(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
  lastSent(name) { return [...this.sent].reverse().find((m) => m.name === name || (m.msg && m.msg.name === name)); }
}

function realCandles() {
  const file = path.join(__dirname, 'fixtures', 'eurusd-otc-1m.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).candles;
}

// Implements the subset of IqClient that AutoTrader uses, over a fixed candle list (the same
// candles serve every asset). `selection` is what the traderoom shows; tests change it.
class FakeIqClient {
  constructor(candles, options) {
    const o = options || {};
    this.all = candles;
    this.time = o.time || 0; // server time in seconds
    this.handlers = new Map();
    this.subs = [];
    this.unsubs = [];
    this.orders = [];
    this.balancesList = o.balances || [
      { id: 111, type: 4, amount: 10000, currency: 'USD', user_id: 42 },
      { id: 222, type: 1, amount: 500, currency: 'USD', user_id: 42 },
    ];
    this.selection = o.selection || { activeId: 76, activeType: 'turbo-option', candleSize: 60 };
    this.assets = {
      'turbo/76': Object.assign({ name: 'EUR/USD (OTC)', enabled: true, suspended: false, payout: 88, expirations: [60] }, o.asset || {}),
      'blitz/76': { name: 'EUR/USD (OTC)', enabled: true, suspended: false, payout: 95, expirations: [30, 45, 60, 120, 180, 300] },
      'turbo/1974': { name: 'CARDANO (OTC)', enabled: true, suspended: false, payout: 82, expirations: [60] },
      'blitz/1974': { name: 'CARDANO (OTC)', enabled: true, suspended: false, payout: 84, expirations: [30, 45, 60, 120, 180, 300] },
      'blitz/1916': { name: 'BTC/USD', enabled: true, suspended: false, payout: 86, expirations: [180, 300, 600, 900] },
      // USD/JPY (OTC): Binary options only in the 15-minute "binary" list (as on 2 Nov 2026).
      'turbo/85': { name: 'USD/JPY (OTC)', enabled: true, suspended: false, payout: 84, expirations: [900] },
    };
    this.refuseOrders = false;
    this.nextId = 1000;
    this.series = o.series || null;
    // Digital: trading hours per asset, the instruments of the followed asset, and the
    // at-the-money asks that the price stream sends after a subscription (null: no prices).
    this.digitalAssets = Object.assign({
      76: { name: 'EUR/USD (OTC)', enabled: true, suspended: false, payout: NaN, expirations: [60, 300, 900] },
    }, o.digitalAssets || {});
    this.instruments = o.instruments || [];
    this.digitalAsks = o.digitalAsks === undefined ? { call: 54.591917, put: 54.608083 } : o.digitalAsks; // 83.2% / 83.1%
  }
  serverTimeMs() { return this.time * 1000; }
  get sync() { return { server: this.time * 1000, local: 0 }; }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name).delete(fn);
  }
  emit(name, payload) { for (const fn of this.handlers.get(name) || []) fn(payload); }
  async connect() {}
  close() {}
  subscribe(name, filters, version) {
    this.subs.push({ name, filters, version });
    if (name === 'trading-settings.digital-option-client-price-generated' && this.digitalAsks) {
      this.emit('digital-option-client-price-generated', {
        instrument_index: filters.instrument_index, asset_id: filters.asset_id,
        prices: [{ strike: 'SPT', call: { ask: this.digitalAsks.call }, put: { ask: this.digitalAsks.put } }],
      });
    }
  }
  unsubscribe(name, filters, version) { this.unsubs.push({ name, filters, version }); }
  async balances() { return this.balancesList; }
  async layout() { return this.selection ? Object.assign({}, this.selection) : null; }
  async assetInfo(activeId, kind) {
    const a = this.assets[kind + '/' + activeId];
    return a ? Object.assign({}, a, { expirations: a.expirations.slice() }) : null;
  }
  // Closed candles only, like get-candles with only_closed. Other candle sizes come from
  // options.series[size] when given (e.g. 5-second candles), otherwise from the same list.
  // publishDelay: seconds after a candle's end before it can be fetched (IQ Option: about 0.9 s).
  async candles(activeId, size, toSec, count) {
    const list = (this.series && this.series[size]) || this.all;
    const closed = list.filter((c) => c.from + size + (this.publishDelay || 0) <= Math.min(toSec, this.time));
    return closed.slice(-count);
  }
  async openOption(order) {
    if (this.refuseOrders) throw new Error('binary-options.open-option refused: test');
    const id = this.nextId++;
    this.orders.push(Object.assign({ id }, order));
    this.charge(order);
    return { id, value: order.price || 1.1, exp: order.expiresAt };
  }
  // Like the server: the stake leaves the balance when the option is bought.
  charge(order) {
    const bal = this.balancesList.find((b) => b.id === order.balanceId);
    if (bal) bal.amount = Math.round((bal.amount - order.amount) * 100) / 100;
  }
  async digitalAsset(activeId) {
    const a = this.digitalAssets[activeId];
    return a ? Object.assign({}, a, { expirations: a.expirations.slice() }) : null;
  }
  async digitalInstruments(activeId) { return this.instruments.filter((i) => i.asset_id === activeId); }
  async assetName(activeId) {
    return ({ 1: 'EUR/USD', 76: 'EUR/USD (OTC)', 85: 'USD/JPY (OTC)', 1916: 'Bitcoin', 1974: 'CARDANO (OTC)' })[activeId] || '';
  }
  async tradableAssets() {
    return this.tradable || [
      { activeId: 76, name: 'EUR/USD (OTC)', kinds: ['turbo', 'blitz', 'digital'] },
      { activeId: 1974, name: 'CARDANO (OTC)', kinds: ['turbo', 'blitz'] },
    ];
  }
  async openDigital(order) {
    if (this.refuseOrders) throw new Error('digital-options.place-digital-option refused: test');
    const id = this.nextId++;
    this.orders.push(Object.assign({ id, kind: 'digital' }, order));
    this.charge(order);
    return { id };
  }
}

// Digital instruments (one per expiry) like digital-option-instruments.get-instruments sends them.
function digitalInstruments(activeId, firstExpiration, count = 2, period = 60, firstIndex = 5000) {
  return Array.from({ length: count }, (_, k) => {
    const expiration = firstExpiration + k * period;
    const iso = new Date(expiration * 1000).toISOString();
    const name = 'do' + activeId + 'A' + iso.slice(0, 10).replace(/-/g, '') + 'D' + iso.slice(11, 19).replace(/:/g, '') + 'T' + period / 60 + 'M';
    return {
      index: firstIndex + k, instrument_type: 'digital-option', asset_id: activeId, expiration, period, deadtime: 30,
      data: [
        { strike: '1.1', symbol: name + 'C1F1', direction: 'call' },
        { strike: 'SPT', symbol: name + 'CSPT', direction: 'call' },
        { strike: '1.1', symbol: name + 'P1F1', direction: 'put' },
        { strike: 'SPT', symbol: name + 'PSPT', direction: 'put' },
      ],
    };
  });
}

// Runs queued timers immediately (AutoTrader only uses short retry delays).
const immediateTimer = (fn) => setImmediate(fn);

// A market of steady trends (runLength candles up, then down, ...): each candle closes at its
// extreme, so breakout arrows win except at the turns.
function trendCandles(n, runLength, start = 1793000040) { // start: a whole minute, like real candles
  const out = [];
  let price = 1.1;
  for (let i = 0; i < n; i++) {
    const up = Math.floor(i / runLength) % 2 === 0;
    const open = price;
    const close = +(open + (up ? 0.0001 : -0.0001)).toFixed(6);
    out.push({ from: start + 60 * i, open, max: Math.max(open, close), min: Math.min(open, close), close });
    price = close;
  }
  return out;
}

module.exports = { FakeWebSocket, FakeIqClient, realCandles, immediateTimer, trendCandles, digitalInstruments };

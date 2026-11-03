/*
 * Auto trader. It follows the asset and option type selected in the traderoom (the
 * traderoom_gl_grid user setting), computes the Next Minute signal on the chart's candles
 * and, when a new candle opens with an arrow and every safety check passes, buys:
 *   - Binary (turbo, 1-minute candles): an option that expires at the end of that candle;
 *   - Blitz: an option whose expiry equals the candle size, counted from the purchase;
 *   - Digital (1, 5 or 15-minute candles): an at-the-money option that expires at the end of
 *     that candle, at the payout of IQ Option's price stream.
 *
 * Dependencies are injected (client, clock, timers) so it can be tested without a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./signal-engine.js'));
  else root.NMAutoTrader = factory(root.NMSignalEngine);
})(typeof self !== 'undefined' ? self : this, function (SignalEngine) {
  'use strict';

  const HISTORY = 1000;
  const MAX_ENTRY_SEC = 25; // IQ Option stops selling the current minute 30 s before it ends.
  // The "Arrows" setting: minimum share of candles with an arrow. The learner chooses each asset's
  // logic once for each of these (learner.js FREQUENCIES: keep both lists equal).
  const FREQUENCIES = Object.freeze([0, 0.1, 0.25, 0.5, 0.9]);
  const LAYOUT_EVERY_SEC = 3; // how often the traderoom selection is read
  const HINT_SEC = 10; // how long a selection seen in the traderoom waits for the traderoom to save it
  const EDGE_CANDLES = 5000; // recent candles replayed to measure the method on the followed asset
  const EDGE_EVERY_SEC = 1800;
  const BALANCE_REFRESH_MS = 1500;
  const BALANCE_EVERY_SEC = 60;
  const MAX_LEARN_CANDLES = 60000; // about the 1-minute history IQ Option keeps (60 days)
  const KIND_OF = { 'turbo-option': 'turbo', 'binary-option': 'turbo', 'blitz-option': 'blitz', 'digital-option': 'digital' };
  const KIND_LABEL = { turbo: 'Binary', blitz: 'Blitz', digital: 'Digital' };
  const DIGITAL_PERIODS = [60, 300, 900]; // candle sizes with a Digital expiry at the end of the candle
  const DIGITAL_PRICES = 'trading-settings.digital-option-client-price-generated';
  const DIGITAL_INSTRUMENTS = 'digital-option-instruments.instrument-generated';
  const TYPE_LABEL = {
    'digital-option': 'Digital', 'fx-option': 'FX options', 'forex': 'Forex', 'cfd': 'CFD', 'crypto': 'Crypto',
    'marginal-forex': 'Margin forex', 'marginal-cfd': 'Margin CFD', 'marginal-crypto': 'Margin crypto',
  };

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,         // auto-trading; switched on by the user only
    account: 'practice',    // 'practice' or 'real'
    realConfirmed: false,   // must also be true before any real-money order
    stake: 1,
    entryWindowSec: 10,     // buy only within this many seconds after the candle opens
    minPayout: 80,          // skip when the payout (%) is lower
    maxTrades: 20,          // per session (a session starts when auto-trading is switched on)
    maxLossStreak: 4,       // stop after this many losses in a row
    maxSessionLoss: 10,     // stop when the session has lost this much
    requireEdge: false,     // true: trade only where the logic recently beat break-even (lower 95% bound)
    directions: 'both',     // arrows to buy: 'both', 'call' (CALL / higher only) or 'put' (PUT / lower only)
    frequency: 0.25,        // "Arrows": minimum share of candles with an arrow (FREQUENCIES); 0 = best win rate
    useLearned: true,       // use the logic learned for the selected asset (learner.js)
    learnAll: true,         // learn every open asset one by one in the background
    learnCandles: 20000,    // candles of history to learn from (most recent first)
    target: 90,             // win rate (%) the learner tries to reach
    rules: SignalEngine.DEFAULTS,
  });

  // lastTradeFrom (the open time of the last traded candle) carries over to new sessions
  // and is stored, so a page reload or a second session never trades the same candle twice.
  function newSession(nowSec, lastTradeFrom) {
    return { startedAt: nowSec, trades: 0, wins: 0, losses: 0, ties: 0, pnl: 0, lossStreak: 0, stopReason: '',
      lastTradeFrom: lastTradeFrom || 0,
      sides: { call: { wins: 0, losses: 0, ties: 0 }, put: { wins: 0, losses: 0, ties: 0 } } };
  }

  function clampSettings(s) {
    const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
    delete out.activeId; // older versions traded one fixed asset
    out.rules = Object.assign({}, SignalEngine.DEFAULTS, (s && s.rules) || {});
    out.account = out.account === 'real' ? 'real' : 'practice';
    out.stake = Math.max(1, Number(out.stake) || 1);
    out.entryWindowSec = Math.min(MAX_ENTRY_SEC, Math.max(1, Number(out.entryWindowSec) || 10));
    out.minPayout = Math.max(0, Math.min(100, Number(out.minPayout) || 0));
    out.maxTrades = Math.max(1, Math.round(Number(out.maxTrades) || 1));
    out.maxLossStreak = Math.max(1, Math.round(Number(out.maxLossStreak) || 1));
    out.maxSessionLoss = Math.max(0, Number(out.maxSessionLoss) || 0);
    out.enabled = !!out.enabled;
    out.realConfirmed = !!out.realConfirmed;
    out.requireEdge = out.requireEdge === true;
    out.directions = out.directions === 'call' || out.directions === 'put' ? out.directions : 'both';
    const f = Number(out.frequency);
    out.frequency = Number.isFinite(f)
      ? FREQUENCIES.reduce((best, x) => (Math.abs(x - f) < Math.abs(best - f) ? x : best), FREQUENCIES[0])
      : DEFAULT_SETTINGS.frequency;
    out.useLearned = out.useLearned !== false;
    out.learnAll = out.learnAll !== false;
    out.learnCandles = Math.min(MAX_LEARN_CANDLES, Math.max(2000, Math.round(Number(out.learnCandles) || 20000)));
    out.target = Math.min(99, Math.max(51, Math.round(Number(out.target) || 90)));
    return out;
  }

  function wilson(w, n) {
    if (!n) return [0, 1];
    const z = 1.96, p = w / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [c - h, c + h];
  }

  function rateOf(w, n) {
    const [lo, hi] = wilson(w, n);
    return { wins: w, n, rate: n ? w / n : NaN, lo, hi };
  }

  const SIDE_LABEL = { call: 'CALL', put: 'PUT' };

  // "best win rate" (no minimum), "at least 1 candle in 4", ..., "almost every candle".
  function frequencyLabel(f) {
    if (!f) return 'best win rate (fewest arrows)';
    if (f >= 0.9) return 'almost every candle';
    return 'at least 1 candle in ' + Math.round(1 / f);
  }

  // The reason to leave an arrow out because of its direction ("Buy": CALL only / PUT only), or ''.
  function sideFilter(s, direction) {
    return direction && s.directions !== 'both' && direction !== s.directions ? 'only ' + SIDE_LABEL[s.directions] + ' arrows are bought' : '';
  }

  function sizeLabel(sec) {
    return sec % 60 === 0 ? (sec / 60) + ' min' : sec + ' s';
  }

  // Payouts (%) of the at-the-money ("SPT") Digital options in a digital-option-client-price-generated
  // message: an option bought at price `ask` pays 100, so the profit is (100 - ask) / ask.
  function digitalPayouts(msg) {
    const spot = msg && Array.isArray(msg.prices) ? msg.prices.find((p) => p.strike === 'SPT') : null;
    if (!spot) return null;
    const pay = (side) => (side && side.ask > 0 ? Math.round(1000 * (100 - side.ask) / side.ask) / 10 : NaN);
    return { call: pay(spot.call), put: pay(spot.put) };
  }

  // The traderoom's name of an at-the-money Digital option, e.g. do76A20261102D003100T1MCSPT
  // (asset 76, expiring 2026-11-02 00:31:00 UTC, 1-minute period, call).
  function digitalSymbol(activeId, expiration, period, direction) {
    const iso = new Date(expiration * 1000).toISOString(); // 2026-11-02T00:31:00.000Z
    const day = iso.slice(0, 10).replace(/-/g, '');
    const time = iso.slice(11, 19).replace(/:/g, '');
    return 'do' + activeId + 'A' + day + 'D' + time + 'T' + (period / 60) + 'M' + (direction === 'call' ? 'C' : 'P') + 'SPT';
  }

  class AutoTrader {
    constructor(options) {
      const o = options || {};
      this.client = o.client;
      this.settings = clampSettings(o.settings);
      this.session = o.session && typeof o.session === 'object' ? Object.assign(newSession(0), o.session) : newSession(0);
      // A session saved before CALL and PUT results were counted apart: counted from the next session.
      if (o.session && !o.session.sides && o.session.trades) this.session.sides = null;
      this.setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
      // Fast clock that starts each candle's decision right after the candle opens (no-op in tests).
      this.startClock = o.startClock || ((fn) => {
        const id = setInterval(fn, 200);
        if (id && id.unref) id.unref(); // Node (tests): do not keep the process alive
        return () => clearInterval(id);
      });
      this.stopClock = null;
      this.handlers = new Map();
      this.status = 'idle';
      this.statusText = '';
      this.balances = { practice: null, real: null };
      this.userId = null;
      // What is traded: the traderoom selection and the asset's option settings.
      this.target = null; // {activeId, activeType, kind, candleSize, name, payout, enabled, suspended, expirations, reason}
      this.targetKey = '';
      this.layoutCheckedAt = 0;
      this.layoutBusy = false;
      this.assetCheckedAt = 0;
      // Digital options of the followed asset: {activeId, period, instruments: Map(index -> instrument),
      // payouts: Map(index -> {call, put}), subscribed: Set(index)}.
      this.digital = null;
      // Open positions of the account from any source (this extension, the traderoom, other devices):
      // position id -> {activeId, until (s)}. "+ NEW OPTION" is pressed only when none is open.
      this.openPositions = new Map();
      // Logic learned per asset and candle size ('activeId/size' -> learner result, see learner.js),
      // and what the learning queue is doing (shown in the panel).
      this.learned = Object.assign({}, o.learned || {});
      this.learning = { busy: false, asset: '', fetched: 0, wanted: 0, done: 0, total: 0, note: '' };
      // Recent results of the method on the followed asset: {wins, n, rate, lo, hi, breakEven, candles}.
      this.edge = null;
      this.edgeAt = 0;
      this.edgeBusy = false;
      this.live = null; // the latest update of the followed candles {from, open, close, min, max}
      this.closing = null; // the final update of the candle that closed last (same fields)
      this.closingCheck = null; // a candle decided from its final update, to compare with the published candle
      this.lastClose = null; // close of the last closed candle
      this.engine = null; // signal engine fed with every closed candle of the target so far
      this.engineLast = 0; // open time of the last candle fed to the engine
      this.cycleFrom = 0; // candle (open time) whose decision is done or in progress
      this.lastSignal = null; // {from, decision, traded, note}
      this.trades = []; // newest first
      this.logLines = [];
      this.reconnectDelay = 2000;
      this.stopped = false;
      this.unsubs = [];
    }

    // ---- events ---------------------------------------------------------------
    on(name, fn) {
      if (!this.handlers.has(name)) this.handlers.set(name, new Set());
      this.handlers.get(name).add(fn);
    }
    emit(name, payload) {
      const set = this.handlers.get(name);
      if (set) for (const fn of [...set]) { try { fn(payload); } catch (_) { /* UI errors must not stop trading */ } }
    }
    changed() { this.emit('state', this.getState()); }

    log(text) {
      const t = new Date(this.client.serverTimeMs());
      const stamp = t.toLocaleTimeString([], { hour12: false });
      this.logLines.unshift(stamp + '  ' + text);
      this.logLines.length = Math.min(this.logLines.length, 60);
      this.emit('log', text);
      this.changed();
    }

    nowSec() { return this.client.serverTimeMs() / 1000; }
    get size() { return this.target ? this.target.candleSize : 60; }
    candleStart(sec) { return Math.floor(sec / this.size) * this.size; }

    // ---- learned logic --------------------------------------------------------
    learnedKey(t) { return t && t.activeId ? t.activeId + '/' + t.candleSize : ''; }
    learnedFor(t) {
      const r = this.learned[this.learnedKey(t || this.target)];
      return r && !r.tooShort ? r : null; // too little history: the panel's rules apply
    }

    // The part of a learned result for the chosen frequency ("Arrows"): {rules, learn, choose, check,
    // late?}. When no logic gives arrows that often there, the next lower frequency's; a result
    // learned before frequencies existed has one logic only.
    levelOf(r) {
      if (!r || !r.levels) return r || null;
      for (const f of FREQUENCIES.filter((x) => x <= this.settings.frequency).reverse()) {
        const level = r.levels[String(f)];
        if (level) return level;
      }
      return r;
    }

    // The rules used for an asset: its learned logic when there is one (and it is switched on),
    // otherwise the rules of the panel.
    rules(t) {
      const l = this.settings.useLearned ? this.learnedFor(t) : null;
      return l ? Object.assign({}, this.settings.rules, this.levelOf(l).rules) : this.settings.rules;
    }

    // The learned result of the followed asset, with the logic of the chosen frequency on top.
    learnedView() {
      const r = this.learnedFor();
      if (!r) return null;
      const level = this.levelOf(r);
      return Object.assign({}, r, { rules: level.rules, learn: level.learn, choose: level.choose, check: level.check,
        late: level.late, lateCoverage: level.lateCoverage });
    }

    // Every asset's learned rules at the chosen frequency: the chart script's table.
    learnedTable() {
      const out = {};
      for (const [key, r] of Object.entries(this.learned)) {
        if (!r) continue;
        const level = this.levelOf(r);
        out[key] = { name: r.name, tooShort: !!r.tooShort, rules: level && level.rules };
      }
      return out;
    }

    // Stores a learned logic; applies it at once when it is the followed asset's.
    setLearned(key, result) {
      const before = JSON.stringify(this.rules());
      this.learned[key] = result;
      this.emit('learned', { key, result });
      if (key === this.learnedKey(this.target) && this.settings.useLearned) {
        if (JSON.stringify(this.rules()) !== before) this.engine = null; // rebuilt with the new rules
        this.edge = null;
        this.edgeCheck();
      }
      this.changed();
    }

    setLearning(patch) {
      Object.assign(this.learning, patch);
      this.changed();
    }

    // Status of the chart scripts in the account (content.js updates them): {state, found, assets,
    // needsReload, error}.
    setChart(patch) {
      this.chart = Object.assign({}, this.chart || {}, patch);
      this.changed();
    }

    // ---- settings -------------------------------------------------------------
    setSettings(patch) {
      const before = this.settings;
      const next = clampSettings(Object.assign({}, before, patch, { rules: Object.assign({}, before.rules, (patch && patch.rules) || {}) }));
      if (next.account !== before.account || (next.account === 'real' && !next.realConfirmed)) {
        // Changing the account always switches auto-trading off; real money needs the confirmation.
        if (next.account !== before.account) next.enabled = false;
        if (next.account === 'real' && !next.realConfirmed) next.enabled = false;
      }
      if (next.enabled && !before.enabled) {
        this.session = newSession(Math.floor(this.nowSec()), this.session.lastTradeFrom);
        this.emit('session', this.session);
        this.log('Auto-trading ON (' + next.account + ' account, stake ' + next.stake +
          (next.directions === 'both' ? '' : ', ' + SIDE_LABEL[next.directions] + ' arrows only') + ').');
      } else if (!next.enabled && before.enabled) {
        this.log('Auto-trading OFF.');
      }
      if (next.directions !== before.directions) {
        this.log(next.directions === 'both' ? 'Buying CALL and PUT arrows.' : 'Buying ' + SIDE_LABEL[next.directions] + ' arrows only.');
      }
      if (next.frequency !== before.frequency) {
        this.log('Arrows: ' + frequencyLabel(next.frequency) + ' (the learned logic of each asset for that frequency).');
      }
      const appliedBefore = JSON.stringify(this.rules());
      this.settings = next;
      // Rules in use for the followed asset: the panel's rules or its learned logic.
      const rulesChanged = JSON.stringify(this.rules()) !== appliedBefore || next.useLearned !== before.useLearned;
      if (rulesChanged) this.engine = null; // rebuilt with the new rules
      this.emit('settings', next);
      if (next.account !== before.account && this.status === 'ready') this.subscribePositions();
      if (rulesChanged && this.status === 'ready') { this.edge = null; this.edgeCheck(); }
      this.changed();
    }

    resetSession() {
      this.session = newSession(Math.floor(this.nowSec()), this.session.lastTradeFrom);
      this.emit('session', this.session);
      this.log('Session statistics reset.');
    }

    stopTrading(reason) {
      this.session.stopReason = reason;
      this.emit('session', this.session);
      this.settings = Object.assign({}, this.settings, { enabled: false });
      this.emit('settings', this.settings);
      this.log('Auto-trading stopped: ' + reason);
    }

    // ---- connection -----------------------------------------------------------
    async start() {
      this.stopped = false;
      this.engine = null; // candles may have been missed while disconnected
      this.target = null;
      this.targetKey = '';
      this.hint = null;
      this.digital = null; // subscriptions of the old connection are gone
      this.setStatus('connecting', 'Connecting to IQ Option...');
      try {
        await this.client.connect();
        this.unsubs.forEach((u) => u());
        this.unsubs = [
          this.client.on('candle-generated', (m) => this.onCandle(m)),
          this.client.on('position-changed', (m) => this.onPosition(m)),
          this.client.on('timeSync', () => this.onTick()),
          this.client.on('close', () => this.onDisconnect()),
          this.client.on('balance-changed', (m) => this.onBalanceChanged(m)),
          this.client.on('instrument-generated', (m) => this.addInstrument(m)),
          this.client.on('digital-option-client-price-generated', (m) => this.onDigitalPrice(m)),
        ];
        await this.loadAccount();
        this.subscribePositions();
        // Balance changes from any source (trades in the traderoom, deposits) arrive as they happen.
        this.client.subscribe('internal-billing.balance-changed', null, '1.0');
        this.balancesAt = this.nowSec();
        this.reconnectDelay = 2000;
        this.setStatus('ready', 'Connected');
        if (this.stopClock) this.stopClock();
        this.stopClock = this.startClock(() => this.onClock());
        this.log('Connected.');
        await this.checkLayout(true);
      } catch (e) {
        this.setStatus('error', e.message);
        this.log('Connection failed: ' + e.message);
        this.scheduleReconnect();
      }
    }

    stop() {
      this.stopped = true;
      if (this.stopClock) { this.stopClock(); this.stopClock = null; }
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.client.close();
      this.setStatus('idle', 'Stopped');
    }

    onDisconnect() {
      if (this.stopped) return;
      this.setStatus('error', 'Disconnected');
      this.log('Connection lost; reconnecting.');
      this.scheduleReconnect();
    }

    scheduleReconnect() {
      if (this.stopped) return;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(60000, this.reconnectDelay * 2);
      this.setTimer(() => { if (!this.stopped && this.status !== 'ready') this.start(); }, delay);
    }

    setStatus(status, text) {
      this.status = status;
      this.statusText = text || '';
      this.changed();
    }

    async loadAccount() {
      const list = await this.client.balances();
      const practice = list.find((b) => b.type === 4);
      const real = list.find((b) => b.type === 1);
      this.balances = {
        practice: practice ? { id: practice.id, amount: practice.amount, currency: practice.currency } : null,
        real: real ? { id: real.id, amount: real.amount, currency: real.currency } : null,
      };
      const any = practice || real || list[0];
      this.userId = any ? any.user_id : null;
    }

    subscribePositions() {
      const bal = this.balances[this.settings.account];
      if (!bal || !this.userId) return;
      for (const type of ['turbo-option', 'blitz-option', 'digital-option']) {
        this.client.subscribe('portfolio.position-changed', { user_id: this.userId, user_balance_id: bal.id, instrument_type: type }, '3.0');
      }
    }

    onBalanceChanged(m) {
      const cur = m && (m.current_balance || m.balance || (m.id !== undefined && m.amount !== undefined ? m : null));
      let known = false;
      if (cur) {
        for (const key of ['practice', 'real']) {
          if (this.balances[key] && this.balances[key].id === cur.id) { this.balances[key].amount = Number(cur.amount); known = true; }
        }
      }
      if (!known) this.refreshBalances(); // another format or a new balance: read them all again
      this.changed();
    }

    // ---- following the traderoom selection -------------------------------------
    // Polled every few seconds (and when connecting): the selection saved on the server.
    async checkLayout(force) {
      if (this.layoutFetching) return;
      this.layoutFetching = true;
      this.layoutCheckedAt = this.nowSec();
      try {
        const layout = await this.client.layout();
        const h = this.hint;
        if (h) {
          const saved = !!layout && layout.activeId === h.layout.activeId && layout.activeType === h.layout.activeType;
          if (!saved && this.nowSec() - h.at < HINT_SEC) return; // the traderoom has not saved the new selection yet
          this.hint = null;
        }
        await this.applyLayout(layout, force);
      } catch (e) {
        if (force || !this.target) this.log('Could not read the traderoom selection: ' + e.message);
      } finally {
        this.layoutFetching = false;
      }
    }

    // The asset and option type on the traderoom's screen, the moment they are chosen (content.js
    // passes what the traderoom asks the server about; it saves the selection about 3 seconds
    // later): followed at once, with the current candle size. Only known instrument types count.
    selectionHint(activeId, activeType) {
      const type = String(activeType || '');
      const id = Number(activeId);
      const cur = this.target;
      if (this.status !== 'ready' || !id || !(KIND_OF[type] || TYPE_LABEL[type])) return null;
      if (cur && cur.activeId === id && cur.activeType === type) return null;
      const layout = { activeId: id, activeType: type, candleSize: cur && cur.candleSize > 0 ? cur.candleSize : 60 };
      this.hint = { layout, at: this.nowSec() };
      return this.applyLayout(layout);
    }

    // The selection the traderoom has just saved (content.js passes it on at once).
    layoutSaved(layout) {
      this.hint = null;
      return this.applyLayout(layout);
    }

    // A selection from the polling above or, at once, from the traderoom itself (content.js passes
    // what the traderoom saves). Applied in order, one at a time; the newest one wins.
    async applyLayout(layout, force) {
      const before = this.pendingLayout;
      this.pendingLayout = { layout, force: !!force || !!(before && before.force) };
      if (this.layoutBusy) return;
      this.layoutBusy = true;
      try {
        while (this.pendingLayout) {
          const next = this.pendingLayout;
          this.pendingLayout = null;
          try {
            await this.retarget(next.layout, next.force);
          } catch (e) {
            this.log('Could not follow the traderoom selection: ' + e.message);
          }
        }
      } finally {
        this.layoutBusy = false;
      }
    }

    async retarget(layout, force) {
      const key = layout ? [layout.activeId, layout.activeType, layout.candleSize].join('/') : '';
      if (!force && key === this.targetKey) return;
      const t = {
        activeId: layout ? layout.activeId : null,
        activeType: layout ? layout.activeType : '',
        kind: layout ? (KIND_OF[layout.activeType] || null) : null,
        candleSize: layout && layout.candleSize > 0 ? layout.candleSize : 60,
        name: '', payout: NaN, enabled: false, suspended: false, expirations: [], reason: '',
      };
      if (!layout) {
        t.reason = 'traderoom selection unknown';
      } else if (!t.kind) {
        t.name = await this.client.assetName(t.activeId).catch(() => '');
        t.reason = (TYPE_LABEL[layout.activeType] || layout.activeType || 'This instrument') + ' is not supported: choose Binary, Blitz or Digital';
      } else {
        const info = t.kind === 'digital' ? await this.client.digitalAsset(t.activeId) : await this.client.assetInfo(t.activeId, t.kind);
        if (!info) {
          t.name = await this.client.assetName(t.activeId).catch(() => '');
          t.reason = 'this asset has no ' + KIND_LABEL[t.kind] + ' options';
        } else {
          Object.assign(t, { name: info.name, payout: info.payout, enabled: info.enabled, suspended: info.suspended, expirations: info.expirations });
          if (t.kind === 'turbo' && info.expirations.length && !info.expirations.includes(60)) {
            t.reason = 'only ' + info.expirations.map(sizeLabel).join(', ') + ' Binary options here; choose Blitz or Digital for 1 minute';
          } else if (t.kind === 'turbo' && t.candleSize !== 60) {
            t.reason = 'set the chart to 1-minute candles (Binary options expire at the end of the minute)';
          } else if (t.kind === 'blitz' && !info.expirations.includes(t.candleSize)) {
            const fits = info.expirations.filter((e) => [30, 60, 120, 300].includes(e)).map(sizeLabel);
            t.reason = 'Blitz has no ' + sizeLabel(t.candleSize) + ' expiry here; set the candles to ' + (fits.join(', ') || '1 min');
          } else if (t.kind === 'digital' && !DIGITAL_PERIODS.includes(t.candleSize)) {
            t.reason = 'set the chart to 1, 5 or 15-minute candles (Digital options expire at the end of the candle)';
          }
        }
      }
      const d = this.digital;
      if (d && (t.kind !== 'digital' || t.reason || d.activeId !== t.activeId || d.period !== t.candleSize)) this.stopDigital();
      const changedCandles = !this.target || this.target.activeId !== t.activeId || this.target.candleSize !== t.candleSize;
      if (changedCandles && this.target && this.target.activeId) {
        // Other candles: stop watching the old ones.
        const old = this.target;
        this.client.unsubscribe('candle-generated', { active_id: old.activeId, size: old.candleSize });
      }
      this.targetKey = key;
      this.target = t;
      this.assetCheckedAt = this.nowSec();
      if (changedCandles) {
        this.engine = null;
        this.engineLast = 0;
        this.live = null;
        this.closing = null;
        this.closingCheck = null;
        this.lastClose = null;
        this.cycleFrom = 0;
        this.lastSignal = null;
        this.edge = null;
        if (t.activeId) this.client.subscribe('candle-generated', { active_id: t.activeId, size: t.candleSize });
      }
      if (t.kind === 'digital' && !t.reason && !this.digital) await this.startDigital(t);
      this.log('Following ' + this.targetLabel() + (t.reason ? ' - ' + t.reason + '.' : '.'));
      if (t.activeId && changedCandles) {
        await this.edgeCheck();
        await this.cycle(this.candleStart(this.nowSec()));
      } else if (t.activeId) {
        await this.recheckSignal(t);
      }
    }

    // Only the option type changed (e.g. Forex back to Binary on the same chart): the arrow of the
    // open candle is checked again for the new selection, so the panel never shows an old reason,
    // and it is still bought if the entry window allows.
    async recheckSignal(t) {
      const ls = this.lastSignal;
      if (!ls || ls.decision === 0 || ls.traded) { this.changed(); return; }
      if (ls.from !== this.candleStart(this.nowSec())) { ls.note = ''; this.changed(); return; }
      await this.maybeTrade(ls.from, ls.decision, t);
    }

    // ---- Digital options --------------------------------------------------------
    // The traderoom's way: the asset's instruments (one per expiry) come from get-instruments and
    // instrument-generated; the price stream of each instrument that can still be bought gives
    // its payout.
    async startDigital(t) {
      const d = { activeId: t.activeId, period: t.candleSize, instruments: new Map(), payouts: new Map(), subscribed: new Set() };
      this.digital = d;
      this.client.subscribe(DIGITAL_INSTRUMENTS, { instrument_type: 'digital-option', asset_id: t.activeId }, '3.0');
      try {
        const list = await this.client.digitalInstruments(t.activeId);
        if (this.digital === d) list.forEach((inst) => this.addInstrument(inst));
      } catch (e) {
        this.log('Could not read the Digital options: ' + e.message);
      }
    }

    stopDigital() {
      const d = this.digital;
      if (!d) return;
      this.digital = null;
      this.client.unsubscribe(DIGITAL_INSTRUMENTS, { instrument_type: 'digital-option', asset_id: d.activeId }, '3.0');
      for (const index of d.subscribed) this.unsubscribePrices(d, index);
    }

    unsubscribePrices(d, index) {
      this.client.unsubscribe(DIGITAL_PRICES, { instrument_type: 'digital-option', asset_id: d.activeId, instrument_index: index }, '1.0');
    }

    addInstrument(inst) {
      const d = this.digital;
      if (!d || !inst || Number(inst.asset_id) !== d.activeId || Number(inst.period) !== d.period) return;
      const now = this.nowSec();
      for (const [index, old] of d.instruments) {
        if (old.expiration > now) continue;
        d.instruments.delete(index);
        d.payouts.delete(index);
        if (d.subscribed.delete(index)) this.unsubscribePrices(d, index);
      }
      if (inst.expiration <= now) return;
      d.instruments.set(inst.index, inst);
      if (!d.subscribed.has(inst.index)) {
        d.subscribed.add(inst.index);
        this.client.subscribe(DIGITAL_PRICES, { instrument_type: 'digital-option', asset_id: d.activeId, instrument_index: inst.index }, '1.0');
      }
    }

    onDigitalPrice(m) {
      const d = this.digital;
      if (!d || !m || Number(m.asset_id) !== d.activeId || !d.instruments.has(m.instrument_index)) return;
      const p = digitalPayouts(m);
      if (!p) return;
      d.payouts.set(m.instrument_index, p);
      const t = this.target;
      const low = Math.min(p.call, p.put);
      if (t && t.kind === 'digital' && Number.isFinite(low)) t.payout = low; // shown in the panel
    }

    // The Digital option that expires at `expiration` (the end of the candle to trade).
    digitalInstrument(expiration) {
      const d = this.digital;
      if (!d) return null;
      for (const inst of d.instruments.values()) if (inst.expiration === expiration) return inst;
      return null;
    }

    // Payout (%) of the option that would be bought for the candle opening at `from`.
    payoutFor(from, t, direction) {
      if (t.kind !== 'digital') return t.payout;
      const inst = this.digitalInstrument(from + t.candleSize);
      const p = inst && this.digital.payouts.get(inst.index);
      if (!p) return NaN;
      return direction ? p[direction] : Math.min(p.call, p.put);
    }

    breakEven(payout) {
      const p = payout === undefined && this.target ? this.target.payout : payout;
      return Number.isFinite(p) ? 100 / (100 + p) : NaN;
    }

    // The recent results of the arrows that are bought: all of them, or only the CALL or the PUT
    // ones (null when those were not measured apart yet).
    tradedEdge() {
      const e = this.edge;
      const d = this.settings.directions;
      return !e || d === 'both' ? e : e[d] || null;
    }

    // Replays the method over the followed asset's recent candles (the arrows of the chart) and
    // measures how often they won, like the chart's win / loss marks (entry at the candle open).
    // A learned logic is judged on its check candles instead: it was chosen on the recent candles,
    // so replaying it there would flatter it.
    async edgeCheck() {
      const t = this.target;
      if (!t || !t.activeId || this.edgeBusy) return;
      const learned = this.settings.useLearned ? this.learnedFor(t) : null;
      if (learned) {
        // Judged with the price 5 s after the open when measured; a logic that beats a coin flip
        // from the open but could not be measured that way is not trusted.
        const level = this.levelOf(learned);
        const late = level.late && level.late.n >= 30 ? level.late : null;
        const c = late || level.check;
        this.edgeAt = this.nowSec();
        this.edge = { wins: c.wins, n: c.n, rate: c.rate, lo: c.lo, hi: c.hi, candles: learned.parts.check, learned: true,
          late: !!late, unconfirmed: !late && level.check.n >= 30 && level.check.lo >= 0.5,
          call: c.call || null, put: c.put || null, // null: learned before CALL and PUT were counted apart
          coverage: Number.isFinite(level.check.coverage) ? level.check.coverage : null };
        this.changed();
        return;
      }
      this.edgeBusy = true;
      this.edgeAt = this.nowSec();
      try {
        let rows = [];
        let to = Math.floor(this.nowSec());
        while (rows.length < EDGE_CANDLES) {
          const list = await this.client.candles(t.activeId, t.candleSize, to, 1000);
          if (this.target !== t) return;
          const older = rows.length ? list.filter((c) => c.from < rows[0].from) : list;
          if (!older.length) break;
          rows = older.concat(rows);
          if (list.length < 1000) break;
          to = older[0].from - 1;
        }
        const engine = SignalEngine.createEngine(this.rules(t));
        let wins = 0, n = 0, cw = 0, cn = 0, fired = 0, previous = 0;
        for (const c of rows) {
          if (previous !== 0) {
            fired += 1;
            const move = Math.sign(c.close - c.open);
            if (move !== 0) {
              n += 1;
              if (move === previous) wins += 1;
              if (previous === 1) { cn += 1; if (move === 1) cw += 1; }
            }
          }
          previous = engine.update(engineCandle(c)).decision;
        }
        // Break-even follows the payout, which changes all the time on Digital (see breakEven()).
        this.edge = Object.assign(rateOf(wins, n), { candles: rows.length, call: rateOf(cw, cn), put: rateOf(wins - cw, n - cn),
          coverage: rows.length > 1 ? fired / (rows.length - 1) : null });
        const be = this.breakEven();
        const part = (w, k) => (k ? (100 * w / k).toFixed(1) + '% of ' + k : 'none');
        this.log('Last ' + rows.length.toLocaleString() + ' candles of ' + (t.name || 'this asset') + ': ' + n + ' arrows, ' +
          (n ? (100 * wins / n).toFixed(1) + '% won (CALL ' + part(cw, cn) + ', PUT ' + part(wins - cw, n - cn) + ')' : 'none') +
          (Number.isFinite(be) ? ' (break-even ' + (100 * be).toFixed(1) + '%).' : '.'));
      } catch (e) {
        this.edgeAt = this.nowSec() - EDGE_EVERY_SEC + 120; // try again in 2 minutes
        this.log('Could not measure the recent results: ' + e.message);
      } finally {
        this.edgeBusy = false;
        this.changed();
      }
    }

    targetLabel() {
      const t = this.target;
      if (!t || !t.activeId) return 'nothing';
      const name = t.name || ('asset ' + t.activeId);
      if (!t.kind) return name + ' (' + (TYPE_LABEL[t.activeType] || t.activeType) + ')';
      const expiry = t.kind === 'blitz' ? sizeLabel(t.candleSize) : 'to the end of the candle';
      return name + ' ' + KIND_LABEL[t.kind] + ', ' + sizeLabel(t.candleSize) + ' candles, expiry ' + expiry +
        (Number.isFinite(t.payout) ? ', payout ' + t.payout + '%' : '');
    }

    async refreshAsset() {
      const t = this.target;
      if (!t || !t.kind) return;
      this.assetCheckedAt = this.nowSec();
      try {
        if (t.kind === 'digital') {
          // Trading hours (from the cached schedule) only: the payout comes from the price stream.
          const info = await this.client.digitalAsset(t.activeId);
          if (info && this.target === t) Object.assign(t, { enabled: info.enabled, suspended: info.suspended });
          return;
        }
        const info = await this.client.assetInfo(t.activeId, t.kind, 0);
        if (info && this.target === t) Object.assign(t, { payout: info.payout, enabled: info.enabled, suspended: info.suspended });
      } catch (e) {
        this.log('Could not refresh the payout: ' + e.message);
      }
    }

    // ---- candle cycle ---------------------------------------------------------
    // Updates of the followed candles arrive about once a second. When a candle ends, IQ Option
    // sends its final update, stamped with the candle's end, about 0.1 s later: about 0.8 s before
    // the closed candle can be fetched, and with the same values (measured on 6 assets, 2 Nov 2026).
    // The next candle's arrow is decided from it at once.
    onCandle(m) {
      const t = this.target;
      if (!m || !t || m.active_id !== t.activeId || m.size !== t.candleSize) return;
      const c = { from: m.from, open: m.open, close: m.close, min: m.min, max: m.max };
      this.live = c;
      let next = m.from;
      if (isFinalUpdate(m)) {
        this.closing = c;
        next = m.from + t.candleSize;
      }
      if (next > this.cycleFrom) this.cycle(next);
      this.changed();
    }

    // Fallback when the final update is late: starts the decision 0.2 s after a candle opens on the
    // server clock (the decision then waits briefly for the final update, or fetches the candle).
    onClock() {
      if (this.status !== 'ready' || !this.client.sync || !this.target || !this.target.activeId) return;
      const now = this.nowSec();
      const current = this.candleStart(now);
      if (current > this.cycleFrom && now - current >= 0.2) this.cycle(current);
    }

    onTick() {
      if (this.status !== 'ready') return;
      const now = this.nowSec();
      if (now - this.layoutCheckedAt >= LAYOUT_EVERY_SEC) this.checkLayout(false);
      if (this.target && this.target.activeId) {
        const current = this.candleStart(now);
        // Fallback when neither the clock nor a tick has started the new candle.
        if (current > this.cycleFrom && now - current >= 2) this.cycle(current);
      }
      this.checkOverdueTrades(now);
      // Digital trading hours follow a schedule: check them every minute.
      if (now - this.assetCheckedAt >= (this.target && this.target.kind === 'digital' ? 60 : 600)) this.refreshAsset();
      if (this.target && this.target.activeId && now - this.edgeAt >= EDGE_EVERY_SEC) this.edgeCheck();
      // Fallback for balance changes that were not pushed (e.g. while reconnecting).
      if (now - (this.balancesAt || 0) >= BALANCE_EVERY_SEC) { this.balancesAt = now; this.refreshBalances(); }
      this.changed();
    }

    async cycle(from) {
      const t = this.target;
      if (!t || !t.activeId || from <= this.cycleFrom) return;
      this.cycleFrom = from;
      let decision;
      try {
        decision = await this.decide(from, t);
      } catch (e) {
        if (this.target !== t) return;
        this.lastSignal = { from, decision: 0, traded: false, note: 'no data: ' + e.message };
        this.log('Signal for ' + clock(from) + ' unavailable: ' + e.message);
        return;
      }
      if (this.target !== t) return; // the selection changed meanwhile
      this.lastSignal = { from, decision, traded: false, note: decision === 0 ? 'no arrow' : '', decidedAt: this.nowSec() };
      if (decision !== 0) this.log((decision > 0 ? 'CALL (higher)' : 'PUT (lower)') + ' arrow on the ' + clock(from) + ' candle.');
      this.changed();
      if (decision !== 0) await this.maybeTrade(from, decision, t);
      const check = this.closingCheck;
      if (check && check.from === from - t.candleSize) { this.closingCheck = null; this.checkFinalUpdate(check, t); }
    }

    // Decision for the candle opening at `from`, from the closed candles before it. The engine
    // is kept between candles: normally the candle that has just closed comes from its final live
    // update; otherwise only that candle is fetched.
    async decide(from, t) {
      const size = t.candleSize;
      const want = from - size;
      if (this.engine && this.engineLast === want - size) {
        const c = await this.finalUpdate(want, t);
        if (this.target !== t) throw new Error('selection changed');
        if (c && this.engine && this.engineLast === want - size) {
          this.engine.update(engineCandle(c));
          this.engineLast = want;
          this.lastClose = c.close;
          this.closingCheck = { from: want, candle: c };
          return this.engine.nextDecision;
        }
      }
      const missing = Math.round((want - this.engineLast) / size);
      if (!this.engine || missing < 0 || missing > HISTORY / 2) await this.rebuildEngine(from, t);
      else if (missing > 0) await this.feedEngine(from, missing, t);
      if (this.target !== t) throw new Error('selection changed');
      if (this.engineLast !== want) throw new Error('the previous candle has not closed on the server yet');
      return this.engine.nextDecision;
    }

    // The final live update of the candle opening at `want`, waiting up to about 0.75 s for it while
    // that candle's updates are coming in. null: it did not come (the closed candle is fetched instead).
    async finalUpdate(want, t) {
      for (let i = 0; ; i++) {
        if (this.closing && this.closing.from === want) return this.closing;
        if (i >= 5 || this.target !== t || !this.live || this.live.from !== want) return null;
        await this.pause(150);
      }
    }

    // A candle decided from its final update is compared with the closed candle IQ Option publishes
    // a moment later. Should they ever differ, the engine is rebuilt from the published candles.
    async checkFinalUpdate(check, t) {
      try {
        const list = await this.closedBefore(check.from + t.candleSize, 2, t);
        const pub = list.find((x) => x.from === check.from);
        const c = check.candle;
        if (this.target !== t || !pub) return;
        if (pub.open !== c.open || pub.close !== c.close || pub.min !== c.min || pub.max !== c.max) {
          this.log('The ' + clock(check.from) + ' candle was published with other values than its last live update: the signal is recomputed from the closed candles.');
          if (this.engineLast >= check.from) this.engine = null;
        }
      } catch (_) { /* compared again at the next candle */ }
    }

    // Closed candles before `from` (the newest is the previous candle), retrying briefly until the server has it.
    async closedBefore(from, count, t) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const list = (await this.client.candles(t.activeId, t.candleSize, Math.floor(this.nowSec()), count))
          .filter((c) => c.from < from);
        if (list.length && list[list.length - 1].from === from - t.candleSize) return list;
        await this.pause(250);
      }
      return [];
    }

    // Waits about `ms`, waking early on the next server message: timers are throttled in background
    // tabs (down to once a minute), WebSocket messages are not.
    pause(ms) {
      return new Promise((resolve) => {
        let done = false;
        const offs = [];
        const finish = () => {
          if (done) return;
          done = true;
          offs.forEach((off) => off());
          resolve();
        };
        offs.push(this.client.on('timeSync', finish), this.client.on('candle-generated', finish));
        this.setTimer(finish, ms);
      });
    }

    async rebuildEngine(from, t) {
      this.engine = null;
      this.engineLast = 0;
      const list = await this.closedBefore(from, HISTORY, t);
      if (this.target !== t) return;
      if (!list.length) throw new Error('the previous candle has not closed on the server yet');
      const rules = this.rules(t);
      const minHistory = rules.method === 'vote' ? SignalEngine.WARMUP + 1 : (Number(rules.brkCandles) || SignalEngine.BREAKOUT_CANDLES);
      if (list.length < minHistory) throw new Error('only ' + list.length + ' candles of history');
      const engine = SignalEngine.createEngine(rules);
      for (const c of list) engine.update(engineCandle(c));
      this.engine = engine;
      this.engineLast = list[list.length - 1].from;
      this.lastClose = list[list.length - 1].close;
    }

    async feedEngine(from, missing, t) {
      const list = await this.closedBefore(from, missing + 2, t);
      if (this.target !== t) return;
      if (!this.engine) return this.rebuildEngine(from, t); // the rules changed while waiting
      const fresh = list.filter((c) => c.from > this.engineLast);
      if (!fresh.length) return;
      if (fresh.length < missing && fresh[0].from !== this.engineLast + t.candleSize) return this.rebuildEngine(from, t);
      for (const c of fresh) this.engine.update(engineCandle(c));
      this.engineLast = fresh[fresh.length - 1].from;
      this.lastClose = fresh[fresh.length - 1].close;
    }

    // Every safety check; returns a reason to skip, or '' to trade.
    skipReason(from, target, direction) {
      const s = this.settings;
      const t = target || this.target;
      if (!s.enabled) return 'auto-trading is off';
      if (!t || !t.kind || t.reason) return (t && t.reason) || 'nothing to trade';
      const side = sideFilter(s, direction);
      if (side) return side;
      if (from <= (this.session.lastTradeFrom || 0) || this.trades.some((x) => x.from === from)) return 'already traded this candle';
      if (s.account === 'real' && !s.realConfirmed) return 'real money is not confirmed';
      const bal = this.balances[s.account];
      if (!bal) return 'no ' + s.account + ' balance';
      if (typeof bal.amount === 'number' && bal.amount < s.stake) return 'balance too low';
      const late = this.nowSec() - from;
      if (late > Math.min(s.entryWindowSec, t.candleSize / 2)) return 'too late (' + Math.round(late) + ' s after the open)';
      if (!t.enabled || t.suspended) return 'asset closed for trading';
      if (t.kind === 'digital') {
        const inst = this.digitalInstrument(from + t.candleSize);
        if (!inst) return 'no Digital option expiring at ' + clock(from + t.candleSize) + ' (closed now?)';
        if (this.nowSec() > inst.expiration - (Number(inst.deadtime) || 30)) return 'too late for this Digital option';
      }
      const payout = this.payoutFor(from, t, direction);
      if (!Number.isFinite(payout)) return 'payout not known yet';
      if (!(payout >= s.minPayout)) return 'payout ' + payout + '% below ' + s.minPayout + '%';
      if (s.requireEdge) {
        // Judged on the arrows that are bought: all of them, or only the CALL or the PUT ones.
        const all = this.edge;
        const e = this.tradedEdge();
        const what = s.directions === 'both' ? 'arrows' : SIDE_LABEL[s.directions] + ' arrows';
        const be = this.breakEven(payout);
        if (!all) return 'still measuring the recent results of this method here';
        if (all.unconfirmed) return 'the learned logic could not be checked with a realistic entry (5-second candles)';
        if (!e) return 'the ' + what + ' are measured apart at the next learning';
        if (!(e.lo >= be)) {
          return 'no proven edge here: ' + (e.n ? (100 * e.rate).toFixed(1) + '% of ' + e.n + ' recent ' + what + ' won' : 'no recent ' + what) +
            ', break-even ' + (100 * be).toFixed(1) + '%';
        }
      }
      const ses = this.session;
      if (ses.trades >= s.maxTrades) return 'session trade limit reached';
      if (ses.lossStreak >= s.maxLossStreak) return 'loss streak limit reached';
      if (s.maxSessionLoss > 0 && -ses.pnl >= s.maxSessionLoss) return 'session loss limit reached';
      return '';
    }

    async maybeTrade(from, decision, target) {
      const t = target || this.target;
      const direction = decision > 0 ? 'call' : 'put';
      if (t.kind === 'digital' && this.settings.enabled && this.digitalInstrument(from + t.candleSize)) {
        // Right after connecting, the price stream may not have sent the payout yet: wait a little.
        for (let i = 0; i < 12 && !Number.isFinite(this.payoutFor(from, t, direction)); i++) await this.pause(250);
        if (this.target !== t) return;
      }
      const reason = this.skipReason(from, t, direction);
      if (reason) {
        if (this.lastSignal && this.lastSignal.from === from) {
          this.lastSignal.note = 'not traded: ' + reason;
          // Left out on purpose (Buy: CALL only / PUT only), not a problem to report.
          this.lastSignal.filtered = reason === sideFilter(this.settings, direction) ? this.settings.directions : '';
        }
        if (this.settings.enabled) this.log('Not traded: ' + reason + '.');
        this.changed();
        return;
      }
      const s = this.settings;
      const inst = t.kind === 'digital' ? this.digitalInstrument(from + t.candleSize) : null;
      // Blitz: from the purchase second; bought right after the open, the server clock estimate may
      // still be a few milliseconds before it.
      const expiresAt = t.kind === 'blitz' ? Math.max(from, Math.floor(this.nowSec())) + t.candleSize : from + t.candleSize;
      const payout = this.payoutFor(from, t, direction);
      const trade = {
        from, exp: expiresAt, kind: t.kind, asset: t.name, direction, amount: s.stake, account: s.account, payout,
        status: 'sending', id: null, entry: null, result: null, pnl: 0,
      };
      this.trades.unshift(trade);
      this.trades.length = Math.min(this.trades.length, 50);
      this.session.trades += 1;
      this.session.lastTradeFrom = from;
      this.emit('session', this.session);
      const price = this.live && this.live.from === from ? this.live.close : this.lastClose;
      const after = Math.max(0, this.nowSec() - from); // seconds after the candle opened
      trade.sentAfter = after;
      try {
        if (inst) {
          // At the current price: the strike is the price when IQ Option fills the order.
          const spot = (inst.data || []).find((x) => x.strike === 'SPT' && x.direction === direction);
          const opened = await this.client.openDigital({
            balanceId: this.balances[s.account].id,
            activeId: t.activeId,
            instrumentId: spot ? spot.symbol : digitalSymbol(t.activeId, inst.expiration, inst.period, direction),
            instrumentIndex: inst.index,
            amount: s.stake,
          });
          trade.id = opened.id; // order id, listed in the position's order_ids
          trade.entry = price; // replaced by the fill price when the position opens
        } else {
          const opened = await this.client.openOption({
            kind: t.kind,
            balanceId: this.balances[s.account].id,
            activeId: t.activeId,
            direction,
            expiresAt,
            expirationSize: t.candleSize,
            amount: s.stake,
            price: price || 0,
            payout: t.payout,
          });
          trade.id = opened.id;
          trade.entry = opened.value;
          if (opened.exp) trade.exp = opened.exp;
        }
        trade.status = 'open';
        if (this.lastSignal && this.lastSignal.from === from) { this.lastSignal.traded = true; this.lastSignal.note = 'traded'; this.lastSignal.boughtAfter = after; }
        this.log('Bought ' + direction.toUpperCase() + ' ' + s.stake + ' ' + t.name + ' ' + KIND_LABEL[t.kind] + ' ' + after.toFixed(1) + ' s after the open' +
          (trade.entry ? ', at ' + trade.entry : '') + ', payout ' + payout + '%, expires ' + clock(trade.exp, true) + ' (' + s.account + ').');
        this.refreshBalances();
      } catch (e) {
        trade.status = 'failed';
        trade.result = 'error';
        this.session.trades -= 1;
        this.emit('session', this.session);
        if (this.lastSignal && this.lastSignal.from === from) this.lastSignal.note = 'order refused';
        this.log('Order refused: ' + e.message);
        this.refreshAsset();
      }
      this.changed();
    }

    // ---- results --------------------------------------------------------------
    onPosition(m) {
      this.trackPosition(m);
      if (m && m.instrument_type === 'digital-option') return this.onDigitalPosition(m);
      const ev = m && m.raw_event && (m.raw_event.binary_options_option_changed1 || m.raw_event.binary_options_option_changed);
      const id = ev ? ev.option_id : m && m.external_id;
      if (!id) return;
      const trade = this.trades.find((t) => t.id === id);
      if (!trade || trade.result) return;
      const result = ev && ev.result;
      if (m.status !== 'closed' && !['win', 'loose', 'lose', 'loss', 'equal'].includes(result)) return;
      const outcome = result === 'win' ? 'win' : result === 'equal' ? 'tie' : 'loss';
      this.settle(trade, outcome, ev && ev.expiration_value, false);
      this.refreshBalances();
    }

    // Digital positions list the order ids that opened them; the result is the position's P/L.
    onDigitalPosition(m) {
      const ev = (m.raw_event && m.raw_event.digital_options_position_changed1) || {};
      const orders = Array.isArray(ev.order_ids) ? ev.order_ids : [];
      const trade = this.trades.find((t) => t.kind === 'digital' && t.id !== null &&
        (orders.includes(t.id) || (t.positionId !== undefined && t.positionId === m.external_id)));
      if (!trade || trade.result) return;
      trade.positionId = m.external_id;
      const open = Number(m.open_quote !== undefined ? m.open_quote : ev.open_underlying_price);
      if (Number.isFinite(open) && open > 0) trade.entry = open;
      if (m.status !== 'closed') { this.changed(); return; }
      const pnl = Number(m.pnl_realized !== undefined ? m.pnl_realized : m.pnl);
      const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'tie';
      this.settle(trade, outcome, m.close_quote !== undefined ? m.close_quote : ev.close_underlying_price, false,
        Number.isFinite(pnl) ? pnl : undefined);
      this.refreshBalances();
    }

    // The server does not push balance changes to this connection, so they are read again
    // shortly after each buy and each result.
    refreshBalances() {
      if (this.balanceRefreshPending) return; // one read for a burst of events
      this.balanceRefreshPending = true;
      this.setTimer(async () => {
        this.balanceRefreshPending = false;
        if (this.stopped || this.status !== 'ready') return;
        try { await this.loadAccount(); this.balancesAt = this.nowSec(); this.changed(); } catch (_) { /* read again at the next event */ }
      }, BALANCE_REFRESH_MS);
    }

    // Every position event of the account, whoever opened the position: keeps the list of open
    // positions and announces 'position-closed' (with the asset id) when one ends. A position that
    // opens or closes moves the balance, so the balances are read again.
    trackPosition(m) {
      const key = m && (m.id !== undefined && m.id !== null ? m.id : m.external_id);
      if (key === undefined || key === null) return;
      if (m.status === 'open') {
        const raw = m.raw_event || {};
        const ev = raw.digital_options_position_changed1 || raw.binary_options_option_changed1 || {};
        const ends = Number(ev.instrument_expiration) / 1000 || Number(ev.expiration_time) || this.nowSec() + 900;
        if (!this.openPositions.has(key)) this.refreshBalances();
        this.openPositions.set(key, { activeId: Number(m.active_id), until: ends + 30 });
      } else if (this.openPositions.delete(key)) {
        this.refreshBalances();
        this.emit('position-closed', Number(m.active_id));
      }
    }

    hasOpenPosition(activeId) {
      const now = this.nowSec();
      for (const [key, p] of this.openPositions) {
        if (p.until < now) this.openPositions.delete(key); // its close was missed (disconnection)
        else if (p.activeId === Number(activeId)) return true;
      }
      return false;
    }

    // Results are normally pushed by the server. For a Binary option that ends with its candle,
    // a missing result is estimated from the candle close.
    async checkOverdueTrades(now) {
      for (const trade of this.trades) {
        if (trade.status !== 'open' || trade.result || now < trade.exp + 20 || trade.checking || trade.kind !== 'turbo') continue;
        const t = this.target;
        if (!t || t.name !== trade.asset) continue;
        trade.checking = true;
        try {
          const list = await this.client.candles(t.activeId, 60, Math.floor(now), 5);
          const candle = list.find((c) => c.from === trade.from);
          if (candle && typeof trade.entry === 'number') {
            const diff = candle.close - trade.entry;
            const won = trade.direction === 'call' ? diff > 0 : diff < 0;
            this.settle(trade, diff === 0 ? 'tie' : won ? 'win' : 'loss', candle.close, true);
          }
        } catch (_) { /* try again on the next tick */ }
        trade.checking = false;
      }
    }

    settle(trade, outcome, exitValue, estimated, pnl) {
      trade.result = outcome;
      trade.status = 'closed';
      trade.exit = exitValue;
      trade.estimated = !!estimated;
      trade.pnl = Number.isFinite(pnl) ? round2(pnl)
        : outcome === 'win' ? round2(trade.amount * trade.payout / 100) : outcome === 'loss' ? -trade.amount : 0;
      const ses = this.session;
      if (outcome === 'win') { ses.wins += 1; ses.lossStreak = 0; }
      else if (outcome === 'loss') { ses.losses += 1; ses.lossStreak += 1; }
      else ses.ties += 1;
      const side = ses.sides && ses.sides[trade.direction];
      if (side) side[outcome === 'win' ? 'wins' : outcome === 'loss' ? 'losses' : 'ties'] += 1;
      ses.pnl = round2(ses.pnl + trade.pnl);
      this.emit('session', ses);
      this.log(trade.direction.toUpperCase() + ' ' + clock(trade.from) + ': ' + outcome.toUpperCase() +
        (trade.pnl ? ' (' + (trade.pnl > 0 ? '+' : '') + trade.pnl + ')' : '') + (estimated ? ' (estimated)' : '') + '.');
      const s = this.settings;
      if (s.enabled) {
        if (ses.lossStreak >= s.maxLossStreak) this.stopTrading(ses.lossStreak + ' losses in a row.');
        else if (s.maxSessionLoss > 0 && -ses.pnl >= s.maxSessionLoss) this.stopTrading('session loss limit (' + s.maxSessionLoss + ') reached.');
        else if (ses.trades >= s.maxTrades) this.stopTrading('session trade limit (' + s.maxTrades + ') reached.');
      }
      this.changed();
    }

    // ---- state for the panel --------------------------------------------------
    getState() {
      const now = this.client.serverTimeMs() / 1000;
      const size = this.size;
      return {
        status: this.status,
        statusText: this.statusText,
        settings: this.settings,
        session: this.session,
        balances: this.balances,
        target: this.target,
        targetLabel: this.targetLabel(),
        // breakEven follows the current payout (NaN until a Digital payout is known).
        edge: this.edge ? Object.assign({}, this.edge, { breakEven: this.breakEven() }) : null,
        live: this.live,
        lastSignal: this.lastSignal,
        nextCandleIn: Math.max(0, Math.ceil((Math.floor(now / size) + 1) * size - now)),
        trades: this.trades.slice(0, 10),
        log: this.logLines.slice(0, 30),
        rules: this.rules(),
        learnedHere: this.settings.useLearned ? this.learnedView() : null,
        frequencies: FREQUENCIES,
        learning: this.learning,
        learnedCount: Object.keys(this.learned).length,
        best: this.bestLearned(5),
        chart: this.chart || null,
      };
    }

    // Assets whose learned logic (at the chosen frequency) did best on its check candles (lower end
    // of the 95% range first), with the price 5 s after the open where that was measured.
    bestLearned(count) {
      const judged = (lv) => (lv.late && lv.late.n >= 30 ? lv.late : lv.check);
      return Object.values(this.learned)
        .filter((r) => r && r.check && !r.tooShort)
        .map((r) => ({ r, lv: this.levelOf(r) }))
        .filter(({ lv }) => lv && lv.check && judged(lv).n >= 30)
        .sort((a, b) => judged(b.lv).lo - judged(a.lv).lo)
        .slice(0, count)
        .map(({ r, lv }) => {
          const c = judged(lv);
          return { name: r.name, size: r.size, rate: c.rate, n: c.n, lo: c.lo, hi: c.hi, reached: r.reached && c.rate >= r.target,
            late: c === lv.late, open: lv.check.rate };
        });
    }
  }

  function engineCandle(c) {
    return { open: c.open, high: c.max, low: c.min, close: c.close, from: c.from };
  }

  // A candle's final update: its time (`at`, in nanoseconds) is the candle's end (`to`, in seconds).
  function isFinalUpdate(m) {
    const at = Number(m.at), to = Number(m.to);
    return Number.isFinite(at) && to > 0 && at >= to * 1e9 - 1e6;
  }

  function clock(sec, seconds) {
    const d = new Date(sec * 1000);
    return d.toLocaleTimeString([], seconds ? { hour12: false } : { hour12: false, hour: '2-digit', minute: '2-digit' });
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  return { AutoTrader, DEFAULT_SETTINGS, clampSettings, KIND_OF, FREQUENCIES, frequencyLabel, digitalPayouts, digitalSymbol };
});

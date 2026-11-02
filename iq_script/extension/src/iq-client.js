/*
 * Minimal IQ Option WebSocket client used by the extension (its own connection, separate
 * from the traderoom's). Message formats were taken from the traderoom's own traffic:
 *   authenticate {ssid, protocol: 3}                      -> authenticated true
 *   sendMessage {name, version, body}  (request_id)       -> reply with the same request_id
 *   subscribeMessage {name, version, params: {routingFilters}}
 *   timeSync <server ms> every second
 * Digital options use the digital-option-instruments, trading-settings and digital-options
 * services (see the Digital section below).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMIqClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_URL = 'wss://ws.iqoption.com/echo/websocket';

  class IqClient {
    constructor(options) {
      const o = options || {};
      this.url = o.url || DEFAULT_URL;
      this.getSsid = o.getSsid;
      this.getTranslations = o.getTranslations || null; // async () => {'desktop.EURUSD-OTC': 'EUR/USD (OTC)', ...}
      this.WebSocketImpl = o.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
      this.now = o.now || (() => Date.now());
      this.ws = null;
      this.seq = 0;
      this.pending = new Map();
      this.handlers = new Map();
      this.sync = null; // { server, local }
      this.authenticated = false;
      this.started = this.now();
    }

    on(name, fn) {
      if (!this.handlers.has(name)) this.handlers.set(name, new Set());
      this.handlers.get(name).add(fn);
      return () => this.handlers.get(name).delete(fn);
    }

    emit(name, payload) {
      const set = this.handlers.get(name);
      if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { this.emit('error', e); } }
    }

    // Server time in milliseconds (local clock until the first timeSync arrives).
    serverTimeMs() {
      return this.sync ? this.sync.server + (this.now() - this.sync.local) : this.now();
    }

    localTime() { return Math.max(0, Math.round(this.now() - this.started)); }

    connect(timeoutMs) {
      const limit = timeoutMs || 15000;
      this.close();
      const ssid = this.getSsid && this.getSsid();
      if (!ssid) return Promise.reject(new Error('Not logged in: the ssid cookie is missing.'));
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) { this.close(); reject(err); } else resolve();
        };
        const timer = setTimeout(() => done(new Error('Connection timed out.')), limit);
        const ws = new this.WebSocketImpl(this.url);
        this.ws = ws;
        ws.onopen = () => {
          const authId = 'nmat_auth_' + (++this.seq);
          this.pending.set(authId, {
            resolve: (m) => {
              if (m.msg === true) {
                this.authenticated = true;
                this.send({ name: 'setOptions', request_id: 'nmat_' + (++this.seq), local_time: this.localTime(), msg: { sendResults: true } });
                this.emit('open');
                done();
              } else {
                done(new Error('Authentication failed (log in to IQ Option again).'));
              }
            },
            reject: done,
          });
          this.send({ name: 'authenticate', request_id: authId, local_time: this.localTime(),
            msg: { ssid, protocol: 3, session_id: '', client_session_id: '' } });
        };
        ws.onmessage = (ev) => this.onMessage(ev.data);
        ws.onerror = () => done(new Error('WebSocket error.'));
        ws.onclose = () => {
          const wasOpen = this.authenticated;
          this.authenticated = false;
          if (this.ws === ws) this.ws = null;
          for (const [, p] of this.pending) p.reject(new Error('Connection closed.'));
          this.pending.clear();
          done(new Error('Connection closed before authentication.'));
          if (wasOpen) this.emit('close');
        };
      });
    }

    onMessage(raw) {
      let m;
      try { m = JSON.parse(raw); } catch (_) { return; }
      if (m.name === 'timeSync') {
        this.sync = { server: Number(m.msg), local: this.now() };
        this.emit('timeSync', this.sync.server);
        return;
      }
      const p = m.request_id !== undefined ? this.pending.get(String(m.request_id)) : undefined;
      if (p) {
        const failed = (m.name === 'result' && m.msg && m.msg.success === false) ||
          (typeof m.status === 'number' && m.status >= 4000) ||
          (m.name === 'authenticated' && m.msg !== true);
        if (failed && m.name !== 'authenticated') {
          this.pending.delete(String(m.request_id));
          p.reject(new Error(describeError(m)));
          return;
        }
        // "result" only acknowledges the request; wait for the real reply.
        if (m.name !== 'result' || p.acceptResult) {
          this.pending.delete(String(m.request_id));
          p.resolve(m);
          return;
        }
      }
      this.emit(m.name, m.msg);
    }

    send(obj) {
      if (!this.ws || this.ws.readyState !== 1) throw new Error('Not connected.');
      this.ws.send(JSON.stringify(obj));
    }

    request(name, version, body, options) {
      const o = options || {};
      const id = 'nmat_' + (++this.seq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pending.delete(id)) reject(new Error(name + ': no reply.'));
        }, o.timeoutMs || 15000);
        this.pending.set(id, {
          acceptResult: !!o.acceptResult,
          resolve: (m) => { clearTimeout(timer); resolve(m); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        try {
          this.send({ name: 'sendMessage', request_id: id, local_time: this.localTime(), msg: { name, version, body } });
        } catch (e) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(e);
        }
      });
    }

    subscribe(name, routingFilters, version) {
      const msg = { name };
      if (routingFilters) msg.params = { routingFilters };
      if (version) msg.version = version;
      this.send({ name: 'subscribeMessage', request_id: 's_nmat_' + (++this.seq), local_time: this.localTime(), msg });
    }

    unsubscribe(name, routingFilters, version) {
      const msg = { name };
      if (routingFilters) msg.params = { routingFilters };
      if (version) msg.version = version;
      try {
        this.send({ name: 'unsubscribeMessage', request_id: 's_nmat_' + (++this.seq), local_time: this.localTime(), msg });
      } catch (_) { /* not connected: nothing to unsubscribe */ }
    }

    close() {
      const ws = this.ws;
      this.ws = null;
      this.authenticated = false;
      if (ws) {
        ws.onclose = null; ws.onmessage = null; ws.onerror = null; ws.onopen = null;
        try { ws.close(); } catch (_) { /* already closed */ }
      }
      for (const [, p] of this.pending) p.reject(new Error('Connection closed.'));
      this.pending.clear();
    }

    // ---- IQ Option calls used by the trader -------------------------------------------

    async balances() {
      const m = await this.request('internal-billing.get-balances', '1.0', { types_ids: [1, 4, 2], tournaments_statuses_ids: [3, 2] });
      return Array.isArray(m.msg) ? m.msg : [];
    }

    // Closed candles, oldest first: [{from, to, open, close, min, max}].
    async candles(activeId, size, toSec, count) {
      const m = await this.request('get-candles', '2.0', { active_id: activeId, size, to: toSec, count, only_closed: true });
      const list = (m.msg && m.msg.candles) || [];
      return list.slice().sort((a, b) => a.from - b.from);
    }

    // The traderoom's selection, saved by the traderoom in the traderoom_gl_grid user setting:
    // {activeId, activeType ('turbo-option', 'blitz-option', ...), candleSize (seconds)}.
    async layout() {
      const m = await this.request('get-user-settings', '1.0', { configs: [{ name: 'traderoom_gl_grid', version: 2 }] });
      const entry = m.msg && Array.isArray(m.msg.configs) ? m.msg.configs.find((c) => c.name === 'traderoom_gl_grid') : null;
      return parseLayout(entry && entry.config);
    }

    async initData() {
      if (!this.initCache || this.now() - this.initCache.at > 600000) {
        const m = await this.request('get-initialization-data', '4.0', {}, { timeoutMs: 30000 });
        this.initCache = { at: this.now(), data: m.msg || {} };
      }
      return this.initCache.data;
    }

    // The traderoom's translations, which turn the assets' names ("front.SATSUSD-OTC") into what the
    // traderoom shows ("1000Sats (OTC)"). Kept 6 hours; an empty table when they cannot be read
    // (then asked again after 10 minutes).
    translations() {
      const c = this.trCache;
      if (!c || this.now() - c.at > (c.ok === false ? 600000 : 6 * 3600000)) {
        const entry = { at: this.now(), ok: undefined, promise: null };
        entry.promise = Promise.resolve()
          .then(() => (this.getTranslations ? this.getTranslations() : null))
          .then((table) => {
            entry.ok = !!table && typeof table === 'object' && Object.keys(table).length > 0;
            return entry.ok ? table : {};
          }, () => { entry.ok = false; return {}; });
        this.trCache = entry;
      }
      return this.trCache.promise;
    }

    // Display name of any asset, as the traderoom shows it ("USD/JPY (OTC)"), from the lists of
    // assets: Binary, Blitz and Digital first; Forex / CFD / crypto only for an asset not found there.
    // Cached for 10 minutes.
    async assetName(activeId) {
      const id = Number(activeId);
      if (!this.namesCache || this.now() - this.namesCache.at > 600000) {
        this.namesCache = { at: this.now(), names: new Map(), built: false, marginal: false };
      }
      const cache = this.namesCache;
      const add = (key, name) => { if (name && !cache.names.has(Number(key))) cache.names.set(Number(key), name); };
      const tr = await this.translations();
      if (!cache.built) {
        cache.built = true;
        const data = await this.initData().catch(() => ({}));
        for (const kind of ['turbo', 'binary', 'blitz']) {
          const section = data[kind];
          for (const [key, a] of Object.entries((section && section.actives) || {})) add(key, activeName(a, key, tr));
        }
        for (const u of (this.digitalCache && this.digitalCache.list) || []) add(u.active_id, underlyingName(u, tr));
      }
      if (!cache.names.has(id) && !cache.marginal) {
        cache.marginal = true;
        const lists = [
          ['digital-option-instruments.get-underlying-list', '3.0', { filter_suspended: true }, (msg) => msg.underlying],
          ['marginal-forex-instruments.get-underlying-list', '1.0', {}, (msg) => msg.items],
          ['marginal-cfd-instruments.get-underlying-list', '1.0', {}, (msg) => msg.items],
          ['marginal-crypto-instruments.get-underlying-list', '1.0', {}, (msg) => msg.items],
        ];
        await Promise.all(lists.map(async ([name, version, body, items]) => {
          try {
            const m = await this.request(name, version, body, { timeoutMs: 15000 });
            for (const u of items(m.msg || {}) || []) add(u.active_id, underlyingName(u, tr));
          } catch (_) { /* that list is unavailable: the others still name most assets */ }
        }));
      }
      return cache.names.get(id) || '';
    }

    // Option settings of one asset for kind 'turbo' (Binary) or 'blitz':
    // {name, enabled, suspended, payout (%), expirations (seconds)}. The data is cached.
    async assetInfo(activeId, kind, maxAgeMs) {
      const maxAge = maxAgeMs === undefined ? 600000 : maxAgeMs;
      if (!this.initCache || this.now() - this.initCache.at > maxAge) this.initCache = null;
      const data = await this.initData();
      const tr = await this.translations();
      let section = data[kind];
      let a = section && section.actives && section.actives[String(activeId)];
      // Some assets have their Binary options only in the "binary" list (15 minutes or more).
      if (!a && kind === 'turbo') {
        section = data.binary;
        a = section && section.actives && section.actives[String(activeId)];
      }
      if (!a) return null;
      const opt = a.option || {};
      const commission = opt.profit ? Number(opt.profit.commission) : NaN;
      return {
        name: activeName(a, activeId, tr),
        enabled: !!a.enabled,
        suspended: !!a.is_suspended,
        payout: 100 - commission,
        expirations: Array.isArray(opt.expiration_times) ? opt.expiration_times.map(Number) : [],
      };
    }

    // Assets that can be traded right now with a 1-minute option (Binary, Blitz 1 min or Digital):
    // [{activeId, name, kinds}]. Used to learn every asset one by one.
    async tradableAssets() {
      const data = await this.initData();
      const tr = await this.translations();
      const byId = new Map();
      const add = (id, name, kind) => {
        const key = Number(id);
        const entry = byId.get(key) || { activeId: key, name, kinds: [] };
        if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
        byId.set(key, entry);
      };
      for (const kind of ['turbo', 'blitz']) {
        const section = data[kind];
        for (const a of Object.values((section && section.actives) || {})) {
          if (!a.enabled || a.is_suspended) continue;
          const expiries = ((a.option && a.option.expiration_times) || []).map(Number);
          if (kind === 'blitz' && !expiries.includes(60)) continue;
          add(a.id, activeName(a, a.id, tr), kind);
        }
      }
      try {
        if (!this.digitalCache || this.now() - this.digitalCache.at > 600000) {
          const m = await this.request('digital-option-instruments.get-underlying-list', '3.0', { filter_suspended: true });
          this.digitalCache = { at: this.now(), list: (m.msg && m.msg.underlying) || [] };
        }
        const now = this.serverTimeMs() / 1000;
        for (const u of this.digitalCache.list) {
          const open = (u.schedule || []).some((s) => now >= s.open && now < s.close);
          if (!u.is_enabled || u.is_suspended || !open) continue;
          const known = byId.get(Number(u.active_id));
          add(u.active_id, known ? known.name : underlyingName(u, tr), 'digital');
        }
      } catch (_) { /* Digital list unavailable: Binary and Blitz assets only */ }
      return [...byId.values()];
    }

    // Buys a Binary (turbo, option_type_id 3) or Blitz (option_type_id 12) option, with the same
    // request as the traderoom's HIGHER / LOWER buttons.
    async openOption({ kind, balanceId, activeId, direction, expiresAt, expirationSize, amount, price, payout }) {
      const body = {
        user_balance_id: balanceId,
        active_id: activeId,
        option_type_id: kind === 'blitz' ? 12 : 3,
        direction,
        expired: expiresAt,
        refund_value: 0,
        price: amount,
        value: Math.round(price * 1e6),
        profit_percent: payout,
      };
      if (kind === 'blitz') body.expiration_size = expirationSize;
      const m = await this.request('binary-options.open-option', '2.0', body, { timeoutMs: 10000 });
      return m.msg;
    }

    // ---- Digital options ------------------------------------------------------------
    // An asset's Digital trading hours: {name, enabled (open now), suspended, payout: NaN,
    // expirations}. The payout of Digital options changes all the time: it comes from the
    // price stream (digitalPayouts). The list of Digital assets is cached.
    async digitalAsset(activeId, maxAgeMs) {
      const maxAge = maxAgeMs === undefined ? 600000 : maxAgeMs;
      if (!this.digitalCache || this.now() - this.digitalCache.at > maxAge) {
        const m = await this.request('digital-option-instruments.get-underlying-list', '3.0', { filter_suspended: true });
        this.digitalCache = { at: this.now(), list: (m.msg && m.msg.underlying) || [] };
      }
      const u = this.digitalCache.list.find((x) => Number(x.active_id) === Number(activeId));
      if (!u) return null;
      const now = this.serverTimeMs() / 1000;
      const open = (u.schedule || []).some((s) => now >= s.open && now < s.close);
      let name = '';
      try { name = await this.assetName(activeId); } catch (_) { /* named from the Digital list below */ }
      if (!name) name = underlyingName(u, await this.translations());
      return { name, enabled: !!u.is_enabled && open, suspended: !!u.is_suspended, payout: NaN, expirations: [60, 300, 900] };
    }

    // Digital instruments of an asset: [{index, expiration (s), period (s), deadtime (s), data: [{strike, symbol, direction}]}].
    async digitalInstruments(activeId) {
      const m = await this.request('digital-option-instruments.get-instruments', '3.0', { instrument_type: 'digital-option', asset_id: activeId });
      return (m.msg && m.msg.instruments) || [];
    }

    // Buys a Digital option at the current price ("SPT" strike), like the traderoom:
    // returns {id} (the order id; the position events list it in order_ids).
    async openDigital({ balanceId, activeId, instrumentId, instrumentIndex, amount }) {
      const m = await this.request('digital-options.place-digital-option', '3.0', {
        user_balance_id: balanceId,
        instrument_id: instrumentId,
        amount: String(amount),
        instrument_index: instrumentIndex,
        asset_id: activeId,
      }, { timeoutMs: 10000 });
      return m.msg;
    }

    // ---- chart scripts in the account (Indicators > Scripts) ---------------------------
    // [{id, script}]: the user's scripts with their code.
    async scripts() {
      const m = await this.request('tech-instruments.get-script-indicators', '1.0', { locale: 'en_US' }, { timeoutMs: 20000 });
      return Array.isArray(m.msg) ? m.msg : [];
    }

    // Saves the code of script `id` (the same request as the script editor's Save). The chart
    // shows the new code after the traderoom page is reloaded.
    async saveScript(id, script) {
      const m = await this.request('tech-instruments.save-script-indicator', '1.0', { locale: 'en_US', script, id }, { timeoutMs: 20000 });
      return m.msg;
    }
  }

  // {activeId, activeType, candleSize} from a traderoom_gl_grid config (null when unknown).
  function parseLayout(cfg) {
    if (!cfg) return null;
    const plotters = Array.isArray(cfg.plotters) ? cfg.plotters : [];
    const first = plotters[0] || {};
    const activeId = cfg.selectedActiveId !== undefined ? cfg.selectedActiveId : first.activeId;
    const activeType = cfg.selectedActiveType || first.activeType || '';
    if (activeId === undefined || activeId === null) return null;
    const plotter = plotters.find((p) => p.activeId === activeId && p.activeType === activeType) ||
      plotters.find((p) => p.activeId === activeId) || first;
    return { activeId: Number(activeId), activeType: String(activeType), candleSize: Number(plotter.candleDuration) || 60 };
  }

  // The traderoom's text for an asset's name key: "front.SATSUSD-OTC" or "SATSUSD-OTC" ->
  // "1000Sats (OTC)" ('' when the translations do not have it).
  function translated(tr, key) {
    if (!tr || !key) return '';
    const text = tr['desktop.' + String(key).replace(/^(front|desktop)\./, '')];
    return typeof text === 'string' ? text.trim() : '';
  }

  // Name of an asset of the Digital or Forex / CFD / crypto lists, e.g. "EUR/USD", "USD/JPY (OTC)".
  function underlyingName(u, tr) {
    const shown = translated(tr, u.localization_key) || translated(tr, u.name);
    if (shown) return shown;
    if (u.currency_left_side && u.currency_right_side) {
      return u.currency_left_side + '/' + u.currency_right_side + (/OTC/i.test(String(u.name || u.ticker || '')) ? ' (OTC)' : '');
    }
    const raw = String(u.localization_key || u.name || u.underlying || u.ticker || u.active_id || '');
    return raw.replace(/^front\./, '').replace(/-op$/, '').replace(/[-_]OTC$/i, ' (OTC)');
  }

  // Display name of an asset of the initialization data, e.g. "EUR/USD (OTC)": the translation of
  // its name, as in the traderoom (its description is sometimes another text, e.g. "EUR/USD ×1000").
  function activeName(a, activeId, tr) {
    const shown = translated(tr, a.name) || translated(tr, a.description);
    if (shown) return shown;
    let name = String(a.description || a.name || activeId).replace(/^front\./, '').replace(/[-_]OTC$/i, ' (OTC)');
    // Some OTC assets are named like the real market (CARDANO (OTC) is "ADAUSD").
    if (a.provider === 'OTC' && !/OTC/i.test(name)) name += ' (OTC)';
    return name;
  }

  function describeError(m) {
    const msg = m.msg || {};
    const text = msg.message || msg.errorMessage || msg.error || (Array.isArray(msg.message) ? msg.message.join(', ') : '') ||
      (typeof msg === 'string' ? msg : '');
    return (m.name || 'request') + ' refused' + (text ? ': ' + text : '') + (m.status ? ' (' + m.status + ')' : '');
  }

  return { IqClient, DEFAULT_URL, parseLayout };
});

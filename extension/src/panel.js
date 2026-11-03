/*
 * On-page control panel for the auto trader (Shadow DOM, so the traderoom's styles and hotkeys do
 * not interfere). createPanel(handlers) -> { render(state), toggle(), destroy(), el }.
 * handlers: onSettings(patch), onResetSession(), onLearnNow(), onReloadChart(), onExit().
 */
(function (root) {
  'use strict';

  const CSS = `
:host { all: initial; }
.panel { position: fixed; left: 96px; top: 150px; width: 300px; z-index: 2147483000;
  font: 12px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #e8e8ea;
  background: rgba(24, 25, 28, 0.97); border: 1px solid #3a3b40; border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,.5); user-select: none; }
.panel.min .body { display: none; }
[hidden] { display: none !important; }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: move; border-bottom: 1px solid #333439; }
.title { font-weight: 600; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #888; display: inline-block; }
.dot.ready { background: #2cac40; } .dot.connecting { background: #e5a50a; } .dot.error { background: #db4931; }
.dot.standby { background: #56ceff; }
.iconbtn { background: none; border: 0; color: #aaa; cursor: pointer; font-size: 15px; padding: 0 3px; line-height: 1; }
.iconbtn:hover { color: #fff; }
.iconbtn.exit.armed { color: #fff; background: #db4931; border-radius: 4px; font-size: 11px; padding: 2px 6px; }
.body { padding: 10px; overflow-y: auto; }
.asset { font-size: 14px; font-weight: 600; }
.muted { color: #9a9ba1; }
.small { font-size: 11px; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0 8px; }
.card { background: #202126; border: 1px solid #303137; border-radius: 8px; padding: 8px; }
.card .label { color: #9a9ba1; font-size: 11px; }
.card .big { font-size: 22px; font-weight: 700; margin: 2px 0; }
.sides { margin-top: 4px; padding-top: 4px; border-top: 1px solid #303137; font-size: 11px; }
.sides div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sides .off { opacity: .4; }
.dirs { gap: 4px; }
.dirs input { display: none; }
.dirs label { padding: 2px 7px; border: 1px solid #44464d; border-radius: 4px; }
.dirs label.sel { border-color: #56ceff; background: rgba(86, 206, 255, .14); font-weight: 600; }
.good { color: #2cac40; } .bad { color: #ff8a73; } .call { color: #2cac40; } .put { color: #db4931; }
.why { padding: 6px 8px; border-radius: 6px; margin-bottom: 8px; font-size: 11.5px; }
.why.warn { background: rgba(219, 73, 49, .14); color: #ffb3a3; }
.why.ok { background: rgba(44, 172, 64, .14); color: #9be3a6; }
.why.muted { background: #202126; color: #9a9ba1; }
.toggle { width: 100%; margin: 2px 0 8px; padding: 9px; border: 0; border-radius: 6px; cursor: pointer;
  font-weight: 700; letter-spacing: .3px; background: #44464d; color: #fff; font-size: 13px; }
.toggle.on { background: #2cac40; } .toggle.real.on { background: #db4931; }
.toggle:disabled { opacity: .5; cursor: not-allowed; }
.row { display: flex; align-items: center; gap: 8px; margin: 5px 0; flex-wrap: wrap; }
label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
input[type=number], select { width: 56px; background: #111214; color: #fff; border: 1px solid #44464d;
  border-radius: 4px; padding: 2px 4px; font: inherit; }
select { width: 130px; }
select.wide { width: auto; flex: 1; min-width: 0; }
input[type=checkbox], input[type=radio] { margin: 0; }
.real-box { border: 1px solid #db4931; border-radius: 6px; padding: 4px 6px; margin: 4px 0; color: #ff8a73; }
.section { margin-top: 10px; padding-top: 8px; border-top: 1px solid #333439; }
.section-title { font-weight: 600; margin-bottom: 4px; }
.btn { background: #2b5f9e; color: #fff; border: 0; border-radius: 5px; padding: 5px 10px; cursor: pointer; font: inherit; font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.btn.secondary { background: #44464d; }
.bar { height: 6px; background: #303137; border-radius: 3px; overflow: hidden; margin-top: 4px; }
.bar > div { height: 100%; background: #56ceff; width: 0; transition: width .3s; }
details { margin-top: 8px; } summary { cursor: pointer; color: #c9cad0; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; margin-top: 6px; }
.sub { color: #9a9ba1; font-size: 11px; margin-top: 8px; grid-column: 1 / -1; }
.list { max-height: 110px; overflow-y: auto; margin-top: 3px; font-family: Consolas, monospace; font-size: 11px; }
.list div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.win { color: #2cac40; } .loss { color: #db4931; } .tie { color: #c7cad1; }
button.link { background: none; border: 0; color: #56ceff; cursor: pointer; padding: 0; font: inherit; }
`;

  const HTML = `
<div class="panel">
  <div class="head">
    <span class="dot"></span><span class="title">Next Minute Auto Trader</span>
    <button class="iconbtn" data-act="min" title="Minimise">&#8211;</button>
    <button class="iconbtn exit" data-act="exit" title="Exit: stop everything and close the panel (the toolbar icon starts it again)">&#x23FB;</button>
  </div>
  <div class="body">
    <div class="asset" data-f="asset"></div>
    <div class="muted small" data-f="status"></div>
    <div class="cards">
      <div class="card"><div class="label" data-f="rateLabel">Win rate here</div><div class="big" data-f="rate">-</div><div class="small muted" data-f="rateNote"></div>
        <div class="sides" data-f="sides" hidden><div data-f="rateCall"></div><div data-f="ratePut"></div></div></div>
      <div class="card"><div class="label" data-f="signalLabel">This candle</div><div class="big" data-f="signal">-</div><div class="small muted" data-f="signalNote"></div></div>
    </div>
    <div class="why muted" data-f="why"></div>
    <button class="toggle" data-act="toggle">AUTO-TRADE: OFF</button>
    <div class="row dirs" title="Which arrows auto-trade buys">
      <span>Buy</span>
      <label title="Buy the CALL and the PUT arrows"><input type="radio" name="dir" value="both">Both</label>
      <label class="call" title="Buy only the CALL (higher) arrows"><input type="radio" name="dir" value="call">&#9650; CALL only</label>
      <label class="put" title="Buy only the PUT (lower) arrows"><input type="radio" name="dir" value="put">&#9660; PUT only</label>
    </div>
    <div class="row" title="How often arrows come: the learned logic of each asset for that frequency. More arrows cost win rate (shown for this asset).">
      <span>Arrows</span><select class="wide" data-s="frequency"></select>
    </div>
    <div class="row">
      <label><input type="radio" name="acct" value="practice"> Practice <span class="muted" data-f="practice"></span></label>
      <label><input type="radio" name="acct" value="real"> Real <span class="muted" data-f="real"></span></label>
    </div>
    <div class="real-box" data-f="realbox" hidden>
      <label><input type="checkbox" data-s="realConfirmed"> I accept trading with REAL money</label>
    </div>
    <div class="row"><span>Stake</span><input type="number" min="1" step="1" data-s="stake"><span class="muted small" data-f="session"></span></div>
    <div class="why warn" data-f="stop" hidden></div>

    <div class="section">
      <div class="section-title">Logic for this asset</div>
      <div data-f="logic"></div>
      <div class="small muted" data-f="compare"></div>
      <div class="row"><button class="btn" data-act="learn">Learn now</button><span class="small muted" data-f="learnState"></span></div>
      <div class="bar" data-f="barBox" hidden><div data-f="bar"></div></div>
      <div class="small" data-f="chart"></div>
      <div class="row" data-f="reloadRow" hidden><button class="btn secondary" data-act="reload">Reload chart</button></div>
    </div>

    <details>
      <summary>Settings</summary>
      <div class="grid">
        <span>Buy within (s after open)</span><input type="number" min="1" max="25" step="1" data-s="entryWindowSec">
        <span>Minimum payout (%)</span><input type="number" min="0" max="100" step="1" data-s="minPayout">
        <span>Stop after trades</span><input type="number" min="1" step="1" data-s="maxTrades">
        <span>Stop after losses in a row</span><input type="number" min="1" step="1" data-s="maxLossStreak">
        <span>Stop at session loss</span><input type="number" min="0" step="1" data-s="maxSessionLoss">
        <span title="Trade only where the logic's win rate is surely above break-even (low end of its 95% range)">Only trade where it has an edge</span><input type="checkbox" data-s="requireEdge">
        <div class="sub">Learning</div>
        <span>Use the learned logic for each asset</span><input type="checkbox" data-s="useLearned">
        <span>Learn all open assets in the background</span><input type="checkbox" data-s="learnAll">
        <span>Candles to learn from</span><input type="number" min="2000" max="60000" step="1000" data-s="learnCandles">
        <span>Target win rate (%)</span><input type="number" min="51" max="99" step="1" data-s="target">
        <div class="sub">Manual rules (where nothing is learned)</div>
        <span>Signal method</span><select data-r="method"><option value="breakout">Breakout momentum</option><option value="vote">15-strategy vote</option></select>
        <span>Breakout: candles</span><input type="number" min="1" max="60" step="1" data-r="brkCandles">
        <span>Breakout: close within (%)</span><input type="number" min="0" max="50" step="1" data-r="brkZone">
        <span>Breakout: minimum body (%)</span><input type="number" min="0" max="90" step="1" data-r="brkBody">
        <span>Reverse the arrows</span><input type="checkbox" data-r="reverse">
        <span>Vote: minimum score</span><input type="number" min="0.05" max="1" step="0.05" data-r="minScore">
        <span>Vote: minimum agreeing</span><input type="number" min="1" max="15" step="1" data-r="minAgree">
        <span>Vote: evidence gate</span><input type="checkbox" data-r="useGate">
        <span>Vote: evidence window</span><input type="number" min="100" max="5000" step="1" data-r="gateWindow">
        <span>Vote: evidence z-score</span><input type="number" min="0.5" max="5" step="0.1" data-r="gateZ">
      </div>
    </details>
    <details>
      <summary>Trades &amp; activity</summary>
      <div class="row small"><span data-f="sessionLong"></span><button class="link small" data-act="reset">reset</button></div>
      <div class="small" data-f="sessionSides"></div>
      <div class="muted small">Recent trades</div>
      <div class="list" data-f="trades"></div>
      <div class="muted small" style="margin-top:4px">Activity</div>
      <div class="list" data-f="log"></div>
    </details>
  </div>
</div>`;

  function money(x, currency) {
    if (typeof x !== 'number') return '';
    const sign = currency === 'USD' || !currency ? '$' : currency + ' ';
    return sign + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function clock(sec) {
    return new Date(sec * 1000).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  const pct = (x) => (100 * x).toFixed(1) + '%';
  const SIDE = { call: 'CALL', put: 'PUT' };

  // The recent results of the arrows that are bought (all, or only the CALL or the PUT ones), with
  // the break-even: null when not measured (apart) yet.
  function tradedEdge(st) {
    const e = st.edge;
    const d = st.settings.directions || 'both';
    if (!e || d === 'both') return e;
    return e[d] ? Object.assign({}, e[d], { breakEven: e.breakEven }) : null;
  }

  // Colour of a win rate: green when even the low end of its 95% range beats break-even, red when
  // it is below break-even, plain in between (not proven either way).
  function tone(x, breakEven, unconfirmed) {
    if (!x || !x.n || !Number.isFinite(breakEven)) return '';
    return x.lo >= breakEven && !unconfirmed ? 'good' : x.rate < breakEven ? 'bad' : '';
  }

  function rulesText(r) {
    if (!r || r.method === 'vote') return '15-strategy vote' + (r && r.reverse ? ', reversed' : '');
    return 'Breakout ' + r.brkCandles + (r.brkCandles === 1 ? ' candle' : ' candles') +
      (r.brkZone >= 50 ? ', close in the upper / lower half' : r.brkZone ? ', close within ' + r.brkZone + '%' : ', close at the high / low') +
      (r.brkBody ? ', body ' + r.brkBody + '%+' : '') + (r.reverse ? ', reversed' : '');
  }

  // Arrows an hour for a share of candles with an arrow, e.g. "15/h".
  function perHour(coverage, size) {
    if (!Number.isFinite(coverage) || !size) return '';
    const x = coverage * 3600 / size;
    return (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '/h';
  }

  // The options of the "Arrows" setting, with this asset's frequency and win rate for each
  // (judged like the win rate card: the price 5 s after the open where that was measured).
  function frequencyOptions(st) {
    const l = st.learnedHere;
    const size = st.target && st.target.candleSize;
    return (st.frequencies || [0, 0.1, 0.25, 0.5, 0.9]).map((f) => {
      const name = !f ? 'Best win rate (fewest)' : f >= 0.9 ? 'Almost every candle' : '1 candle in ' + Math.round(1 / f) + ' or more';
      const lv = l && l.levels ? l.levels[String(f)] : null;
      let detail = '';
      if (lv && lv.check) {
        const j = lv.late && lv.late.n >= 30 ? lv.late : lv.check;
        detail = ' - ' + perHour(lv.check.coverage, size) + ', ' + (j.n ? pct(j.rate) : '-');
      } else if (l && l.levels) {
        detail = ' - not possible here';
      }
      return { value: String(f), text: name + detail };
    });
  }

  // This session's results of the CALL and the PUT trades, e.g. "CALL 3W / 1L (75%) - PUT 1W / 2L (33%)"
  // ('' before any result, and for a session saved before they were counted apart).
  function sessionSides(ses) {
    const one = (key) => {
      const x = ses.sides && ses.sides[key];
      if (!x || !(x.wins + x.losses + x.ties)) return '';
      const decided = x.wins + x.losses;
      return SIDE[key] + ' ' + x.wins + 'W / ' + x.losses + 'L' + (x.ties ? ' / ' + x.ties + 'T' : '') +
        (decided ? ' (' + Math.round(100 * x.wins / decided) + '%)' : '');
    };
    return [one('call'), one('put')].filter(Boolean).join(' - ');
  }

  // Why the asset is or is not traded right now (one line, from the current state only).
  function whyText(st) {
    const t = st.target, s = st.settings, e = st.edge;
    const d = s.directions || 'both';
    const te = tradedEdge(st);
    const which = d === 'both' ? 'every arrow' : SIDE[d] + ' arrows only,';
    if (st.status === 'standby') return ['muted', st.statusText];
    if (st.status !== 'ready') return ['warn', st.statusText || 'Connecting to IQ Option...'];
    if (!t || !t.activeId) return ['muted', 'Reading the traderoom selection...'];
    // Why it does not trade here; while auto-trade is off, whether it would.
    const no = (why, level) => (s.enabled ? [level || 'warn', 'Not traded: ' + why + '.']
      : [level || 'muted', 'Auto-trade is off. It would not trade here: ' + why + '.']);
    if (t.reason) return no(t.reason, 'warn');
    if (t.kind && (!t.enabled || t.suspended)) return no((t.name || 'this asset') + ' is closed for trading now', 'warn');
    if (s.requireEdge) {
      const of = d === 'both' ? '' : ' for ' + SIDE[d] + ' arrows';
      if (!e) return ['muted', 'Measuring the win rate of the logic here...'];
      if (e.unconfirmed) return no('the learned logic could not be checked with a realistic entry');
      if (!te) return no('the ' + SIDE[d] + ' arrows are measured apart at the next learning');
      if (Number.isFinite(e.breakEven) && !(te.n && te.lo >= e.breakEven)) {
        return no((te.rate >= e.breakEven ? 'not enough proof yet' + of + ' (' : 'no edge' + of + ' here (') + pct(te.rate) + ' won, break-even ' + pct(e.breakEven) + ')');
      }
    }
    if (!s.enabled) return ['muted', 'Auto-trade is off. Switch it on to buy ' + (d === 'both' ? 'every arrow' : SIDE[d] + ' arrows') + ' at once.'];
    const ls = st.lastSignal;
    if (ls && ls.note && /^not traded/.test(ls.note) && !ls.filtered && st.nextCandleIn > 0) return ['warn', 'Last arrow ' + ls.note + '.'];
    if (te && te.n && Number.isFinite(e.breakEven) && te.rate < e.breakEven) {
      return ['warn', 'Trading ' + which + ' at once. Here ' + (d === 'both' ? 'it' : 'they') + ' won ' + pct(te.rate) + ', below break-even (' + pct(e.breakEven) + ').'];
    }
    return ['ok', 'Trading ' + which + ' at once.'];
  }

  function createPanel(handlers) {
    const host = document.createElement('div');
    host.id = 'nmat-panel-host';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;
    // Keep keyboard / mouse / wheel input away from the traderoom's own handlers.
    for (const type of ['keydown', 'keyup', 'keypress', 'wheel', 'mousedown', 'mouseup', 'click', 'dblclick',
      'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'contextmenu', 'input', 'paste']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    document.documentElement.appendChild(host);

    const panel = shadow.querySelector('.panel');
    const f = (name) => shadow.querySelector('[data-f="' + name + '"]');
    const toggleBtn = shadow.querySelector('[data-act="toggle"]');
    const exitBtn = shadow.querySelector('[data-act="exit"]');
    const bodyEl = shadow.querySelector('.body');
    let state = null;
    let exitArmed = null;

    // The panel scrolls inside the window, wherever it has been dragged.
    const fit = () => { bodyEl.style.maxHeight = Math.max(160, innerHeight - panel.getBoundingClientRect().top - 50) + 'px'; };
    window.addEventListener('resize', fit);

    try {
      const pos = JSON.parse(localStorage.getItem('nmat-panel-pos') || 'null');
      if (pos) {
        panel.style.left = Math.max(0, Math.min(innerWidth - 60, pos.left)) + 'px';
        panel.style.top = Math.max(0, Math.min(innerHeight - 30, pos.top)) + 'px';
      }
      if (localStorage.getItem('nmat-panel-min') === '1') panel.classList.add('min');
    } catch (_) { /* default position */ }

    // Drag by the header.
    const head = shadow.querySelector('.head');
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const start = { x: e.clientX, y: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      const move = (ev) => {
        panel.style.left = Math.max(0, Math.min(innerWidth - 60, start.left + ev.clientX - start.x)) + 'px';
        panel.style.top = Math.max(0, Math.min(innerHeight - 30, start.top + ev.clientY - start.y)) + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        fit();
        try { localStorage.setItem('nmat-panel-pos', JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop })); } catch (_) { /* ignore */ }
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });

    shadow.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const what = act.getAttribute('data-act');
      if (what === 'min') {
        panel.classList.toggle('min');
        try { localStorage.setItem('nmat-panel-min', panel.classList.contains('min') ? '1' : '0'); } catch (_) { /* ignore */ }
      } else if (what === 'exit') {
        // Two clicks: the first one asks.
        if (exitArmed) { clearTimeout(exitArmed); exitArmed = null; handlers.onExit(); return; }
        exitBtn.classList.add('armed');
        exitBtn.textContent = 'Exit?';
        exitArmed = setTimeout(() => { exitArmed = null; exitBtn.classList.remove('armed'); exitBtn.innerHTML = '&#x23FB;'; }, 3000);
      } else if (what === 'toggle' && state) {
        handlers.onSettings({ enabled: !state.settings.enabled });
      } else if (what === 'reset') {
        handlers.onResetSession();
      } else if (what === 'learn') {
        handlers.onLearnNow();
      } else if (what === 'reload') {
        handlers.onReloadChart();
      }
    });

    shadow.addEventListener('change', (e) => {
      const el = e.target;
      if (el.name === 'acct') { handlers.onSettings({ account: el.value, realConfirmed: false }); return; }
      if (el.name === 'dir') { handlers.onSettings({ directions: el.value }); return; }
      const s = el.getAttribute('data-s');
      const r = el.getAttribute('data-r');
      const value = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
      if (s) handlers.onSettings({ [s]: value });
      if (r) handlers.onSettings({ rules: { [r]: value } });
    });

    function setInput(el, value) {
      if (shadow.activeElement === el) return; // do not fight the user while typing
      if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
    }

    function render(st) {
      state = st;
      fit();
      const s = st.settings;
      const t = st.target;
      shadow.querySelector('.dot').className = 'dot ' + st.status;
      f('asset').textContent = st.targetLabel || 'Reading the traderoom selection...';
      f('status').textContent = (st.status === 'ready' ? 'Connected' + (st.nextCandleIn ? ' - next candle in ' + st.nextCandleIn + ' s' : '') : st.statusText) +
        (st.live ? ' - price ' + st.live.close : '');

      // Win rate of the logic used here: all its arrows, then the CALL and the PUT arrows apart.
      const e = st.edge;
      const rate = f('rate');
      const be = e ? e.breakEven : NaN;
      if (!t || !t.activeId || !e) {
        rate.textContent = '-';
        rate.className = 'big';
        f('rateNote').textContent = t && t.activeId ? 'measuring...' : '';
        f('sides').hidden = true;
      } else {
        rate.textContent = e.n ? pct(e.rate) : 'no arrows';
        rate.className = 'big ' + tone(e, be, e.unconfirmed);
        const often = Number.isFinite(e.coverage) && t ? ' (' + perHour(e.coverage, t.candleSize) + ')' : '';
        f('rateNote').textContent = e.n.toLocaleString() + ' arrows' + often + (Number.isFinite(be) ? ', need ' + pct(be) : '');
        f('sides').hidden = false;
        for (const key of ['call', 'put']) {
          const x = e[key];
          const el = f(key === 'call' ? 'rateCall' : 'ratePut');
          el.textContent = (key === 'call' ? '\u25B2 CALL ' : '\u25BC PUT ') + (!x ? '-' : x.n ? pct(x.rate) + ' \u00B7 ' + x.n.toLocaleString() : 'no arrows');
          el.className = tone(x, be, e.unconfirmed) + (s.directions !== 'both' && s.directions !== key ? ' off' : '');
          el.title = !x ? 'Counted apart at the next learning of this asset'
            : SIDE[key] + ' arrows: ' + x.wins + ' won of ' + x.n + (x.n ? ' (95% range ' + pct(x.lo) + ' to ' + pct(x.hi) + ')' : '') +
              (s.directions !== 'both' && s.directions !== key ? '. Not bought (Buy: ' + SIDE[s.directions] + ' only)' : '');
        }
      }
      f('rateLabel').textContent = e && e.learned ? (e.late ? 'Win rate (learned, entry +5 s)' : 'Win rate (learned logic)') : 'Win rate here';
      f('rateLabel').title = e && e.learned ? 'Measured on the newest ' + e.candles.toLocaleString() + ' candles, which were not used to choose the logic' +
        (e.late ? ', with the price 5 s after each candle opens (cautious: the extension buys about 0.1 s after the open)' : '') : 'The logic replayed on the last ' + (e ? e.candles.toLocaleString() : '5,000') + ' candles';

      // The arrow of the open candle.
      const ls = st.lastSignal;
      const sig = f('signal');
      if (!ls) { sig.textContent = '-'; sig.className = 'big'; f('signalNote').textContent = 'waiting for the next candle'; }
      else {
        sig.textContent = ls.decision > 0 ? 'CALL \u25B2' : ls.decision < 0 ? 'PUT \u25BC' : 'no arrow';
        sig.className = 'big ' + (ls.decision > 0 ? 'call' : ls.decision < 0 ? 'put' : 'muted');
        f('signalNote').textContent = clock(ls.from) + (ls.decision !== 0 ? (ls.traded ? ' - bought' + (Number.isFinite(ls.boughtAfter) ? ' ' + ls.boughtAfter.toFixed(1) + ' s after the open' : '')
          : ls.filtered ? ' - not bought (' + SIDE[ls.filtered] + ' only)' : ls.note && /^not traded/.test(ls.note) ? ' - not bought' : '') : '');
      }
      f('signalLabel').textContent = ls ? 'Candle ' + clock(ls.from) : 'This candle';

      const [cls, text] = whyText(st);
      const why = f('why');
      why.className = 'why ' + cls;
      why.textContent = text;

      toggleBtn.textContent = 'AUTO-TRADE: ' + (s.enabled ? 'ON' : 'OFF') + (s.account === 'real' ? ' (REAL MONEY)' : ' (practice)');
      toggleBtn.classList.toggle('on', s.enabled);
      toggleBtn.classList.toggle('real', s.account === 'real');
      toggleBtn.disabled = st.status !== 'ready' || (s.account === 'real' && !s.realConfirmed && !s.enabled);
      toggleBtn.title = toggleBtn.disabled && s.account === 'real' ? 'Tick the real-money confirmation first' : '';
      for (const radio of shadow.querySelectorAll('input[name=acct]')) radio.checked = radio.value === s.account;
      for (const radio of shadow.querySelectorAll('input[name=dir]')) {
        radio.checked = radio.value === (s.directions || 'both');
        radio.parentElement.classList.toggle('sel', radio.checked);
      }
      f('practice').textContent = st.balances.practice ? money(st.balances.practice.amount, st.balances.practice.currency) : '';
      f('real').textContent = st.balances.real ? money(st.balances.real.amount, st.balances.real.currency) : '';
      f('realbox').hidden = s.account !== 'real';

      const ses = st.session;
      const decided = ses.wins + ses.losses;
      f('session').textContent = ses.trades + ' trades, ' + ses.wins + ' won, ' + ses.losses + ' lost, P/L ' + (ses.pnl > 0 ? '+' : '') + ses.pnl.toFixed(2);
      f('sessionLong').textContent = 'Session: ' + ses.trades + ' trades, ' + ses.wins + 'W / ' + ses.losses + 'L / ' + ses.ties + 'T' +
        (decided ? ' (' + Math.round(100 * ses.wins / decided) + '%)' : '') + ', P/L ' + (ses.pnl > 0 ? '+' : '') + ses.pnl.toFixed(2);
      f('sessionSides').textContent = sessionSides(ses);
      const stop = f('stop');
      stop.textContent = ses.stopReason ? 'Stopped: ' + ses.stopReason : '';
      stop.hidden = !ses.stopReason;

      renderLogic(st);

      // "Arrows": rebuilt only when its texts change, so an open list is not reset.
      const freq = shadow.querySelector('[data-s="frequency"]');
      const opts = frequencyOptions(st);
      const sig2 = JSON.stringify(opts);
      if (freq.dataset.sig !== sig2) {
        freq.dataset.sig = sig2;
        freq.textContent = '';
        for (const o of opts) {
          const el = document.createElement('option');
          el.value = o.value;
          el.textContent = o.text;
          freq.appendChild(el);
        }
        freq.value = String(s.frequency);
      }

      for (const el of shadow.querySelectorAll('[data-s]')) setInput(el, s[el.getAttribute('data-s')]);
      for (const el of shadow.querySelectorAll('[data-r]')) setInput(el, s.rules[el.getAttribute('data-r')]);
      // A standby tab must not change settings that the trading tab does not see.
      for (const el of shadow.querySelectorAll('input, select, .btn')) el.disabled = st.status === 'standby';

      const trades = f('trades');
      trades.textContent = '';
      for (const tr of st.trades) {
        const div = document.createElement('div');
        const res = tr.result ? tr.result.toUpperCase() + (tr.pnl ? ' ' + (tr.pnl > 0 ? '+' : '') + tr.pnl.toFixed(2) : '') + (tr.estimated ? '*' : '') : tr.status;
        div.className = tr.result === 'win' ? 'win' : tr.result === 'loss' || tr.result === 'error' ? 'loss' : tr.result === 'tie' ? 'tie' : '';
        div.textContent = clock(tr.from) + ' ' + (tr.asset ? tr.asset + ' ' : '') + (tr.kind === 'blitz' ? 'Blitz ' : tr.kind === 'digital' ? 'Digital ' : '') +
          tr.direction.toUpperCase() + ' ' + tr.amount + (tr.account === 'real' ? ' REAL' : '') + ' -> ' + res;
        div.title = div.textContent;
        trades.appendChild(div);
      }
      if (!st.trades.length) trades.textContent = 'none yet';
      const log = f('log');
      log.textContent = '';
      for (const line of st.log) {
        const div = document.createElement('div');
        div.textContent = line;
        div.title = line;
        log.appendChild(div);
      }
    }

    // The logic for the asset, its learning and the chart script.
    function renderLogic(st) {
      const t = st.target;
      const l = st.learnedHere;
      const lg = st.learning || {};
      const key = t && t.activeId ? t.activeId + '/' + t.candleSize : '';
      f('logic').textContent = t && t.activeId ? rulesText(st.rules) + (l ? ' (learned ' + clock(l.learnedAt) + ')' : ' (manual rules)') : '';
      if (l) {
        // Like with like: both from the candle open; the price 5 s in, where measured, separately.
        const late = l.late && l.late.n >= 30 ? l.late : null;
        const before = l.current && l.current.check;
        const size = t && t.candleSize;
        const often = (x) => (x && Number.isFinite(x.coverage) ? ' (' + perHour(x.coverage, size) + ')' : '');
        f('compare').textContent = 'Default logic here ' + (before && before.n ? pct(before.rate) : '-') + often(before) + ' -> learned ' +
          (l.check.n ? pct(l.check.rate) : '-') + often(l.check) + ' on the newest ' + l.parts.check.toLocaleString() + ' of ' +
          l.candles.toLocaleString() + ' candles' + (late ? '; ' + pct(late.rate) + ' with the price 5 s after the open' : '') +
          '. Target ' + Math.round(100 * l.target) + '%: ' + (l.reached ? 'reached.' : 'not reached.');
      } else {
        f('compare').textContent = st.settings.useLearned ? 'Not learned yet: press Learn now.' : 'Learning is switched off in Settings.';
      }
      const mine = lg.busy && lg.key === key;
      const learnBtn = shadow.querySelector('[data-act="learn"]');
      learnBtn.disabled = !key || mine || st.status !== 'ready';
      learnBtn.textContent = mine ? 'Learning...' : l ? 'Learn again' : 'Learn now';
      f('learnState').textContent = mine ? (lg.step || 'learning') + (lg.wanted && lg.fetched ? ': ' + lg.fetched.toLocaleString() + ' / ' + lg.wanted.toLocaleString() : '')
        : lg.busy ? 'background: ' + lg.asset + (lg.total ? ' (' + lg.done + ' of ' + lg.total + ')' : '') : (lg.note || '');
      f('barBox').hidden = !mine;
      f('bar').style.width = mine && lg.wanted ? Math.min(100, Math.round(100 * (lg.fetched || 0) / lg.wanted)) + '%' : '0';

      const c = st.chart;
      const chart = f('chart');
      chart.className = 'small ' + (c && c.error ? 'bad' : 'muted');
      chart.textContent = !c ? '' : c.state === 'saving' ? 'Updating the chart script...'
        : c.error ? 'Chart script not updated: ' + c.error
          : c.found === 0 ? 'Chart script: not in your account (import NextMinuteSignal.lua once).'
            : (c.needsReload ? 'Chart script updated: reload the page to see this asset\'s logic on the chart.'
              : 'The chart script has the logic learned for ' + c.assets + ' assets.') +
              (c.dropped ? ' ' + c.dropped + ' more do not fit (IQ Option limits the script length).' : '');
      f('reloadRow').hidden = !(c && c.needsReload);
    }

    return {
      el: host,
      render,
      toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; },
      destroy() { window.removeEventListener('resize', fit); host.remove(); },
    };
  }

  root.NMPanel = { createPanel, whyText, tradedEdge, tone, sessionSides, frequencyOptions, perHour, rulesText };
  if (typeof module === 'object' && module.exports) module.exports = root.NMPanel;
})(typeof self !== 'undefined' ? self : this);

/*
 * Content script for https://iqoption.com/traderoom. Starts the auto trader, its learning, the
 * "+ NEW OPTION" presser and the panel; Exit stops all of them (and the connection) until the
 * toolbar icon is clicked. Settings, statistics and learned logic are kept in chrome.storage.local.
 */
(async function () {
  'use strict';
  if (window.top !== window || window.__nmatStarted) return;
  window.__nmatStarted = true;

  let app = null;
  let starting = false;
  // The code of the chart script when the page was loaded: the chart runs it until the next reload
  // (also after Exit and a new start in this page).
  let chartLoaded = null;
  const badge = (text) => chrome.runtime.sendMessage({ type: 'nmat-badge', text }).catch(() => {});

  async function start() {
    if (app || starting) return;
    starting = true;
    try { app = await startApp(); } finally { starting = false; }
    badge('');
  }

  // The toolbar icon: shows / hides the panel, or starts everything again after Exit.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'nmat-toggle-panel') return;
    if (app) app.panel.toggle();
    else chrome.storage.local.set({ exited: false }).then(start);
  });

  const { exited } = await chrome.storage.local.get('exited');
  if (exited) badge('OFF');
  else start();

  async function startApp() {
    const { IqClient, parseLayout } = self.NMIqClient;
    const { AutoTrader, DEFAULT_SETTINGS } = self.NMAutoTrader;
    const readCookie = (name) => {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[1]) : '';
    };
    // The traderoom's own translations (the asset names it shows), in the traderoom's language.
    async function getTranslations() {
      const used = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/api/lang/route-translations'));
      let route = 'en';
      try { route = (used && new URL(used).searchParams.get('route')) || 'en'; } catch (_) { /* English */ }
      const res = await fetch(location.origin + '/api/lang/route-translations?groups[]=desktop&route=' + encodeURIComponent(route), { credentials: 'include' });
      if (!res.ok) throw new Error('translations: HTTP ' + res.status);
      const result = ((await res.json()) || {}).result || {};
      return result[route] || Object.values(result)[0] || {};
    }

    const stored = await chrome.storage.local.get(['settings', 'session', 'heartbeat', 'learned']);
    const saved = stored.settings || {};
    // Since 1.3 every arrow is traded unless "Only trade where it has an edge" is switched on: older
    // versions saved it on by default.
    const upgrade = Number(saved.settingsVersion) >= 2 ? {} : { requireEdge: false };
    const settings = Object.assign({}, DEFAULT_SETTINGS, saved, upgrade, { settingsVersion: 2 });
    // Auto-trading survives a page reload or a short disconnection, but never starts by itself
    // when the traderoom is opened later: then it is off and real money must be confirmed again.
    const RESUME_MS = 5 * 60 * 1000;
    const resumed = !!settings.enabled && typeof stored.heartbeat === 'number' && Date.now() - stored.heartbeat < RESUME_MS;
    if (!resumed) { settings.enabled = false; settings.realConfirmed = false; }

    const client = new IqClient({ getSsid: () => readCookie('ssid'), getTranslations });
    const trader = new AutoTrader({ client, settings, session: stored.session, learned: stored.learned });
    if (resumed) trader.log('Auto-trading resumed after the page reload (' + settings.account + ' account).');
    // Learns the best logic of the selected asset, then of every open asset (only in the trading tab).
    const learning = self.NMLearner.createLearningQueue({ client, trader });
    let closed = false;
    const cleanups = [];
    const listen = (target, type, fn) => { target.addEventListener(type, fn); cleanups.push(() => target.removeEventListener(type, fn)); };

    // ---- the chart scripts in the account follow the learned logic -----------------------------
    let chartBusy = false;
    let chartAt = 0;
    let chartCode = '';
    // The chart needs a page reload when what it loaded shows the selected asset differently.
    const chartIsStale = () => {
      const t = trader.target;
      return !!(t && t.activeId && chartLoaded !== null && chartCode && self.NMChartScript.differsFor(chartLoaded, chartCode, t.activeId));
    };
    async function syncChart(now) {
      if (closed || chartBusy || trader.status !== 'ready') return;
      if (!now && Date.now() - chartAt < 10 * 60 * 1000) return; // background learning: at most every 10 minutes
      chartBusy = true;
      chartAt = Date.now();
      trader.setChart({ state: 'saving', error: '' });
      try {
        const r = await self.NMChartScript.updateChartScripts(client, self.NMLuaScripts, trader.learned, trader.learnedKey(trader.target));
        const main = r.scripts.find((s) => s.kind === 'signal') || r.scripts[0];
        if (main) {
          if (chartLoaded === null) chartLoaded = main.before;
          chartCode = main.after;
        }
        const needsReload = chartIsStale();
        trader.setChart({ state: 'done', found: r.found, assets: r.assets, dropped: r.dropped, needsReload, error: '' });
        if (r.updated) trader.log('Chart script saved with the learned settings of ' + r.assets + ' assets' + (needsReload ? ': reload the page to see this asset\'s on the chart.' : '.'));
      } catch (e) {
        trader.setChart({ state: 'error', error: e.message });
      } finally {
        chartBusy = false;
      }
    }

    const panel = self.NMPanel.createPanel({
      onSettings: (patch) => trader.setSettings(patch),
      onResetSession: () => trader.resetSession(),
      onLearnNow: () => { learning.learnNow(); trader.log('Learning ' + (trader.target && trader.target.name || 'this asset') + ' now.'); },
      onReloadChart: () => location.reload(),
      onExit: () => exit(),
    });

    let pending = null;
    let wasReady = false;
    let chartFor = 0;
    trader.on('state', (st) => {
      if (closed) return;
      // Install the current script version once connected and the selected asset is known (its
      // learned settings come first in the table).
      if (st.status === 'ready' && st.target && !wasReady) { wasReady = true; syncChart(true); }
      // Another asset: does the chart show its current settings?
      const id = st.target && st.target.activeId;
      if (id && id !== chartFor && st.chart && st.chart.state === 'done') {
        chartFor = id;
        const stale = chartIsStale();
        if (stale !== !!st.chart.needsReload) trader.setChart({ needsReload: stale });
      }
      // At most one repaint per animation frame.
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = null; if (!closed) panel.render(trader.getState()); });
    });
    trader.on('settings', (s) => chrome.storage.local.set(s.enabled ? { settings: s, heartbeat: Date.now() } : { settings: s }));
    trader.on('session', (s) => chrome.storage.local.set({ session: s }));
    // Learned logic is kept per asset (saved at most every 5 seconds); the chart script follows it.
    let saveLearned = null;
    trader.on('learned', ({ key }) => {
      if (!saveLearned) {
        saveLearned = setTimeout(() => {
          saveLearned = null;
          chrome.storage.local.set({ learned: trader.learned }).catch(() => {});
        }, 5000);
      }
      syncChart(key === trader.learnedKey(trader.target));
    });
    const heartbeat = setInterval(() => {
      if (trader.settings.enabled) chrome.storage.local.set({ heartbeat: Date.now() }).catch(() => {});
    }, 30000);

    // The traderoom's own selection changes, at once (see page-hooks.js): the asset and option type
    // the moment they are chosen, then the saved selection (with the candle size).
    listen(document, 'nmat-select', (event) => {
      try { const s = JSON.parse(event.detail); trader.selectionHint(s.activeId, s.activeType); } catch (_) { /* the saved selection follows */ }
    });
    listen(document, 'nmat-layout', (event) => {
      try { trader.layoutSaved(parseLayout(JSON.parse(event.detail))); } catch (_) { /* polling still follows it */ }
    });
    listen(document, 'visibilitychange', () => { if (!document.hidden) trader.refreshBalances(); });

    // While auto-trading is on, press the traderoom's "+ NEW OPTION" whenever an ended option leaves
    // it on screen, so the traderoom is ready for the next position too (orders do not need it).
    // Only between deals: pressed while an option of the asset is still running, it opens a new tab.
    const NO = self.NMNewOption;
    const presser = NO.createNewOptionPresser({
      isActive: () => !closed && trader.settings.enabled && trader.status === 'ready' && !document.hidden &&
        !!trader.target && !trader.hasOpenPosition(trader.target.activeId),
      probe: (fromRight) => NO.pageProbe(fromRight),
      click: (fromRight, y) => NO.clickCanvas(fromRight, y),
      onPress: () => trader.log('Pressed "+ NEW OPTION" in the traderoom: ready for the next position.'),
    });
    trader.on('position-closed', (activeId) => {
      if (closed || !trader.target || trader.target.activeId !== activeId) return;
      // The traderoom shows the result first: look right after it, before the next candle's order.
      setTimeout(presser.check, 300);
      setTimeout(presser.check, 1200);
    });

    // Ask the service worker to keep this tab from being discarded by Chrome's Memory Saver.
    chrome.runtime.sendMessage({ type: 'nmat-keep-tab' }).catch(() => {});
    // A read-only view for debugging from the DevTools console of this content script.
    window.__nmat = { getState: () => trader.getState() };
    panel.render(trader.getState());

    // Only one traderoom tab may trade (and learn): the others wait on standby and take over when it closes.
    let releaseLock = null;
    const run = () => { if (!closed) { trader.start(); learning.start(); } };
    if (navigator.locks && navigator.locks.request) {
      let leader = false;
      navigator.locks.request('nmat-auto-trader', () => {
        if (closed) return undefined; // exited while waiting: give the lock to another tab
        leader = true;
        run();
        return new Promise((resolve) => { releaseLock = resolve; }); // held until Exit or the tab closes
      }).catch(() => { if (!leader) run(); });
      setTimeout(() => {
        if (!leader && !closed) trader.setStatus('standby', 'Standby: another IQ Option tab is running the auto trader.');
      }, 500);
    } else {
      run();
    }

    // Exit: everything stops (auto-trading off, learning, connection) and the panel closes.
    async function exit() {
      if (closed) return;
      trader.setSettings({ enabled: false });
      closed = true;
      learning.stop();
      presser.stop();
      clearInterval(heartbeat);
      if (saveLearned) { clearTimeout(saveLearned); saveLearned = null; }
      cleanups.forEach((fn) => fn());
      trader.stop();
      panel.destroy();
      if (releaseLock) releaseLock();
      delete window.__nmat;
      await chrome.storage.local.set({ exited: true, settings: trader.settings, learned: trader.learned }).catch(() => {});
      badge('OFF');
      app = null;
    }

    return { panel, exit };
  }
})();

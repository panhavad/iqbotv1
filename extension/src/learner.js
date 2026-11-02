/*
 * Learns the best signal logic for one asset from its candle history.
 *
 * It starts from the current logic (the 5-candle breakout), then adjusts it: lookback, how close
 * to the high / low the close must be, minimum candle body, and follow or reverse (264 versions),
 * counting for each version how many arrows it gave and how many won. It stops early when a
 * version reaches the target win rate (90% by default) on candles it was not adjusted on.
 *
 * Honest by construction: the candles are split by time. Every version is measured on the oldest
 * 60% (learn); the 10 best are compared on the next 20% (choose); the winner is measured once on
 * the newest 20% (check), which no step has used. Only the check result tells whether the logic
 * works: the trader uses a learned logic only where that result beats break-even.
 *
 * Candles: [{from, open, high, low, close}] oldest first (one candle size).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMLearner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CANDLE_CHOICES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30];
  const ZONE_CHOICES = [0, 10, 20, 30];
  const BODY_CHOICES = [0, 30, 60];
  const CURRENT = Object.freeze({ method: 'breakout', brkCandles: 5, brkZone: 0, brkBody: 0, reverse: false });
  const LEARN_END = 0.6, CHOOSE_END = 0.8;
  const MIN_LEARN = 50, MIN_CHOOSE = 20, MIN_CHECK = 30, SHORTLIST = 10;

  function wilson(w, n) {
    if (!n) return [0, 1];
    const z = 1.96, p = w / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [c - h, c + h];
  }

  // Highest high / lowest low of the last n candles (this one included); NaN before n candles.
  function rolling(candles, n, high) {
    const out = new Float64Array(candles.length).fill(NaN);
    const q = []; // indexes with monotonic values
    for (let i = 0; i < candles.length; i++) {
      const v = high ? candles[i].high : candles[i].low;
      while (q.length && (high ? candles[q[q.length - 1]].high <= v : candles[q[q.length - 1]].low >= v)) q.pop();
      q.push(i);
      if (q[0] <= i - n) q.shift();
      if (i >= n - 1) out[i] = high ? candles[q[0]].high : candles[q[0]].low;
    }
    return out;
  }

  // Breakout arrows exactly as the signal engine and the chart script decide them: arrows[i]
  // (+1 CALL, -1 PUT, 0 none) is decided when candle i closes and trades candle i + 1.
  function breakoutArrows(candles, rules, cache) {
    const n = candles.length;
    const key = rules.brkCandles;
    const store = cache || {};
    if (!store[key]) store[key] = { hh: rolling(candles, key, true), ll: rolling(candles, key, false) };
    const { hh, ll } = store[key];
    const out = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const H = hh[i], L = ll[i];
      if (!(H > L)) continue;
      const c = candles[i];
      if (Math.abs(c.close - c.open) < rules.brkBody / 100 * (c.high - c.low)) continue;
      const zone = rules.brkZone / 100 * (H - L);
      let d = 0;
      if (c.close >= H - zone) d = 1;
      else if (c.close <= L + zone) d = -1;
      out[i] = rules.reverse ? -d : d;
    }
    return out;
  }

  // Colour of the traded candle for the arrow of candle i: +1 up, -1 down, 0 tie (a refund),
  // NaN when candle i + 1 does not follow directly (market closed in between).
  function outcomes(candles, size) {
    const y = new Float64Array(candles.length).fill(NaN);
    for (let i = 0; i + 1 < candles.length; i++) {
      const next = candles[i + 1];
      if (size && next.from - candles[i].from !== size) continue;
      y[i] = Math.sign(next.close - next.open);
    }
    return y;
  }

  // Wins and decided arrows (ties left out) of the arrows from index `from` to `to` (excluded);
  // cw / cn: the same for the CALL arrows only (the PUT arrows are the rest).
  function score(arrows, y, from, to) {
    let w = 0, n = 0, cw = 0, cn = 0;
    for (let i = from; i < to; i++) {
      const a = arrows[i], r = y[i];
      if (a === 0 || !(r === 1 || r === -1)) continue;
      n += 1;
      if (a === r) w += 1;
      if (a === 1) { cn += 1; if (r === 1) cw += 1; }
    }
    return { w, n, cw, cn };
  }

  function rateOf(w, n) {
    const [lo, hi] = wilson(w, n);
    return { wins: w, n, rate: n ? w / n : NaN, lo, hi };
  }

  // {wins, n, rate, lo, hi} of all the arrows, and the same for the CALL and the PUT arrows.
  function stats(s) {
    return Object.assign(rateOf(s.w, s.n), { call: rateOf(s.cw, s.cn), put: rateOf(s.w - s.cw, s.n - s.cn) });
  }

  // Wins of the arrows of candles [from, to) when the option is bought a few seconds after the
  // candle opens: entry = prices.get(open time of the traded candle) (the price 5 s after its open,
  // from 5-second candles), exit = its close. Arrows without that price are counted as missing.
  function lateScore(candles, arrows, from, to, prices, size) {
    let w = 0, n = 0, cw = 0, cn = 0, total = 0, missing = 0;
    for (let i = from; i < to && i + 1 < candles.length; i++) {
      const a = arrows[i];
      const next = candles[i + 1];
      if (a === 0 || (size && next.from - candles[i].from !== size)) continue;
      total += 1;
      const entry = prices.get(next.from);
      if (entry === undefined) { missing += 1; continue; }
      const move = Math.sign(next.close - entry);
      if (move === 0) continue; // a tie: refunded on Binary and Blitz
      n += 1;
      if (move === a) w += 1;
      if (a === 1) { cn += 1; if (move === 1) cw += 1; }
    }
    return { w, n, cw, cn, total, missing };
  }

  function versions() {
    const out = [];
    for (const brkCandles of CANDLE_CHOICES) {
      for (const brkZone of ZONE_CHOICES) {
        for (const brkBody of BODY_CHOICES) {
          for (const reverse of [false, true]) out.push({ method: 'breakout', brkCandles, brkZone, brkBody, reverse });
        }
      }
    }
    return out;
  }

  // Learns the logic of one asset. options: {size (s), target (0-1, default 0.9), pause: () => Promise
  // (called now and then so the page stays responsive)}. Returns the chosen rules and the
  // learn / choose / check results of it and of the current logic.
  async function learn(candles, options) {
    const o = options || {};
    const target = o.target === undefined ? 0.9 : o.target;
    const n = candles.length;
    const a = Math.floor(n * LEARN_END), b = Math.floor(n * CHOOSE_END);
    const y = outcomes(candles, o.size);
    const cache = {};
    const parts = (arrows) => ({ learn: score(arrows, y, 0, a), choose: score(arrows, y, a, b), check: score(arrows, y, b, n) });

    const current = parts(breakoutArrows(candles, CURRENT, cache));
    const all = versions();
    const learned = [];
    let bestLearn = null;
    let reached = null;
    for (let k = 0; k < all.length; k++) {
      if (o.pause && k % 24 === 23) await o.pause();
      const rules = all[k];
      const arrows = breakoutArrows(candles, rules, cache);
      const s = score(arrows, y, 0, a);
      if (s.n < MIN_LEARN) continue;
      const entry = { rules, learn: s, lo: wilson(s.w, s.n)[0] };
      learned.push(entry);
      if (!bestLearn || s.w / s.n > bestLearn.learn.w / bestLearn.learn.n) bestLearn = entry;
      // The target counts only when it also holds on the candles the version was not adjusted on.
      if (s.w / s.n >= target) {
        const p = parts(arrows);
        if (p.choose.n >= MIN_CHOOSE && p.check.n >= MIN_CHECK && p.choose.w / p.choose.n >= target && p.check.w / p.check.n >= target) {
          reached = Object.assign(entry, p);
          break;
        }
      }
    }

    let pick = reached;
    if (!pick) {
      learned.sort((x, z) => z.lo - x.lo);
      const shortlist = learned.slice(0, SHORTLIST).map((e) => Object.assign(e, parts(breakoutArrows(candles, e.rules, cache))));
      const ranked = shortlist.filter((e) => e.choose.n >= MIN_CHOOSE)
        .sort((x, z) => wilson(z.choose.w, z.choose.n)[0] - wilson(x.choose.w, x.choose.n)[0]);
      pick = ranked[0] || shortlist[0] || null;
    }
    const result = {
      candles: n,
      size: o.size || null,
      from: n ? candles[0].from : null,
      to: n ? candles[n - 1].from : null,
      parts: { learn: a, choose: b - a, check: n - b }, // candles in each part
      tried: learned.length,
      target,
      reached: !!reached,
      current: { learn: stats(current.learn), choose: stats(current.choose), check: stats(current.check) },
      bestLearn: bestLearn ? { rules: bestLearn.rules, learn: stats(bestLearn.learn) } : null,
      rules: pick ? Object.assign({}, pick.rules) : Object.assign({}, CURRENT),
      learn: pick ? stats(pick.learn) : stats(current.learn),
      choose: pick ? stats(pick.choose) : stats(current.choose),
      check: pick ? stats(pick.check) : stats(current.check),
    };
    return result;
  }

  // Short description of breakout rules, e.g. "breakout 8 candles, zone 10%, body 30%, reversed".
  function describe(rules) {
    if (!rules || rules.method === 'vote') return '15-strategy vote' + (rules && rules.reverse ? ', reversed' : '');
    return 'breakout ' + rules.brkCandles + ' candles' +
      (rules.brkZone ? ', close within ' + rules.brkZone + '%' : ', close at the high / low') +
      (rules.brkBody ? ', body at least ' + rules.brkBody + '%' : '') +
      (rules.reverse ? ', reversed (fade)' : '');
  }

  // ---- learning queue ---------------------------------------------------------------------
  const RELEARN_SELECTED_SEC = 6 * 3600; // the selected asset is learned again after 6 hours
  const RELEARN_OTHERS_SEC = 24 * 3600; // every other open asset after 24 hours
  const LIST_EVERY_SEC = 1800; // the list of open assets is read again after 30 minutes
  const MIN_CANDLES = 1000;
  const MIN_CONFIRM = 30; // arrows needed on the check candles to measure them with a realistic entry
  const MAX_FIVE_SEC = 60000; // 5-second candles for that (about 3.5 days)

  // Learns the selected asset first (when it has no logic yet, its logic is old, or on request),
  // then, with settings.learnAll, every open asset one by one. Results go to trader.setLearned();
  // progress to trader.setLearning(). Requests are paced and stay away from candle opens, so the
  // trader's own requests come first.
  function createLearningQueue(o) {
    const { client, trader } = o;
    const gapMs = o.gapMs === undefined ? 400 : o.gapMs;
    const nowSec = () => client.serverTimeMs() / 1000;
    // Waits about ms; trader.pause() wakes on server messages, so this also works in a background tab.
    const sleep = o.sleep || (async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) await trader.pause(Math.min(1000, end - Date.now()));
    });
    let stopped = false;
    let running = false;
    let force = '';
    let interrupt = false; // a background asset gives way to "Learn now"
    let list = [];
    let listAt = -Infinity;
    let busy = null;

    // Not in the second before and the 6 seconds after a candle opens: the trader decides then.
    async function quiet() {
      const size = trader.size || 60;
      const s = nowSec() % size;
      if (s > size - 1.5) await sleep((size - s + 6) * 1000);
      else if (s < 6) await sleep((6 - s) * 1000);
    }

    async function fetchCandles(activeId, size, count, sinceSec, background) {
      let rows = [];
      let to = Math.floor(nowSec());
      while (rows.length < count && !stopped) {
        if (background && interrupt) return null; // "Learn now" for the selected asset comes first
        await quiet();
        const want = Math.min(1000, count - rows.length);
        const page = await client.candles(activeId, size, to, want);
        const older = rows.length ? page.filter((c) => c.from < rows[0].from) : page;
        if (!older.length) break;
        rows = older.concat(rows);
        trader.setLearning({ fetched: rows.length });
        if (page.length < want || (sinceSec && rows[0].from <= sinceSec)) break;
        to = older[0].from - 1;
        if (gapMs) await sleep(gapMs);
      }
      if (sinceSec) rows = rows.filter((c) => c.from >= sinceSec);
      return rows.map((c) => ({ from: c.from, open: c.open, high: c.max, low: c.min, close: c.close }));
    }

    // A learned logic that beats a coin flip on its check candles is measured again there with the
    // price 5 s after each candle's open (the extension buys about 2 s after it): on real markets
    // much of a short-term edge is gone after the first seconds.
    async function confirmLate(activeId, size, name, candles, result, background) {
      const start = candles[Math.floor(candles.length * CHOOSE_END)].from;
      const want = Math.min(MAX_FIVE_SEC, Math.ceil((nowSec() - start) / 5) + 1000);
      trader.setLearning({ step: 'realistic entry (5-second candles)', fetched: 0, wanted: want });
      const five = await fetchCandles(activeId, 5, want, start, background);
      if (!five) return;
      const prices = new Map();
      for (const c of five) if (c.from % size === 0) prices.set(c.from, c.close);
      const arrows = breakoutArrows(candles, result.rules);
      const s = lateScore(candles, arrows, Math.floor(candles.length * CHOOSE_END), candles.length, prices, size);
      result.late = stats(s);
      result.lateCoverage = s.total ? (s.total - s.missing) / s.total : 0;
    }

    async function learnOne(activeId, size, name, background) {
      const s = trader.settings;
      const key = activeId + '/' + size;
      trader.setLearning({ busy: true, asset: name, key, step: 'downloading candles', fetched: 0, wanted: s.learnCandles, note: '' });
      const candles = await fetchCandles(activeId, size, s.learnCandles, 0, background);
      if (stopped || !candles) return;
      if (candles.length < MIN_CANDLES) {
        trader.setLearned(key, { name, activeId, size, learnedAt: nowSec(), wanted: s.learnCandles, candles: candles.length, tooShort: true,
          rules: Object.assign({}, CURRENT), check: stats({ w: 0, n: 0, cw: 0, cn: 0 }), parts: { learn: 0, choose: 0, check: 0 } });
        return;
      }
      trader.setLearning({ step: 'trying 264 versions of the logic' });
      const result = await learn(candles, { size, target: s.target / 100, pause: () => sleep(0) });
      Object.assign(result, { name, activeId, learnedAt: nowSec(), wanted: s.learnCandles });
      if (result.check.n >= MIN_CONFIRM && result.check.lo >= 0.5 && size % 5 === 0) {
        result.lateTried = true;
        try { await confirmLate(activeId, size, name, candles, result, background); } catch (_) { /* unconfirmed: not traded */ }
        if (stopped || (background && interrupt)) return;
      }
      trader.setLearned(key, result);
      const c = result.check;
      const late = result.late;
      const split = (x) => ' (CALL ' + (x.call.n ? (100 * x.call.rate).toFixed(1) + '% of ' + x.call.n : 'none') +
        ', PUT ' + (x.put.n ? (100 * x.put.rate).toFixed(1) + '% of ' + x.put.n : 'none') + ')';
      trader.log('Learned ' + name + ' on ' + candles.length.toLocaleString() + ' candles: ' + describe(result.rules) + '. Check (newest ' +
        result.parts.check.toLocaleString() + ' candles): ' + (c.n ? (100 * c.rate).toFixed(1) + '% of ' + c.n + ' arrows' + split(c) : 'no arrows') +
        (late ? ', with the price 5 s after the open ' + (late.n ? (100 * late.rate).toFixed(1) + '% of ' + late.n + split(late) : 'no data') : '') +
        ' - target ' + Math.round(100 * result.target) + '% ' + (result.reached ? 'reached.' : 'not reached.'));
    }

    // Learned before the realistic-entry check existed (or it was never tried): learn again.
    const unconfirmed = (r) => !!r && !r.tooShort && !!r.check && r.check.n >= MIN_CONFIRM && r.check.lo >= 0.5 &&
      !r.lateTried && (r.size || 60) % 5 === 0;
    // Learned before CALL and PUT arrows were counted apart: learned again when it is selected.
    const noSides = (r) => !!r && !r.tooShort && !!r.check && !r.check.call;

    async function nextAsset() {
      if (nowSec() - listAt > LIST_EVERY_SEC || !list.length) {
        list = await client.tradableAssets();
        listAt = nowSec();
      }
      const fresh = (a) => {
        const r = trader.learned[a.activeId + '/60'];
        return r && nowSec() - (r.learnedAt || 0) < RELEARN_OTHERS_SEC && !unconfirmed(r);
      };
      trader.setLearning({ done: list.filter(fresh).length, total: list.length });
      return list.find((a) => !fresh(a)) || null;
    }

    async function step() {
      const s = trader.settings;
      const t = trader.target;
      const key = trader.learnedKey(t);
      const mine = key ? trader.learned[key] : null;
      const forced = force === key;
      if (key && (forced || (s.useLearned && (!mine || unconfirmed(mine) || noSides(mine) || nowSec() - (mine.learnedAt || 0) > RELEARN_SELECTED_SEC ||
          mine.wanted !== s.learnCandles || (mine.target !== undefined && Math.round(100 * mine.target) !== s.target))))) {
        force = '';
        interrupt = false;
        trader.setLearning({ forced });
        await learnOne(t.activeId, t.candleSize, t.name || ('asset ' + t.activeId), false);
        trader.setLearning({ busy: false, forced: false, step: '' });
        return true;
      }
      if (s.learnAll) {
        const next = await nextAsset();
        if (next) {
          await learnOne(next.activeId, 60, next.name, true);
          return true;
        }
        trader.setLearning({ busy: false, asset: '', key: '', step: '', note: 'every open asset is learned; each again after 24 hours' });
        return false;
      }
      trader.setLearning({ busy: false, asset: '', key: '', step: '', note: '' });
      return false;
    }

    // Waits, but wakes at once for "Learn now".
    async function idle(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end && !force && !stopped) await sleep(Math.min(500, end - Date.now()));
    }

    async function loop() {
      while (!stopped) {
        try {
          if (trader.status !== 'ready') { await idle(3000); continue; }
          busy = step();
          const worked = await busy;
          busy = null;
          if (!worked) await idle(5000);
        } catch (e) {
          busy = null;
          trader.setLearning({ busy: false, forced: false, step: '', note: 'learning paused: ' + e.message });
          await idle(30000);
        }
      }
    }

    return {
      start() {
        stopped = false;
        if (!running) { running = true; loop().finally(() => { running = false; }); }
      },
      stop() { stopped = true; },
      // Learns the selected asset now: a background asset being learned is left for later.
      learnNow() {
        force = trader.learnedKey(trader.target);
        if (force) { interrupt = true; trader.setLearning({ forced: true, busy: true, asset: trader.target.name, key: force, step: 'starting', fetched: 0 }); }
      },
      step, // for tests
    };
  }

  return { learn, breakoutArrows, outcomes, score, lateScore, stats, wilson, describe, versions, createLearningQueue, CURRENT, LEARN_END, CHOOSE_END };
});

/*
 * Next Minute signal engine: a JavaScript port of src/core.lua.
 *
 * It reproduces the QCS semantics of tests/qcs_emulator.lua exactly (nil versus NaN,
 * indicator warm-up, summation order), so for the same closed candles it gives the same
 * decision as the chart script. tests/test_extension_engine.py checks this bar by bar
 * against the Lua emulator. Keep this file in step with src/core.lua.
 *
 * Usage: const engine = NMSignalEngine.createEngine(settings);
 *        const { decision } = engine.update(closedCandle);   // 1 CALL, -1 PUT, 0 none
 * update() takes candles oldest first, each exactly once, after the candle has closed.
 * The decision is the arrow of the NEXT candle (the one that has just opened).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMSignalEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Breakout settings (brk*) and reverse match the chart script's "Breakout: ..." and "Reverse"
  // inputs; the defaults are the original rule (5 candles, close at the extreme, follow).
  const DEFAULTS = Object.freeze({
    method: 'breakout', brkCandles: 5, brkZone: 0, brkBody: 0, reverse: false,
    minScore: 0.30, minAgree: 3, useGate: false, gateWindow: 1000, gateZ: 2.0,
  });
  const BREAKOUT_CANDLES = 5;

  const WARMUP = 160, VOTE_FLOOR = 0.4, MAX_OPPOSE = 0.34;
  const MIN_ATR_RATIO = 0.5, MAX_ATR_RATIO = 3.0;
  const ADX_TREND = 25, ADX_RANGE = 18;
  const GATE_MIN_SIGNALS = 30, GATE_MIN_NET = 0.5, GATE_RAMP = 1.5;
  const FAMILIES = ['trend', 'reversion', 'pattern'];
  const REGIME_WEIGHT = {
    trending: { trend: 1.0, reversion: 0.4, pattern: 0.8 },
    mixed: { trend: 0.7, reversion: 0.7, pattern: 0.8 },
    ranging: { trend: 0.4, reversion: 1.0, pattern: 0.8 },
  };

  // Lua nil is `undefined` here. "valid" = a number that is not NaN (as in the emulator).
  const isNum = (x) => typeof x === 'number';
  const valid = (x) => typeof x === 'number' && x === x;
  const val = (x) => (typeof x !== 'number' || x !== x || x > 1e300 || x < -1e300 ? undefined : x);
  const or0 = (x) => (x === undefined ? 0 : x);
  const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const nabs = (x) => (x < 0 ? -x : x);
  const nmin = (a, b) => (a < b ? a : b);
  const nmax = (a, b) => (a > b ? a : b);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  // Lua truthiness: only nil (and false) fail; 0 passes.
  const has = (...xs) => xs.every((x) => x !== undefined);

  function rsiOf(up, down) {
    if (up === undefined || down === undefined) return undefined;
    if (down === 0) return up === 0 ? 50 : 100;
    return 100 - 100 / (1 + up / down);
  }

  // A series history: at(0) is this candle, at(n) n candles ago; undefined when unknown.
  class Hist {
    constructor(keep) { this.keep = Math.max(8, keep || 8); this.v = []; }
    push(x) {
      this.v.push(x);
      if (this.v.length > this.keep * 2) this.v.splice(0, this.v.length - this.keep);
    }
    at(n) { const i = this.v.length - 1 - n; return i >= 0 ? this.v[i] : undefined; }
  }

  // The last n raw inputs, for sma / stdev / highest / lowest.
  class Window {
    constructor(n) { this.n = n; this.buf = []; this.count = 0; }
    push(x) {
      this.buf.push(x);
      this.count += 1;
      if (this.buf.length > this.n * 4) this.buf.splice(0, this.buf.length - this.n);
    }
    ready() { return this.count >= this.n; }
    // Oldest first; stops early when fn returns false.
    each(fn) {
      for (let i = this.buf.length - this.n; i < this.buf.length; i++) if (fn(this.buf[i]) === false) return false;
      return true;
    }
  }

  function sma(n) {
    const w = new Window(n), out = new Hist();
    return { out, step(x) {
      w.push(x);
      let result = NaN;
      if (w.ready()) {
        let sum = 0;
        const ok = w.each((v) => { if (!valid(v)) return false; sum = sum + v; return true; });
        if (ok) result = sum / n;
      }
      out.push(result);
      return result;
    } };
  }

  function stdev(n) {
    const w = new Window(n), out = new Hist();
    return { out, step(x) {
      w.push(x);
      let result = NaN;
      if (w.ready()) {
        let sum = 0;
        const ok = w.each((v) => { if (!valid(v)) return false; sum = sum + v; return true; });
        if (ok) {
          const mean = sum / n;
          let squares = 0;
          w.each((v) => { const d = v - mean; squares = squares + d * d; return true; });
          result = Math.pow(squares / n, 0.5);
        }
      }
      out.push(result);
      return result;
    } };
  }

  function extreme(n, better) {
    const w = new Window(n), out = new Hist();
    return { out, step(x) {
      w.push(x);
      let result = NaN;
      if (w.ready()) {
        let best;
        w.each((v) => {
          if (!valid(v)) { best = undefined; return false; }
          if (best === undefined || better(v, best)) best = v;
          return true;
        });
        if (best !== undefined) result = best;
      }
      out.push(result);
      return result;
    } };
  }
  const highest = (n) => extreme(n, (a, b) => a > b);
  const lowest = (n) => extreme(n, (a, b) => a < b);

  // ema / rma / ssma: seeded with the SMA of the first n valid inputs; NaN while the input is invalid.
  function smoother(n, alpha) {
    const out = new Hist();
    let state, count = 0, sum = 0;
    return { out, step(x) {
      let result = NaN;
      if (valid(x)) {
        if (state === undefined) {
          count += 1;
          sum = sum + x;
          if (count === n) { state = sum / n; result = state; }
        } else {
          const a = alpha(n);
          state = a * x + (1 - a) * state;
          result = state;
        }
      }
      out.push(result);
      return result;
    } };
  }
  const ema = (n) => smoother(n, (k) => 2 / (k + 1));
  const rma = (n) => smoother(n, (k) => 1 / k);
  const ssma = rma;

  // QCS max over values: nil if any value is not a number; NaN compares like in Lua.
  function qmax(...xs) {
    let best;
    for (const x of xs) {
      if (!isNum(x)) return undefined;
      if (best === undefined || x > best) best = x;
    }
    return best;
  }

  // Parabolic SAR exactly as the emulator computes it (from the raw candle values).
  function sar(start, step, maxAf) {
    const out = new Hist();
    let up, prev, ep, af;
    return { out, step(b, H, L, C) {
      let result = NaN;
      if (b >= 2) {
        if (up === undefined) {
          up = C(2) >= C(1);
          prev = up ? L(1) : H(1);
          ep = up ? H(1) : L(1);
          af = start;
        }
        let value = prev + af * (ep - prev);
        if (up) {
          value = Math.min(value, L(b - 1), L(b - 2) !== undefined ? L(b - 2) : L(b - 1));
          if (L(b) < value) {
            value = Math.max(ep, H(b - 1), H(b));
            up = false; ep = L(b); af = start;
          } else if (H(b) > ep) {
            ep = H(b); af = Math.min(af + step, maxAf);
          }
        } else {
          value = Math.max(value, H(b - 1), H(b - 2) !== undefined ? H(b - 2) : H(b - 1));
          if (H(b) > value) {
            value = Math.min(ep, L(b - 1), L(b));
            up = true; ep = H(b); af = start;
          } else if (L(b) < ep) {
            ep = L(b); af = Math.min(af + step, maxAf);
          }
        }
        prev = value;
        result = value;
      }
      out.push(result);
      return result;
    } };
  }

  function normalize(settings) {
    const s = Object.assign({}, DEFAULTS, settings || {});
    const int = (x, lo, hi, dflt) => {
      const n = Math.round(Number(x));
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
    };
    return {
      // 'breakout' (chart script option 1) or 'vote' (option 2).
      method: s.method === 'vote' || s.method === 2 ? 'vote' : 'breakout',
      brkCandles: int(s.brkCandles, 2, 60, 5), // lookback, this candle included
      brkZone: int(s.brkZone, 0, 45, 0), // close within this % of the range from the high / low
      brkBody: int(s.brkBody, 0, 90, 0), // body at least this % of the candle
      reverse: !!s.reverse, // trade the opposite of the arrow (both methods)
      minScore: Number(s.minScore),
      minAgree: Math.round(Number(s.minAgree)),
      useGate: !!s.useGate,
      gateWindow: Math.round(Number(s.gateWindow)),
      gateZ: Number(s.gateZ),
    };
  }

  function createEngine(settings) {
    const cfg = normalize(settings);

    // Raw candles; bar numbers start at 1 like the emulator.
    const O = new Hist(), H = new Hist(), L = new Hist(), C = new Hist();
    let bar = 0;
    const byBar = (hist) => (b) => (b < 1 || b > bar ? undefined : hist.at(bar - b));
    const Hb = byBar(H), Lb = byBar(L), Cb = byBar(C);

    const ema5 = ema(5), ema9 = ema(9), ema10 = ema(10), ema21 = ema(21), ema50 = ema(50);
    const ema12 = ema(12), ema26 = ema(26);
    const htfFast = ema(45), htfSlow = ema(105);
    const macdSig = ema(9);
    const rsiUp = ssma(14), rsiDn = ssma(14), rsi2Up = ssma(2), rsi2Dn = ssma(2);
    const bbMid = sma(20), bbDev = stdev(20);
    const bbBwHi = highest(100), bbBwLo = lowest(100);
    const atrS = rma(14), atrAvg = sma(100);
    const hh14 = highest(14), ll14 = lowest(14);
    const support = lowest(35), resist = highest(35);
    const sarS = sar(0.02, 0.02, 0.2);
    const brkHi = highest(cfg.brkCandles), brkLo = lowest(cfg.brkCandles);
    const pdiR = rma(14), mdiR = rma(14), adxR = rma(14);
    const stochK = sma(3), stochD = sma(3);

    const macdH = new Hist(), bbBwH = new Hist(), haCloseH = new Hist();
    const barsH = new Hist(), haOpenH = new Hist(), sarDirH = new Hist();
    const upRunH = new Hist(), dnRunH = new Hist(), decisionH = new Hist();
    const predH = {}, winsH = {}, lossesH = {};
    for (const k of FAMILIES) {
      predH[k] = new Hist();
      winsH[k] = new Hist(cfg.gateWindow + 2);
      lossesH[k] = new Hist(cfg.gateWindow + 2);
    }

    function update(candle) {
      const o = +candle.open, h = +candle.high, l = +candle.low, c = +candle.close;
      const prevClose = C.at(0);
      bar += 1;
      O.push(o); H.push(h); L.push(l); C.push(c);

      // Built-in series of this candle.
      const trValue = bar === 1 ? h - l : Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
      const delta = bar === 1 ? undefined : c - prevClose;
      const negDelta = delta === undefined ? undefined : -delta;

      // Indicator series, stepped on every candle.
      ema5.step(c); ema9.step(c); ema10.step(c); ema21.step(c); ema50.step(c);
      const e12 = ema12.step(c), e26 = ema26.step(c);
      htfFast.step(c); htfSlow.step(c);
      const macd = e12 - e26;
      macdH.push(macd);
      macdSig.step(macd);
      rsiUp.step(qmax(delta, 0)); rsiDn.step(qmax(negDelta, 0));
      rsi2Up.step(qmax(delta, 0)); rsi2Dn.step(qmax(negDelta, 0));
      const mid0 = bbMid.step(c), dev0 = bbDev.step(c);
      const bw = dev0 * 4 / mid0;
      bbBwH.push(bw);
      bbBwHi.step(bw); bbBwLo.step(bw);
      const atr0 = atrS.step(trValue);
      atrAvg.step(atr0);
      hh14.step(h); ll14.step(l);
      support.step(l); resist.step(h);
      brkHi.step(h); brkLo.step(l);
      sarS.step(bar, Hb, Lb, Cb);
      haCloseH.push((o + h + l + c) / 4);

      const o0 = val(o), h0 = val(h), l0 = val(l), c0 = val(c);
      const o1 = val(O.at(1)), h1 = val(H.at(1)), l1 = val(L.at(1)), c1 = val(C.at(1));
      const o2 = val(O.at(2)), c2 = val(C.at(2));

      const nbar = or0(val(barsH.at(0))) + 1;
      barsH.push(nbar);

      // Wilder's directional movement (for ADX).
      let upMove = 0, dnMove = 0;
      if (has(h1, l1)) { upMove = h0 - h1; dnMove = l1 - l0; }
      const pdm = (upMove > dnMove && upMove > 0) ? upMove : 0;
      const mdm = (dnMove > upMove && dnMove > 0) ? dnMove : 0;

      // Lane's raw stochastic %K; 50 while the 14-candle range is flat.
      const hh = val(hh14.out.at(0)), ll = val(ll14.out.at(0));
      const stochRaw = (has(hh, ll) && hh > ll) ? 100 * (c0 - ll) / (hh - ll) : 50;

      const pdi0 = 100 * pdiR.step(pdm / atr0);
      const mdi0 = 100 * mdiR.step(mdm / atr0);
      const adx0 = 100 * adxR.step(Math.abs(pdi0 - mdi0) / (pdi0 + mdi0));
      stochD.step(stochK.step(stochRaw));

      // Heikin-Ashi open.
      const hao1p = val(haOpenH.at(0)), hac1p = val(haCloseH.at(1));
      const hao0 = has(hao1p, hac1p) ? (hao1p + hac1p) / 2 : (o0 + c0) / 2;
      haOpenH.push(hao0);

      // Parabolic SAR side: +1 price above SAR, -1 below.
      let sarDir = 0;
      const ps = val(sarS.out.at(0));
      if (ps !== undefined) sarDir = (c0 >= ps) ? 1 : -1;
      const sarD1 = or0(val(sarDirH.at(0))), sarD2 = or0(val(sarDirH.at(1)));
      sarDirH.push(sarDir);

      const upRun = (c0 > o0) ? or0(val(upRunH.at(0))) + 1 : 0;
      const dnRun = (c0 < o0) ? or0(val(dnRunH.at(0))) + 1 : 0;
      upRunH.push(upRun); dnRunH.push(dnRun);

      const e50 = val(ema50.out.at(0));
      const r14 = rsiOf(val(rsiUp.out.at(0)), val(rsiDn.out.at(0)));
      const mid = val(bbMid.out.at(0));
      const dev = val(bbDev.out.at(0));
      const atr = val(atrS.out.at(0));
      const span = h0 - l0;

      // Strategy votes for the NEXT candle, in the order of core.lua (the sums depend on it).
      const votes = [];
      const vote = (kind, trigger, weight, value) => votes.push({ kind, trigger, weight, value });

      { // EMA 9/21/50 stack with a rising (falling) EMA 21
        let v = 0;
        const e9 = val(ema9.out.at(0)), e21 = val(ema21.out.at(0)), e21_3 = val(ema21.out.at(3));
        if (has(e9, e21, e50, e21_3)) {
          if (e9 > e21 && e21 > e50 && e21 > e21_3 && c0 > e21) v = 1;
          else if (e9 < e21 && e21 < e50 && e21 < e21_3 && c0 < e21) v = -1;
        }
        vote('trend', false, 1, v);
      }
      { // Higher-timeframe trend (Elder's triple screen idea)
        let v = 0;
        const f = val(htfFast.out.at(0)), s = val(htfSlow.out.at(0));
        if (has(f, s)) {
          if (f > s && c0 > s) v = 1;
          else if (f < s && c0 < s) v = -1;
        }
        vote('trend', false, 1, v);
      }
      { // Three Heikin-Ashi candles of one colour; full vote without a counter wick
        let v = 0;
        const hao1 = val(haOpenH.at(1)), hao2 = val(haOpenH.at(2));
        const hac0 = val(haCloseH.at(0)), hac1 = val(haCloseH.at(1)), hac2 = val(haCloseH.at(2));
        if (has(hao1, hao2, hac0, hac1, hac2)) {
          if (hac0 > hao0 && hac1 > hao1 && hac2 > hao2) v = (l0 >= nmin(hao0, hac0) - 1e-12) ? 1 : 0.5;
          else if (hac0 < hao0 && hac1 < hao1 && hac2 < hao2) v = (h0 <= nmax(hao0, hac0) + 1e-12) ? -1 : -0.5;
        }
        vote('trend', false, 1, v);
      }
      { // EMA 5/10 cross (this or the previous candle), halved against the EMA 50 side
        const cross = (f0, f1, s0, s1) => {
          if (has(f0, f1, s0, s1)) {
            if (f1 <= s1 && f0 > s0) return 1;
            if (f1 >= s1 && f0 < s0) return -1;
          }
          return 0;
        };
        const f0 = val(ema5.out.at(0)), f1 = val(ema5.out.at(1)), f2 = val(ema5.out.at(2));
        const s0 = val(ema10.out.at(0)), s1 = val(ema10.out.at(1)), s2 = val(ema10.out.at(2));
        let v = cross(f0, f1, s0, s1);
        if (v === 0) v = 0.6 * cross(f1, f2, s1, s2);
        if (v !== 0 && e50 !== undefined && ((v > 0 && c0 < e50) || (v < 0 && c0 > e50))) v = v * 0.5;
        vote('trend', true, 1, v);
      }
      { // Pullback to EMA 21 inside an EMA 21/50 trend, closing back with the trend
        let v = 0;
        const e21 = val(ema21.out.at(0)), e21_1 = val(ema21.out.at(1)), e50_5 = val(ema50.out.at(5));
        if (has(e21, e21_1, e50, e50_5, h1, l1)) {
          if (e21 > e50 && e50 > e50_5 && (l0 <= e21 || l1 <= e21_1) && c0 > e21 && c0 > o0) v = 1;
          else if (e21 < e50 && e50 < e50_5 && (h0 >= e21 || h1 >= e21_1) && c0 < e21 && c0 < o0) v = -1;
        }
        vote('trend', true, 1, v);
      }
      { // MACD 12/26/9 crossing its signal line (stronger on the matching side of zero)
        let v = 0;
        const m0 = val(macdH.at(0)), m1 = val(macdH.at(1));
        const s0 = val(macdSig.out.at(0)), s1 = val(macdSig.out.at(1));
        if (has(m0, m1, s0, s1)) {
          const hist0 = m0 - s0, hist1 = m1 - s1;
          if (hist1 <= 0 && hist0 > 0) v = (m0 > 0) ? 1 : 0.7;
          else if (hist1 >= 0 && hist0 < 0) v = (m0 < 0) ? -1 : -0.7;
        }
        vote('trend', true, 1, v);
      }
      { // Parabolic SAR flip (this or the previous candle)
        let v = 0;
        if (sarDir !== 0 && sarD1 !== 0) {
          if (sarDir !== sarD1) v = sarDir;
          else if (sarD2 !== 0 && sarD1 !== sarD2) v = 0.6 * sarDir;
        }
        vote('trend', true, 1, v);
      }
      { // Bollinger squeeze (narrowest 20% of 100 candles) then a close outside the band
        let v = 0;
        const bw1 = val(bbBwH.at(1)), hi1 = val(bbBwHi.out.at(1)), lo1 = val(bbBwLo.out.at(1));
        if (has(bw1, hi1, lo1, mid, dev) && hi1 > lo1 && bw1 <= lo1 + 0.2 * (hi1 - lo1)) {
          if (c0 > mid + 2 * dev && c0 > o0) v = 1;
          else if (c0 < mid - 2 * dev && c0 < o0) v = -1;
        }
        vote('trend', true, 1, v);
      }
      { // RSI 14 back inside 30/70; half vote while deeply stretched (20/80)
        let v = 0;
        const r1 = rsiOf(val(rsiUp.out.at(1)), val(rsiDn.out.at(1)));
        if (has(r14, r1)) {
          if (r1 < 30 && r14 >= 30) v = 1;
          else if (r1 > 70 && r14 <= 70) v = -1;
          else if (r14 < 20) v = 0.5;
          else if (r14 > 80) v = -0.5;
        }
        vote('reversion', true, 1, v);
      }
      { // Connors RSI(2) pullback in the direction of the EMA 50
        let v = 0;
        const r2 = rsiOf(val(rsi2Up.out.at(0)), val(rsi2Dn.out.at(0)));
        if (has(r2, e50)) {
          if (r2 < 10 && c0 > e50) v = 1;
          else if (r2 > 90 && c0 < e50) v = -1;
        }
        vote('reversion', true, 1, v);
      }
      { // Bollinger 20/2 band rejection or re-entry
        let v = 0;
        const mid1 = val(bbMid.out.at(1)), dev1 = val(bbDev.out.at(1));
        if (has(mid, dev, mid1, dev1, c1)) {
          const lower = mid - 2 * dev, upper = mid + 2 * dev;
          if ((c1 < mid1 - 2 * dev1 && c0 >= lower) || (l0 < lower && c0 >= lower && c0 > o0)) v = 1;
          else if ((c1 > mid1 + 2 * dev1 && c0 <= upper) || (h0 > upper && c0 <= upper && c0 < o0)) v = -1;
        }
        vote('reversion', true, 1, v);
      }
      { // Stochastic 14/3/3 %K crossing %D from oversold (<25) or overbought (>75)
        let v = 0;
        const k0 = val(stochK.out.at(0)), k1 = val(stochK.out.at(1));
        const d0 = val(stochD.out.at(0)), d1 = val(stochD.out.at(1));
        if (has(k0, k1, d0, d1)) {
          if (k1 <= d1 && k0 > d0 && nmin(k0, k1) < 25) v = 1;
          else if (k1 >= d1 && k0 < d0 && nmax(k0, k1) > 75) v = -1;
        }
        vote('reversion', true, 1, v);
      }
      { // Rejection of support / resistance (extremes of candles 6-40 back) with a long wick
        let v = 0;
        const sup = val(support.out.at(6)), res = val(resist.out.at(6));
        if (has(atr, sup, res) && span > 0) {
          const tol = 0.35 * atr;
          const lowerWick = nmin(o0, c0) - l0;
          const upperWick = h0 - nmax(o0, c0);
          if (c0 > o0 && lowerWick >= 0.4 * span && l0 <= sup + tol && l0 >= sup - atr && c0 > sup) v = 1;
          else if (c0 < o0 && upperWick >= 0.4 * span && h0 >= res - tol && h0 <= res + atr && c0 < res) v = -1;
        }
        vote('reversion', true, 1, v);
      }
      { // Fade 4+ candles of one colour while RSI is stretched (half weight)
        let v = 0;
        if (r14 !== undefined) {
          if (upRun >= 4 && r14 > 60) v = -1;
          else if (dnRun >= 4 && r14 < 40) v = 1;
        }
        vote('reversion', true, 0.5, v);
      }
      { // Candlestick reversals: engulfing, hammer / shooting star, morning / evening star
        let v = 0;
        let bull = false, bear = false;
        if (has(atr, c1, o1, c2, o2) && span > 0) {
          const body = nabs(c0 - o0), body1 = nabs(c1 - o1), body2 = nabs(c2 - o2);
          const upperWick = h0 - nmax(o0, c0);
          const lowerWick = nmin(o0, c0) - l0;
          if (c1 < o1 && c0 > o0 && o0 <= c1 && c0 >= o1 && body > body1) bull = true;
          if (c1 > o1 && c0 < o0 && o0 >= c1 && c0 <= o1 && body > body1) bear = true;
          if (span >= 0.6 * atr) {
            if (lowerWick >= 0.6 * span && upperWick <= 0.2 * span) bull = true;
            if (upperWick >= 0.6 * span && lowerWick <= 0.2 * span) bear = true;
          }
          if (body2 >= 0.5 * atr && body1 <= 0.35 * body2) {
            if (c2 < o2 && c0 > o0 && c0 > (o2 + c2) / 2) bull = true;
            if (c2 > o2 && c0 < o0 && c0 < (o2 + c2) / 2) bear = true;
          }
        }
        if (bull !== bear) {
          let pctB;
          if (has(mid, dev) && dev > 0) pctB = (c0 - (mid - 2 * dev)) / (4 * dev);
          if (bull) v = ((pctB !== undefined && pctB < 0.25) || (r14 !== undefined && r14 < 40)) ? 1 : 0.5;
          else v = ((pctB !== undefined && pctB > 0.75) || (r14 !== undefined && r14 > 60)) ? -1 : -0.5;
        }
        vote('pattern', true, 1, v);
      }

      // Evidence gate: per family, how often its direction won on the next candle (closed candles only).
      const move = sgn(c0 - o0);
      const trust = { trend: 1, reversion: 1, pattern: 1 };
      for (const kind of FAMILIES) {
        let net = 0;
        for (const v of votes) if (v.kind === kind) net = net + v.weight * v.value;
        let pred = 0;
        if (net >= GATE_MIN_NET) pred = 1; else if (net <= -GATE_MIN_NET) pred = -1;
        const prev = or0(val(predH[kind].at(0)));
        predH[kind].push(pred);
        const won = (prev !== 0 && move !== 0 && prev === move) ? 1 : 0;
        const lost = (prev !== 0 && move !== 0 && prev !== move) ? 1 : 0;
        const totalWon = or0(val(winsH[kind].at(0))) + won;
        const totalLost = or0(val(lossesH[kind].at(0))) + lost;
        winsH[kind].push(totalWon);
        lossesH[kind].push(totalLost);
        if (cfg.useGate) {
          const w = totalWon - or0(val(winsH[kind].at(cfg.gateWindow)));
          const lc = totalLost - or0(val(lossesH[kind].at(cfg.gateWindow)));
          let t = 0;
          if (w + lc >= GATE_MIN_SIGNALS) {
            const z = (w - lc) / Math.pow(w + lc, 0.5);
            t = clamp01((nabs(z) - cfg.gateZ) / GATE_RAMP);
            if (z < 0) t = -t;
          }
          trust[kind] = t;
        }
      }

      // Decision for the next candle: 1 = HIGHER (CALL), -1 = LOWER (PUT), 0 = wait.
      let regime;
      const adx = val(adx0);
      if (adx !== undefined) regime = adx >= ADX_TREND ? 'trending' : adx <= ADX_RANGE ? 'ranging' : 'mixed';
      let atrRatio;
      const avg = val(atrAvg.out.at(0));
      if (has(atr, avg) && avg > 0) atrRatio = atr / avg;

      let decision = 0, score = 0;
      if (cfg.method === 'vote' && nbar > WARMUP && regime !== undefined) {
        const familyWeight = REGIME_WEIGHT[regime];
        let potential = 0, weighted = 0;
        const effective = [];
        for (const v of votes) {
          const t = trust[v.kind];
          const base = v.weight * familyWeight[v.kind];
          const w = base * nabs(t);
          let value = v.value;
          if (t < 0) value = -value;
          if (t !== 0) potential = potential + base;
          weighted = weighted + w * value;
          effective.push({ w, value, trigger: v.trigger });
        }
        if (potential > 0) score = weighted / potential;
        const side = sgn(score);
        if (side !== 0 && nabs(score) >= cfg.minScore) {
          let agree = 0, agreeW = 0, opposeW = 0, triggered = false;
          for (const e of effective) {
            if (e.w > 0 && e.value * side >= VOTE_FLOOR) {
              agree += 1;
              agreeW = agreeW + e.w * nabs(e.value);
              if (e.trigger) triggered = true;
            } else if (e.w > 0 && e.value * side <= -VOTE_FLOOR) {
              opposeW = opposeW + e.w * nabs(e.value);
            }
          }
          const calm = (atrRatio === undefined) || (atrRatio >= MIN_ATR_RATIO && atrRatio <= MAX_ATR_RATIO);
          if (agree >= cfg.minAgree && triggered && opposeW <= MAX_OPPOSE * agreeW && calm) decision = side;
        }
      }
      if (cfg.method === 'breakout') {
        // Breakout: the close is at (or within brkZone % of the range from) the high / low of the
        // last brkCandles candles, this one included, and its body is at least brkBody % of the candle.
        const hh = val(brkHi.out.at(0)), ll = val(brkLo.out.at(0));
        if (has(hh, ll, o0, h0, l0, c0) && hh > ll && nabs(c0 - o0) >= cfg.brkBody / 100 * (h0 - l0)) {
          const zone = cfg.brkZone / 100 * (hh - ll);
          if (c0 >= hh - zone) decision = 1;
          else if (c0 <= ll + zone) decision = -1;
        }
        score = decision;
      }
      if (cfg.reverse && decision !== 0) { decision = -decision; score = -score; }
      decisionH.push(decision);

      return { bar: nbar, decision, score, regime: regime || null, time: candle.from };
    }

    return {
      update,
      settings: cfg,
      get bars() { return bar; },
      // The arrow of the candle after the last closed one (0 before any candle).
      get nextDecision() { return or0(decisionH.at(0)); },
    };
  }

  return { createEngine, DEFAULTS, WARMUP, BREAKOUT_CANDLES };
});

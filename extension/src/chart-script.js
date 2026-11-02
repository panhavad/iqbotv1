/*
 * Keeps the chart scripts in the user's account (Indicators > Scripts) in step with the logic the
 * extension learned for each asset.
 *
 * The "Next Minute HIGHER/LOWER" and "Next Minute Scoreboard" scripts found in the account are
 * saved again (same script, same id) with the current code (lua-scripts.js, built from src/*.lua)
 * and its LEARNED table filled in: one row per asset id, which the script matches with
 * current_ticker_id. IQ Option refuses scripts longer than about 25,000 characters, so the saved
 * copy is compact (no comment lines or indentation). The chart runs the new code after the
 * traderoom page is reloaded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMChartScript = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BEGIN = '-- LEARNED SETTINGS BEGIN';
  const END = '-- LEARNED SETTINGS END';
  const MAX_LENGTH = 24900; // IQ Option accepted 24,670 characters and refused 25,004 ("Script is too long"), 2 Nov 2026
  const KINDS = [
    ['signal', 'Next Minute HIGHER/LOWER', /instrument\s*\{\s*name\s*=\s*"Next Minute HIGHER\/LOWER"/],
    ['scoreboard', 'Next Minute Scoreboard', /instrument\s*\{\s*name\s*=\s*"Next Minute Scoreboard"/],
  ];

  // Which of our scripts this code is: 'signal', 'scoreboard' or null.
  function kindOf(code) {
    for (const [kind, , re] of KINDS) if (re.test(String(code || ''))) return kind;
    return null;
  }

  // The script without comment lines, blank lines and indentation (same code, about 30% shorter).
  function compact(code, kind) {
    const title = (KINDS.find((k) => k[0] === kind) || KINDS[0])[1];
    const lines = String(code).split('\n')
      .filter((l) => l.startsWith(BEGIN) || l.startsWith(END) || !/^\s*(--|$)/.test(l))
      .map((l) => l.trimStart());
    return ['-- ' + title + ': compact copy written by the Next Minute Chrome extension, with the settings it',
      '-- learned for each asset. The commented source is ' + (kind === 'scoreboard' ? 'NextMinuteScoreboard.lua' : 'NextMinuteSignal.lua') + '.']
      .concat(lines).join('\n');
  }

  // Learned results to put in the table, as [activeId, result]: the 1-minute logic of every learned
  // asset; for `preferKey` ('activeId/size', the selected chart) its own candle size wins, and it
  // comes first so it is kept when the table must be shortened.
  function tableRows(learned, preferKey) {
    const byId = new Map();
    for (const [key, r] of Object.entries(learned || {})) {
      if (!r || r.tooShort || !r.rules || r.rules.method === 'vote') continue;
      const [id, size] = key.split('/').map(Number);
      const preferred = key === preferKey;
      if (!Number.isFinite(id) || (size !== 60 && !preferred)) continue;
      if (byId.has(id) && !preferred) continue;
      byId.set(id, r);
    }
    const preferId = preferKey ? Number(preferKey.split('/')[0]) : NaN;
    return [...byId.entries()].sort((a, b) => (b[0] === preferId) - (a[0] === preferId) || a[0] - b[0]);
  }

  const rowLine = ([id, r]) => {
    const x = r.rules;
    return '[' + id + ']={' + Math.round(x.brkCandles) + ',' + Math.round(x.brkZone) + ',' + Math.round(x.brkBody) + ',' + (x.reverse ? 'true' : 'false') + '},';
  };

  function tableLines(learned, preferKey) {
    return tableRows(learned, preferKey).map(rowLine);
  }

  // The script code with its LEARNED table replaced by `lines`.
  function withLearned(code, lines) {
    const all = String(code).split('\n');
    const begin = all.findIndex((l) => l.startsWith(BEGIN));
    const end = all.findIndex((l) => l.startsWith(END));
    const open = all.findIndex((l, i) => i > begin && /^local LEARNED = \{/.test(l));
    if (begin < 0 || end < 0 || open < 0 || open > end) throw new Error('the script has no LEARNED SETTINGS section');
    return all.slice(0, open + 1).concat(lines, ['}'], all.slice(end)).join('\n');
  }

  // The code saved into the account for one kind of script: {code, assets, dropped}. Rows are kept
  // in order (the selected asset first) while the script stays under IQ Option's length limit, then
  // sorted by asset id, so the script changes only when the learned settings do.
  function buildScript(lua, kind, learned, preferKey) {
    const base = compact(lua[kind], kind);
    const rows = tableRows(learned, preferKey);
    let used = withLearned(base, []).length;
    const kept = [];
    for (const row of rows) {
      const line = rowLine(row);
      if (used + line.length + 1 > MAX_LENGTH) break;
      kept.push(row);
      used += line.length + 1;
    }
    kept.sort((a, b) => a[0] - b[0]);
    return { code: withLearned(base, kept.map(rowLine)), assets: kept.length, dropped: rows.length - kept.length };
  }

  // Saves the current scripts with the learned table into the account. Returns
  // {found: our scripts in the account, updated: saved because they changed, assets: rows, dropped,
  //  scripts: [{kind, before, after}] (their code before and after)}.
  async function updateChartScripts(client, lua, learned, preferKey) {
    const scripts = await client.scripts();
    const result = { found: 0, updated: 0, assets: 0, dropped: 0, scripts: [] };
    for (const s of scripts) {
      const kind = kindOf(s.script);
      if (!kind || !lua[kind]) continue;
      result.found += 1;
      const built = buildScript(lua, kind, learned, preferKey);
      result.assets = built.assets;
      result.dropped = built.dropped;
      result.scripts.push({ kind, before: s.script, after: built.code });
      if (built.code === s.script) continue;
      await client.saveScript(s.id, built.code);
      result.updated += 1;
    }
    return result;
  }

  // Whether a chart running `loadedCode` shows asset `activeId` differently from `currentCode`:
  // other code, or another row of learned settings for that asset.
  function differsFor(loadedCode, currentCode, activeId) {
    const split = (code) => {
      const rows = new Map();
      const rest = [];
      for (const line of String(code || '').split('\n')) {
        const m = /^\s*\[(\d+)\]\s*=\s*\{[^}]*\},/.exec(line);
        if (m) rows.set(Number(m[1]), line.replace(/\s+|--.*$/g, '')); else rest.push(line);
      }
      return { rows, rest: rest.join('\n') };
    };
    const a = split(loadedCode);
    const b = split(currentCode);
    return a.rest !== b.rest || (a.rows.get(Number(activeId)) || '') !== (b.rows.get(Number(activeId)) || '');
  }

  return { updateChartScripts, buildScript, compact, withLearned, tableLines, kindOf, differsFor, MAX_LENGTH, BEGIN, END };
});

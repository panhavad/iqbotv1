// Downloads candle history from IQ Option through the logged-in test browser (see
// extension/tools/start-test-browser.ps1 and iq-page.js). Read-only.
//
//   node research/fetch_history.js <activeId> <name> <days> [candleSeconds=60]
// Writes research/data/<name>-<candleSeconds>.csv: from,open,high,low,close (oldest first).
// Candles already in the file are kept; re-running adds the missing ones.
'use strict';
const fs = require('fs');
const path = require('path');
const { connectPage } = require('./iq-page');

function readExisting(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((l) => l.split(',').map(Number));
}

async function fetchHistory(page, activeId, name, days, size = 60) {
  const out = path.join(__dirname, 'data', `${name}-${size}.csv`);
  const byFrom = new Map(readExisting(out).map((r) => [r[0], r]));
  const start = Math.floor(Date.now() / 1000) - Number(days) * 86400;
  let to = Math.floor(Date.now() / 1000);
  let requests = 0;
  while (to > start) {
    let rows;
    for (let attempt = 0; ; attempt++) {
      try {
        rows = await page.candles(activeId, size, to, 1000);
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    requests++;
    if (!rows.length) break;
    for (const r of rows) byFrom.set(r[0], r);
    const first = rows.reduce((a, r) => Math.min(a, r[0]), Infinity);
    if (requests % 20 === 0) console.log(`  ${name}: ${byFrom.size} candles, back to ${new Date(first * 1000).toISOString().slice(0, 16)}`);
    if (first >= to) break;
    to = first - 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  const all = [...byFrom.values()].sort((a, b) => a[0] - b[0]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, 'from,open,high,low,close\n' + all.map((r) => r.join(',')).join('\n') + '\n');
  const span = all.length ? `${new Date(all[0][0] * 1000).toISOString().slice(0, 16)} -> ${new Date(all[all.length - 1][0] * 1000).toISOString().slice(0, 16)}` : '';
  console.log(`${name}: ${all.length} candles saved (${requests} requests) ${span}`);
  return all.length;
}

module.exports = { fetchHistory };

if (require.main === module) {
  const [activeId, name, days = '30', sizeArg = '60'] = process.argv.slice(2);
  if (!activeId || !name) {
    console.error('usage: node research/fetch_history.js <activeId> <name> <days> [candleSeconds]');
    process.exit(2);
  }
  (async () => {
    const page = await connectPage();
    await fetchHistory(page, activeId, name, days, Number(sizeArg));
    page.close();
    process.exit(0);
  })().catch((e) => { console.error(name + ': ' + e.message); process.exit(1); });
}
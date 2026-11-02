// Downloads 1-minute candles of every real-market asset in real-assets.json (the real markets
// that IQ Option offers with a 1-minute or shorter option at some hour) into data/real/.
//
//   node research/fetch_real.js [days=60]
'use strict';
const { connectPage } = require('./iq-page');
const { fetchHistory } = require('./fetch_history');
const ASSETS = require('./real-assets.json');

(async () => {
  const days = Number(process.argv[2] || 60);
  let page = await connectPage();
  for (const a of ASSETS) {
    try {
      await fetchHistory(page, a.id, 'real/' + a.name, days, 60);
    } catch (e) {
      console.log(`${a.name}: ${e.message}; reconnecting`);
      try { page.close(); } catch (_) { /* already closed */ }
      page = await connectPage();
    }
  }
  page.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

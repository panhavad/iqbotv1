// Lists the assets that can be traded right now with a Binary (turbo) or Blitz option, with their
// payout and expiries, real markets first. Read-only.
//
//   node research/assets.js [--all]      (--all also lists closed and suspended assets)
'use strict';
const { connectPage } = require('./iq-page');

const KINDS = ['turbo', 'blitz', 'binary'];

(async () => {
  const all = process.argv.includes('--all');
  const page = await connectPage();
  const init = await page.call('get-initialization-data', '4.0', {}, 30000);
  page.close();
  const rows = [];
  for (const kind of KINDS) {
    const actives = (init[kind] && init[kind].actives) || {};
    for (const a of Object.values(actives)) {
      const open = a.enabled && !a.is_suspended;
      if (!open && !all) continue;
      const opt = a.option || {};
      rows.push({
        kind,
        id: a.id,
        ticker: a.ticker || String(a.name || '').replace(/^front\./, ''),
        name: String(a.description || a.name || '').replace(/^front\./, ''),
        market: a.provider === 'OTC' ? 'OTC' : 'real',
        open,
        payout: opt.profit ? 100 - Number(opt.profit.commission) : NaN,
        expiries: (opt.expiration_times || []).join(' '),
      });
    }
  }
  rows.sort((a, b) => (a.market === b.market ? 0 : a.market === 'real' ? -1 : 1) || a.kind.localeCompare(b.kind) || b.payout - a.payout);
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  console.log(`Open options at ${now} UTC: ${rows.filter((r) => r.market === 'real').length} real-market, ${rows.filter((r) => r.market === 'OTC').length} OTC\n`);
  console.log('market kind    id    ticker               name                          payout  expiries (s)' + (all ? '  open' : ''));
  for (const r of rows) {
    console.log(`${r.market.padEnd(6)} ${r.kind.padEnd(6)} ${String(r.id).padStart(5)}  ${r.ticker.slice(0, 20).padEnd(20)} ${r.name.slice(0, 29).padEnd(29)} ${String(r.payout).padStart(5)}%  ${r.expiries}` + (all ? '  ' + r.open : ''));
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

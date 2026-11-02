// Starts the dedicated test Chrome (logged-in profile) with this repository's extension loaded.
//
// Chrome 137 and later ignore --load-extension, so the extension is loaded over a DevTools pipe
// (Extensions.loadUnpacked, which needs --enable-unsafe-extension-debugging). Chrome keeps such an
// extension for the session only, so it is loaded again at every start, always from this folder.
// The fixed "key" in manifest.json keeps its ID, and with it the saved settings and learned logic,
// the same every time. This process holds the pipe and ends when Chrome is closed.
//
// Usage: node extension/tools/test-browser.js [--port 9555] [--profile <dir>] [--url <url>] [--headless]
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const opt = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(opt('port', 9555));
const PROFILE = opt('profile', path.join(process.env.LOCALAPPDATA || '', 'iqbot', 'chrome-profile'));
const URL = opt('url', 'https://iqoption.com/traderoom');
const HEADLESS = process.argv.includes('--headless');
const EXTENSION = path.resolve(__dirname, '..');

const log = (text) => console.log(new Date().toISOString().slice(11, 19) + '  ' + text);

const chrome = [
  path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].find((p) => fs.existsSync(p));
if (!chrome) { log('Google Chrome was not found.'); process.exit(1); }

fs.mkdirSync(PROFILE, { recursive: true });
const args = [
  '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + PORT,
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  // Keep the chart and the trader running at full speed when the window is not in front.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];
if (HEADLESS) args.push('--headless=new', '--window-size=1487,907');
args.push('about:blank'); // the traderoom is opened once the extension is loaded, so it gets the panel

const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const toChrome = proc.stdio[3];
const fromChrome = proc.stdio[4];
let seq = 0;
let buffer = '';
const pending = new Map();
fromChrome.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  }
});
fromChrome.on('error', () => {});
toChrome.on('error', () => {});
const send = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 30000);
  pending.set(id, (m) => { clearTimeout(timer); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
  toChrome.write(JSON.stringify({ id, method, params: params || {} }) + '\0');
});

proc.on('exit', (code) => { log('Chrome closed (' + code + ').'); process.exit(0); });

(async () => {
  const version = await send('Browser.getVersion');
  log('Started ' + version.product + ', profile ' + PROFILE + ', DevTools port ' + PORT + '.');
  const loaded = await send('Extensions.loadUnpacked', { path: EXTENSION });
  log('Extension loaded from ' + EXTENSION + ' (id ' + loaded.id + ').');
  const { targetInfos } = await send('Target.getTargets');
  await send('Target.createTarget', { url: URL });
  for (const t of targetInfos) if (t.type === 'page' && t.url === 'about:blank') await send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  log('Opened ' + URL + '.');
})().catch((e) => {
  // Most often: Chrome is already running with this profile but without the DevTools pipe.
  log('Could not start the test browser: ' + e.message + '. Close the test Chrome and run this again.');
  try { proc.kill(); } catch (_) { /* already gone */ }
  process.exit(1);
});

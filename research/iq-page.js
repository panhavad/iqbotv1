// Read-only IQ Option connection for the research scripts. It runs in an isolated world of the
// traderoom tab of the logged-in test browser (extension/tools/start-test-browser.ps1) and opens
// its own WebSocket with the session cookie, the same way the extension does. It never trades.
'use strict';

const PORT = process.env.CDP_PORT || 9555;

const PAGE_CODE = String.raw`
window.__nmatResearch = window.__nmatResearch || (() => {
  let ws, ready, seq = 0;
  const pending = new Map();
  function open() {
    ready = new Promise((resolve, reject) => {
      const ssid = (document.cookie.match(/(?:^|;\s*)ssid=([^;]+)/) || [])[1];
      if (!ssid) { reject(new Error('not logged in')); return; }
      ws = new WebSocket('wss://ws.iqoption.com/echo/websocket');
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.request_id && pending.has(m.request_id) && m.name !== 'result') { pending.get(m.request_id)(m); pending.delete(m.request_id); }
      };
      ws.onclose = () => { ready = null; };
      ws.onerror = () => reject(new Error('websocket error'));
      ws.onopen = () => {
        pending.set('auth', (m) => (m.msg === true ? setTimeout(resolve, 1200) : reject(new Error('auth failed'))));
        ws.send(JSON.stringify({ name: 'authenticate', request_id: 'auth', local_time: 0,
          msg: { ssid, protocol: 3, session_id: '', client_session_id: '' } }));
      };
    });
    return ready;
  }
  async function call(name, version, body, timeoutMs) {
    if (!ready) open();
    await ready;
    const id = 'r' + (++seq);
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ name: 'sendMessage', request_id: id, local_time: seq, msg: { name, version, body } }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, timeoutMs || 20000);
    });
    if (reply.timeout) throw new Error(name + ': timeout');
    return reply.msg;
  }
  async function candles(activeId, size, to, count) {
    const msg = await call('get-candles', '2.0', { active_id: activeId, size, to, count, only_closed: true });
    return (msg && msg.candles || []).map((c) => [c.from, c.open, c.max, c.min, c.close]);
  }
  return { call, candles };
})();
'ok'`;

async function connectPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.type === 'page' && /iqoption\.com\/traderoom/.test(x.url));
  if (!t) throw new Error('open the traderoom in the test browser first');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const tree = await send('Page.getFrameTree', {});
  const world = await send('Page.createIsolatedWorld', { frameId: tree.result.frameTree.frame.id, worldName: 'nmat-research' });
  const contextId = world.result.executionContextId;
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception.description);
    return r.result.result.value;
  };
  await evaluate(PAGE_CODE);
  return {
    call: (name, version, body, timeoutMs) =>
      evaluate(`window.__nmatResearch.call(${JSON.stringify(name)}, ${JSON.stringify(version)}, ${JSON.stringify(body || {})}, ${Number(timeoutMs) || 20000})`),
    candles: (activeId, size, to, count) =>
      evaluate(`window.__nmatResearch.candles(${Number(activeId)}, ${Number(size)}, ${Number(to)}, ${Number(count)})`),
    close: () => ws.close(),
  };
}

module.exports = { connectPage };

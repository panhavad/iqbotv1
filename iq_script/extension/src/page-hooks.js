/*
 * Runs inside the traderoom page (MAIN world), before IQ Option's own scripts. Two small hooks;
 * neither changes what the page draws or sends.
 *
 * 1. Canvas reading, for the "+ NEW OPTION" button. The traderoom draws everything, its buttons
 *    included, on one WebGL canvas whose pixels are cleared after every frame, so they can only be
 *    read right after IQ Option draws a frame. When the content script asks (event "nmat-probe",
 *    detail: JSON {id, fromRight}), this reads the canvas's pixel column `fromRight` CSS pixels from
 *    its right edge after the next drawn frame, and answers with the colour bands it found (event
 *    "nmat-probe-result", detail: JSON {id, bands: [{kind, from, to}] or null}). Kinds: dark, orange,
 *    grey, other; from / to are CSS pixels from the top of the window. It only records the WebGL
 *    context IQ Option creates (it never creates one) and reads pixels on request.
 *
 * 2. The traderoom selection, as it happens. The moment an asset is chosen, the traderoom asks the
 *    server about it (get-traders-mood: asset id and option type): passed on as event "nmat-select"
 *    (detail: JSON {activeId, activeType}). About 3 seconds later the traderoom saves its layout
 *    (asset, option type, candle size: the traderoom_gl_grid user setting): passed on as event
 *    "nmat-layout" (detail: JSON config). So the extension follows a new selection at once instead
 *    of at its next poll. The messages themselves are sent unchanged.
 */
(function () {
  'use strict';
  if (window.__nmatProbe) return;
  window.__nmatProbe = true;

  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === 'string' && data.indexOf('traderoom_gl_grid') !== -1 && data.indexOf('set-user-settings') !== -1) {
        const m = JSON.parse(data);
        const body = m && m.msg && m.msg.body;
        if (body && body.name === 'traderoom_gl_grid' && body.config) {
          document.dispatchEvent(new CustomEvent('nmat-layout', { detail: JSON.stringify(body.config) }));
        }
      } else if (typeof data === 'string' && data.indexOf('"get-traders-mood"') !== -1) {
        const m = JSON.parse(data);
        const body = m && m.msg && m.msg.name === 'get-traders-mood' && m.msg.body;
        if (body && body.asset_id && body.instrument) {
          document.dispatchEvent(new CustomEvent('nmat-select', { detail: JSON.stringify({ activeId: body.asset_id, activeType: body.instrument }) }));
        }
      }
    } catch (_) { /* not a selection message */ }
    return send.apply(this, arguments);
  };

  const contexts = new WeakMap(); // canvas -> WebGL context created by IQ Option
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    const ctx = getContext.apply(this, arguments);
    if (ctx && /webgl/i.test(String(type))) contexts.set(this, ctx);
    return ctx;
  };

  const MAX_TRIES = 120; // animation-frame callbacks to wait for a drawn frame
  let request = null; // {id, fromRight, tries}

  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(window, function (time) {
      try {
        return callback(time);
      } finally {
        if (request) answer();
      }
    });
  };

  function answer() {
    const req = request;
    let bands = null;
    try {
      bands = readColumn(req.fromRight);
    } catch (_) {
      bands = null;
    }
    if (!bands && ++req.tries < MAX_TRIES) return; // this callback did not draw: try after the next one
    request = null;
    document.dispatchEvent(new CustomEvent('nmat-probe-result', { detail: JSON.stringify({ id: req.id, bands }) }));
  }

  function classify(r, g, b) {
    if (Math.max(r, g, b) < 50) return 'dark';
    if (r > 180 && g > 60 && g < 170 && b < 100) return 'orange';
    if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return 'grey';
    return 'other';
  }

  // Colour bands of one pixel column, or null when the frame has not been drawn yet.
  function readColumn(fromRight) {
    const canvas = document.getElementById('glcanvas') || document.querySelector('canvas');
    const gl = canvas && contexts.get(canvas);
    if (!gl) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scale = canvas.width / rect.width;
    const x = Math.round((rect.width - fromRight) * scale);
    if (x < 0 || x >= canvas.width) return null;
    const pixels = new Uint8Array(canvas.height * 4);
    gl.readPixels(x, 0, 1, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const bands = [];
    let drawn = false;
    for (let y = 0; y < Math.floor(rect.height); y++) {
      const row = canvas.height - 1 - Math.min(canvas.height - 1, Math.round(y * scale));
      const r = pixels[row * 4], g = pixels[row * 4 + 1], b = pixels[row * 4 + 2];
      if (r || g || b) drawn = true;
      const kind = classify(r, g, b);
      const last = bands[bands.length - 1];
      const top = Math.round(rect.top + y);
      if (last && last.kind === kind) last.to = top;
      else bands.push({ kind, from: top, to: top });
    }
    return drawn ? bands : null;
  }

  document.addEventListener('nmat-probe', (event) => {
    try {
      const d = JSON.parse(event.detail);
      request = { id: d.id, fromRight: Number(d.fromRight), tries: 0 };
    } catch (_) { /* not a probe request */ }
  });
})();

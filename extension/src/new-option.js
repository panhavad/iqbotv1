/*
 * Presses the traderoom's "+ NEW OPTION" button when it shows.
 *
 * When an option bought in the traderoom ends, IQ Option shows its result and replaces HIGHER /
 * LOWER with "+ NEW OPTION" until someone presses it. The extension does not need those buttons
 * (it buys over its own connection), but while auto-trading is on it presses this one, so the
 * traderoom is always ready for the next position too.
 *
 * The traderoom is drawn on a canvas. page-hooks.js reads the pixel column through the trade
 * panel's buttons (left of their text), and the button is pressed only when that column shows an
 * orange button with plain dark background under it. HIGHER always has LOWER right under it, so
 * HIGHER is never pressed; any other picture (another layout, theme or window size) means no press.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NMNewOption = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLUMN_FROM_RIGHT = 108; // CSS px from the right edge: inside the buttons, left of their text
  const CENTRE_FROM_RIGHT = 65; // CSS px from the right edge: middle of the buttons
  const MIN_BUTTON = 60; // button height range, CSS px (both buttons are about 100-110 px tall)
  const MAX_BUTTON = 160;
  const CLEAR_BELOW = 60; // dark pixels needed under the button (LOWER starts 8 px under HIGHER)
  const MIN_GAP_MS = 3000; // between two presses

  // The "+ NEW OPTION" button in a column of colour bands [{kind, from, to}] (top to bottom,
  // CSS px): returns its middle {y}, or null when the column shows anything else.
  function findNewOption(bands) {
    if (!Array.isArray(bands)) return null;
    const i = bands.findIndex((b) => b.kind === 'orange' && b.to - b.from + 1 >= MIN_BUTTON);
    if (i < 0) return null;
    const button = bands[i];
    if (button.to - button.from + 1 > MAX_BUTTON) return null;
    const below = bands[i + 1];
    if (!below || below.kind !== 'dark' || below.to - below.from + 1 < CLEAR_BELOW) return null;
    return { y: Math.round((button.from + button.to) / 2) };
  }

  // Every `everyMs` while isActive(): probe(fromRight) -> bands, and click(fromRight, y) on the button.
  function createNewOptionPresser(o) {
    const now = o.now || (() => Date.now());
    let busy = false;
    let lastPress = -Infinity;
    async function check() {
      if (busy || !o.isActive()) return false;
      busy = true;
      try {
        const found = findNewOption(await o.probe(COLUMN_FROM_RIGHT));
        if (!found || !o.isActive() || now() - lastPress < MIN_GAP_MS) return false;
        lastPress = now();
        o.click(CENTRE_FROM_RIGHT, found.y);
        if (o.onPress) o.onPress();
        return true;
      } catch (_) {
        return false; // no answer from the page: nothing pressed
      } finally {
        busy = false;
      }
    }
    const setInt = o.setInterval || setInterval;
    const clearInt = o.clearInterval || clearInterval;
    const timer = setInt(check, o.everyMs || 2000);
    if (timer && timer.unref) timer.unref(); // Node (tests): do not keep the process alive
    return { check, stop: () => clearInt(timer) };
  }

  // ---- browser side ---------------------------------------------------------------------
  // Asks page-hooks.js (in the page) for the colour bands of a canvas column.
  function pageProbe(fromRight, timeoutMs) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (bands) => {
        document.removeEventListener('nmat-probe-result', onResult);
        clearTimeout(timer);
        resolve(bands);
      };
      const onResult = (event) => {
        try {
          const d = JSON.parse(event.detail);
          if (d.id === id) done(d.bands);
        } catch (_) { /* someone else's event */ }
      };
      const timer = setTimeout(() => done(null), timeoutMs || 3000);
      document.addEventListener('nmat-probe-result', onResult);
      document.dispatchEvent(new CustomEvent('nmat-probe', { detail: JSON.stringify({ id, fromRight }) }));
    });
  }

  // Clicks the traderoom canvas at (right edge - fromRight, y) the way a mouse does.
  function clickCanvas(fromRight, y) {
    const canvas = document.getElementById('glcanvas') || document.querySelector('canvas');
    if (!canvas) return false;
    const x = canvas.getBoundingClientRect().right - fromRight;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    const pointer = (type, extra) => canvas.dispatchEvent(new PointerEvent(type,
      Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1 }, base, extra)));
    const mouse = (type, extra) => canvas.dispatchEvent(new MouseEvent(type, Object.assign({}, base, extra)));
    pointer('pointerover'); pointer('pointerenter'); mouse('mouseover');
    pointer('pointermove'); mouse('mousemove');
    pointer('pointerdown', { button: 0, buttons: 1, pressure: 0.5 }); mouse('mousedown', { button: 0, buttons: 1 });
    pointer('pointerup', { button: 0, buttons: 0 }); mouse('mouseup', { button: 0, buttons: 0 });
    mouse('click', { button: 0, buttons: 0, detail: 1 });
    return true;
  }

  return { findNewOption, createNewOptionPresser, pageProbe, clickCanvas, COLUMN_FROM_RIGHT, CENTRE_FROM_RIGHT };
});

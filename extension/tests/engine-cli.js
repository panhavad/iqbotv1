// Runs the extension's signal engine over a candle file and prints one character per candle:
// C = CALL arrow, P = PUT arrow, . = none (the arrow on candle i is the decision made when
// candle i-1 closed, exactly like the chart script). Used by tests/test_extension_engine.py.
//
//   node engine-cli.js <candles.json> [inputs.json]
// candles.json: [{open, high, low, close}, ...] oldest first. inputs.json: QCS input names -> values.
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require(path.join(__dirname, '..', 'src', 'signal-engine.js'));

const QCS_NAMES = {
  'Signal method': 'method', // 1 = breakout, 2 = vote
  'Breakout: candles': 'brkCandles',
  'Breakout: close within (% of range)': 'brkZone',
  'Breakout: minimum body (% of candle)': 'brkBody',
  'Reverse the arrows (fade)': 'reverse',
  'Vote: minimum agreement score': 'minScore',
  'Vote: minimum agreeing strategies': 'minAgree',
  'Vote: evidence gate': 'useGate',
  'Vote: evidence window (candles)': 'gateWindow',
  'Vote: evidence needed (z-score)': 'gateZ',
};

const [candlesPath, inputsPath] = process.argv.slice(2);
const candles = JSON.parse(fs.readFileSync(candlesPath, 'utf8'));
const settings = {};
if (inputsPath) {
  for (const [name, value] of Object.entries(JSON.parse(fs.readFileSync(inputsPath, 'utf8')))) {
      if (QCS_NAMES[name] === 'method') settings.method = value === 2 ? 'vote' : 'breakout';
      else if (QCS_NAMES[name]) settings[QCS_NAMES[name]] = value;
    }
}
const engine = createEngine(settings);
const chars = ['.'];
for (const c of candles) {
  const { decision } = engine.update(c);
  chars.push(decision === 1 ? 'C' : decision === -1 ? 'P' : '.');
}
process.stdout.write(chars.slice(0, candles.length).join('') + '\n');

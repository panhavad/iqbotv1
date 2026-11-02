// Prints the signal chart script exactly as the extension writes it into the account, with the
// LEARNED table built from a JSON file of learned results. Used by tests/test_qcs_scripts.py.
//
//   node chart-script-cli.js <learned.json> [signal|scoreboard]
'use strict';
const fs = require('fs');
const path = require('path');
const { buildScript } = require(path.join(__dirname, '..', 'src', 'chart-script.js'));
const lua = require(path.join(__dirname, '..', 'src', 'lua-scripts.js'));

const [learnedPath, kind = 'signal'] = process.argv.slice(2);
const learned = JSON.parse(fs.readFileSync(learnedPath, 'utf8'));
process.stdout.write(buildScript(lua, kind, learned).code);

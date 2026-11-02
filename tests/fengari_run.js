// Runs the QCS emulator + a script on fengari (Lua 5.3 in JavaScript) and prints the digest.
// usage: node fengari_run.js <emulator.lua> <script.lua> <candles.lua> <inputs.lua>
"use strict";
const fs = require("fs");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const [emulatorPath, scriptPath, candlesPath, inputsPath] = process.argv.slice(2);
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function setGlobalString(name, text) {
  lua.lua_pushstring(L, to_luastring(text));
  lua.lua_setglobal(L, to_luastring(name));
}

setGlobalString("EMULATOR_SRC", fs.readFileSync(emulatorPath, "utf8"));
setGlobalString("SCRIPT_SRC", fs.readFileSync(scriptPath, "utf8"));
setGlobalString("CANDLES_SRC", fs.readFileSync(candlesPath, "utf8"));
setGlobalString("INPUTS_SRC", fs.readFileSync(inputsPath, "utf8"));

const driver = `
local M = assert(load(EMULATOR_SRC, "=qcs_emulator.lua"))()
local candles = assert(load(CANDLES_SRC, "=candles"))()
local inputs = assert(load(INPUTS_SRC, "=inputs"))()
local engine = M.new(candles, inputs)
local out = engine.run(SCRIPT_SRC, "script")
return M.digest(out, #candles)
`;

if (lauxlib.luaL_loadstring(L, to_luastring(driver)) !== lua.LUA_OK ||
    lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
  process.stderr.write(to_jsstring(lua.lua_tostring(L, -1)) + "\n");
  process.exit(1);
}
process.stdout.write(to_jsstring(lua.lua_tostring(L, -1)) + "\n");

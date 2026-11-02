"""Run QCS scripts offline: the Lua emulator on a real Lua 5.3 VM (lupa) or on fengari (Node)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Optional, Sequence

from .reference import Candle

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT_DIR = os.path.dirname(HERE)
EMULATOR_PATH = os.path.join(HERE, "qcs_emulator.lua")
FENGARI_RUNNER = os.path.join(HERE, "fengari_run.js")
SIGNAL_SCRIPT = os.path.join(SCRIPT_DIR, "NextMinuteSignal.lua")
SCOREBOARD_SCRIPT = os.path.join(SCRIPT_DIR, "NextMinuteScoreboard.lua")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def lua_candles(candles: Sequence[Candle]) -> str:
    """Candles as a Lua chunk; %.17g round-trips every float exactly."""
    rows = [
        "{open=%.17g,high=%.17g,low=%.17g,close=%.17g,volume=%.17g,time=%d}"
        % (c.open, c.high, c.low, c.close, c.volume, c.ts)
        for c in candles
    ]
    return "return {" + ",\n".join(rows) + "}"


def lua_inputs(inputs: Optional[dict]) -> str:
    def literal(v):
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, int):
            return str(v)
        if isinstance(v, float):
            return "%.17g" % v
        return json.dumps(v)

    parts = ["[%s]=%s" % (json.dumps(k), literal(v)) for k, v in (inputs or {}).items()]
    return "return {" + ",".join(parts) + "}"


@dataclass
class Result:
    n: int
    shapes: dict = field(default_factory=dict)  # name -> list[bool] per candle
    plots: dict = field(default_factory=dict)  # name -> list[Optional[float]] per candle
    advice: list = field(default_factory=list)  # per candle: "advice.buy" | "advice.sell" | "advice.neutral" | None
    logs: list = field(default_factory=list)
    hlines: list = field(default_factory=list)
    inputs: list = field(default_factory=list)
    instrument: dict = field(default_factory=dict)
    digest: str = ""

    def shape(self, name: str) -> list:
        return self.shapes.get(name, [False] * self.n)

    @property
    def arrows(self) -> list:
        """Per candle: +1 CALL, -1 PUT, 0 none."""
        call, put = self.shape("CALL"), self.shape("PUT")
        return [1 if c else (-1 if p else 0) for c, p in zip(call, put)]


_RUNTIME = None


def _runtime():
    global _RUNTIME
    if _RUNTIME is None:
        from lupa import lua53

        lua = lua53.LuaRuntime(unpack_returned_tuples=True)
        module = lua.execute(read(EMULATOR_PATH))
        _RUNTIME = (lua, module)
    return _RUNTIME


def run(script: str, candles: Sequence[Candle], inputs: Optional[dict] = None, chunkname: str = "script") -> Result:
    """Run QCS source over candles with the emulator on Lua 5.3 (lupa)."""
    lua, module = _runtime()
    data = lua.execute(lua_candles(candles))
    overrides = lua.execute(lua_inputs(inputs))
    engine = module.new(data, overrides)
    out = engine.run(script, chunkname)
    n = len(candles)
    result = Result(n=n)
    for name, table in out.shapes.items():
        result.shapes[name] = [bool(table[b]) for b in range(1, n + 1)]
    for name, table in out.plots.items():
        values = []
        for b in range(1, n + 1):
            v = table[b]
            values.append(None if v is None or v != v else float(v))
        result.plots[name] = values
    result.advice = [out.advice[b] for b in range(1, n + 1)]
    result.logs = [out.logs[i] for i in range(1, len(out.logs) + 1)]
    result.hlines = [(h.value, h.name) for h in (out.hlines[i] for i in range(1, len(out.hlines) + 1))]
    result.inputs = [
        {"name": i.name, "type": i.type, "default": i.default, "value": i.value}
        for i in (out.inputs[k] for k in range(1, len(out.inputs) + 1))
    ]
    if out.instrument is not None:
        result.instrument = {"name": out.instrument.name, "short_name": out.instrument.short_name,
                             "overlay": bool(out.instrument.overlay)}
    result.digest = module.digest(out, n)
    return result


def run_file(path: str, candles: Sequence[Candle], inputs: Optional[dict] = None) -> Result:
    return run(read(path), candles, inputs, os.path.basename(path))


def fengari_available() -> bool:
    node = shutil.which("node")
    return bool(node) and os.path.isdir(os.path.join(HERE, "node_modules", "fengari"))


def run_fengari_digest(path: str, candles: Sequence[Candle], inputs: Optional[dict] = None) -> str:
    """Same emulator and script on fengari (a Lua 5.3 VM written in JavaScript)."""
    with tempfile.TemporaryDirectory() as folder:
        candles_file = os.path.join(folder, "candles.lua")
        inputs_file = os.path.join(folder, "inputs.lua")
        with open(candles_file, "w", encoding="utf-8") as handle:
            handle.write(lua_candles(candles))
        with open(inputs_file, "w", encoding="utf-8") as handle:
            handle.write(lua_inputs(inputs))
        proc = subprocess.run(
            ["node", FENGARI_RUNNER, EMULATOR_PATH, path, candles_file, inputs_file],
            capture_output=True, text=True, timeout=600, cwd=HERE,
        )
    if proc.returncode != 0:
        raise RuntimeError("fengari run failed: " + (proc.stderr or proc.stdout)[-2000:])
    return proc.stdout.strip()

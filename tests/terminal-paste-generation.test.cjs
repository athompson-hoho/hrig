// Regression: a multi-line paste confirmation asked of one terminal must not paste into its replacement after a reconnect swaps the terminal (QA wave-1 P2).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

function load() {
  const effects = [];
  const states = [];
  const sent = [];
  let handler;
  const makeTerm = (label) => ({
    loadAddon() {},
    attachCustomKeyEventHandler: (f) => {
      handler = f;
    },
    hasSelection: () => false,
    onSelectionChange: () => ({ dispose() {} }),
    element: { parentElement: { addEventListener() {}, removeEventListener() {} } },
    paste: (text) => sent.push([label, text]),
    focus() {},
  });
  const terminal = { current: makeTerm("old") };
  global.window = {
    hrig: {
      platform: "linux",
      readClipboardText: async () => "echo unsafe\n",
      clipboardHasImage: async () => false,
    },
  };
  global.requestAnimationFrame = (f) => f();
  const built = buildSync({
    entryPoints: [path.resolve(__dirname, "../src/TerminalTools.tsx")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["react", "react/jsx-runtime", "lucide-react", "./SettingsContext", "./components", "@xterm/addon-search"],
  });
  const m = new Module("/tmp/tools", module);
  m.require = (n) =>
    n === "react"
      ? { useState: (v) => [v, (x) => states.push(x)], useRef: (v) => ({ current: v }), useEffect: (f) => effects.push(f) }
      : n === "react/jsx-runtime"
        ? { jsx: () => null, jsxs: () => null }
        : n === "./SettingsContext"
          ? { useSettings: () => ({ effective: { "terminal.confirmMultilinePaste": true, "terminal.copyOnSelect": false } }) }
          : n === "@xterm/addon-search"
            ? { SearchAddon: class { onDidChangeResults() { return { dispose() {} }; } dispose() {} } }
            : {};
  m._compile(built.outputFiles[0].text, "/tmp/tools");
  m.exports.default({ terminal, terminalId: "t", generation: 1 });
  const attach = effects.find((f) => f.toString().includes("attachCustomKeyEventHandler"));
  assert.ok(attach, "generation effect registered");
  return { terminal, states, sent, attach, press: () => handler({ key: "v", type: "keydown", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} }), makeTerm };
}
const tick = () => new Promise((r) => setImmediate(r));

test("paste confirmation is cancelled when the terminal generation is cleaned up", async () => {
  const { terminal, states, sent, attach, press, makeTerm } = load();
  const cleanup = attach();
  press();
  await tick();
  const ask = states.find((x) => x && x.answer);
  assert.ok(ask, "multi-line paste asks first");
  assert.equal(sent.length, 0);
  cleanup();
  terminal.current = makeTerm("replacement");
  attach();
  ask.answer(true);
  await tick();
  assert.deepEqual(sent, [], "nothing is pasted into the old or replacement terminal");
});

test("paste confirmation still pastes into the same terminal when nothing changed", async () => {
  const { states, sent, attach, press } = load();
  attach();
  press();
  await tick();
  const ask = states.find((x) => x && x.answer);
  ask.answer(true);
  await tick();
  assert.deepEqual(sent, [["old", "echo unsafe\n"]]);
});

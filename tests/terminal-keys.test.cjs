const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const built = buildSync({
  entryPoints: ["src/terminal-keys.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("terminal-keys", module);
mod._compile(built.outputFiles[0].text, "terminal-keys");
const { classifyTerminalKey } = mod.exports;
const { terminalOwnsKey } = mod.exports;
const { clearShortcutLabel } = mod.exports;
const k = (key, mods = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
test("Ctrl+V and Ctrl+Shift+V paste on Windows/Linux; Cmd+V on macOS", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(classifyTerminalKey(k("v", { ctrlKey: true }), platform, false), "paste");
    assert.equal(classifyTerminalKey(k("V", { ctrlKey: true, shiftKey: true }), platform, false), "paste");
    assert.equal(classifyTerminalKey(k("v", { metaKey: true }), platform, false), "pass");
  }
  assert.equal(classifyTerminalKey(k("v", { metaKey: true }), "darwin", false), "paste");
  assert.equal(classifyTerminalKey(k("v", { ctrlKey: true }), "darwin", false), "pass");
});
test("Ctrl+C copies only with a selection so SIGINT still reaches the shell", () => {
  assert.equal(classifyTerminalKey(k("c", { ctrlKey: true }), "linux", false), "pass");
  assert.equal(classifyTerminalKey(k("c", { ctrlKey: true }), "linux", true), "copy");
  assert.equal(classifyTerminalKey(k("C", { ctrlKey: true, shiftKey: true }), "win32", false), "copy");
  assert.equal(classifyTerminalKey(k("c", { metaKey: true }), "darwin", false), "pass");
  assert.equal(classifyTerminalKey(k("c", { metaKey: true }), "darwin", true), "copy");
  assert.equal(classifyTerminalKey(k("c", { ctrlKey: true }), "darwin", true), "pass");
});
test("find is kept and AltGr/Alt combinations and plain keys pass through", () => {
  assert.equal(classifyTerminalKey(k("f", { ctrlKey: true }), "linux", false), "find");
  assert.equal(classifyTerminalKey(k("F", { metaKey: true }), "darwin", false), "find");
  assert.equal(classifyTerminalKey(k("v", { ctrlKey: true, altKey: true }), "win32", false), "pass");
  assert.equal(classifyTerminalKey(k("v"), "linux", false), "pass");
  assert.equal(classifyTerminalKey(k("z", { ctrlKey: true }), "linux", true), "pass");
});
test("Cmd+K on macOS and Ctrl+Shift+K on Windows/Linux are clear, including upper-case keys", () => {
  assert.equal(classifyTerminalKey(k("k", { metaKey: true }), "darwin", false), "clear");
  assert.equal(classifyTerminalKey(k("K", { metaKey: true }), "darwin", true), "clear");
  for (const platform of ["win32", "linux"]) {
    assert.equal(classifyTerminalKey(k("K", { ctrlKey: true, shiftKey: true }), platform, false), "clear");
    assert.equal(classifyTerminalKey(k("k", { ctrlKey: true, shiftKey: true }), platform, true), "clear");
  }
});
test("plain Ctrl+K on Windows/Linux is never clear so readline kill-line is not claimed", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(classifyTerminalKey(k("k", { ctrlKey: true }), platform, false), "pass");
    assert.equal(classifyTerminalKey(k("k", { ctrlKey: true }), platform, true), "pass");
    assert.equal(classifyTerminalKey(k("K", { ctrlKey: true }), platform, false), "pass");
  }
});
test("non-matching macOS combos for K pass", () => {
  assert.equal(classifyTerminalKey(k("k", { ctrlKey: true }), "darwin", false), "pass");
  assert.equal(classifyTerminalKey(k("K", { ctrlKey: true, shiftKey: true }), "darwin", false), "pass");
  assert.equal(classifyTerminalKey(k("K", { metaKey: true, shiftKey: true }), "darwin", false), "pass");
  assert.equal(classifyTerminalKey(k("k"), "darwin", false), "pass");
});
test("Meta combos for K on Windows/Linux pass", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(classifyTerminalKey(k("k", { metaKey: true }), platform, false), "pass");
    assert.equal(classifyTerminalKey(k("K", { metaKey: true, shiftKey: true }), platform, false), "pass");
    assert.equal(classifyTerminalKey(k("K", { ctrlKey: true, metaKey: true, shiftKey: true }), platform, false), "pass");
  }
  assert.equal(classifyTerminalKey(k("K", { ctrlKey: true, metaKey: true, shiftKey: true }), "darwin", false), "pass");
});
test("Alt and AltGr combinations with K never clear", () => {
  assert.equal(classifyTerminalKey(k("k", { metaKey: true, altKey: true }), "darwin", false), "pass");
  for (const platform of ["win32", "linux"]) {
    assert.equal(classifyTerminalKey(k("K", { ctrlKey: true, shiftKey: true, altKey: true }), platform, false), "pass");
    // AltGr reports as Ctrl+Alt on Windows.
    assert.equal(classifyTerminalKey(k("k", { ctrlKey: true, altKey: true }), platform, false), "pass");
  }
});
const inTerminal = { closest: (selector) => (selector === ".terminal-panel" ? {} : null) };
const outsideTerminal = { closest: () => null };
test("terminalOwnsKey claims the clear combos only inside a terminal panel", () => {
  assert.equal(terminalOwnsKey(k("k", { metaKey: true }), "darwin", inTerminal), true);
  assert.equal(terminalOwnsKey(k("K", { ctrlKey: true, shiftKey: true }), "win32", inTerminal), true);
  assert.equal(terminalOwnsKey(k("K", { ctrlKey: true, shiftKey: true }), "linux", inTerminal), true);
  assert.equal(terminalOwnsKey(k("K", { ctrlKey: true, shiftKey: true }), "linux", outsideTerminal), false);
  assert.equal(terminalOwnsKey(k("k", { metaKey: true }), "darwin", outsideTerminal), false);
});
test("terminalOwnsKey is false for null targets and targets without closest", () => {
  const ev = k("K", { ctrlKey: true, shiftKey: true });
  assert.equal(terminalOwnsKey(ev, "linux", null), false);
  assert.equal(terminalOwnsKey(ev, "linux", {}), false);
  assert.equal(terminalOwnsKey(ev, "linux", { closest: "not a function" }), false);
});
test("terminalOwnsKey leaves plain Ctrl+K, macOS Ctrl+K and Cmd+Shift+K alone inside a terminal", () => {
  assert.equal(terminalOwnsKey(k("k", { ctrlKey: true }), "linux", inTerminal), false);
  assert.equal(terminalOwnsKey(k("k", { ctrlKey: true }), "win32", inTerminal), false);
  assert.equal(terminalOwnsKey(k("k", { ctrlKey: true }), "darwin", inTerminal), false);
  assert.equal(terminalOwnsKey(k("K", { metaKey: true, shiftKey: true }), "darwin", inTerminal), false);
  assert.equal(terminalOwnsKey(k("v", { ctrlKey: true }), "linux", inTerminal), false);
});
test("terminalOwnsKey and classifyTerminalKey never disagree (App steps aside exactly when the terminal acts)", () => {
  const events = [
    ["darwin", k("k", { metaKey: true })],
    ["darwin", k("K", { metaKey: true, shiftKey: true })],
    ["darwin", k("k", { ctrlKey: true })],
    ["win32", k("K", { ctrlKey: true, shiftKey: true })],
    ["win32", k("k", { ctrlKey: true })],
    ["linux", k("K", { ctrlKey: true, shiftKey: true })],
    ["linux", k("k", { metaKey: true })],
    ["linux", k("K", { ctrlKey: true, shiftKey: true, altKey: true })],
  ];
  for (const [platform, ev] of events) {
    const clear = classifyTerminalKey(ev, platform, false) === "clear";
    assert.equal(terminalOwnsKey(ev, platform, inTerminal), clear);
    // Outside a terminal the App handler keeps the key, so the palette still opens.
    assert.equal(terminalOwnsKey(ev, platform, outsideTerminal), false);
  }
});
test("clearShortcutLabel is Cmd K on macOS and Ctrl Shift K elsewhere", () => {
  assert.equal(clearShortcutLabel("darwin"), "Cmd K");
  assert.equal(clearShortcutLabel("win32"), "Ctrl Shift K");
  assert.equal(clearShortcutLabel("linux"), "Ctrl Shift K");
  assert.equal(clearShortcutLabel("unknown"), "Ctrl Shift K");
});
test("the clear label names modifiers that classifyTerminalKey treats as clear", () => {
  assert.equal(classifyTerminalKey(k("k", { metaKey: true }), "darwin", false), "clear");
  for (const platform of ["win32", "linux", "unknown"]) {
    assert.equal(classifyTerminalKey(k("k", { ctrlKey: true, shiftKey: true }), platform, false), "clear");
  }
});

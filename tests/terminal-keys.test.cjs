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

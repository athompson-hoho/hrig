const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const built = buildSync({
  entryPoints: ["src/terminal-scrollback.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("terminal-scrollback", module);
mod._compile(built.outputFiles[0].text, "terminal-scrollback");
const { isScrolledUp, scrollbackFull, discardNotice } = mod.exports;
test("scrolled-up detection compares viewport to live bottom", () => {
  assert.equal(isScrolledUp(40, 40), false);
  assert.equal(isScrolledUp(39, 40), true);
  assert.equal(isScrolledUp(0, 0), false);
});
test("buffer is full only at rows + scrollback lines", () => {
  assert.equal(scrollbackFull(1023, 24, 1000), false);
  assert.equal(scrollbackFull(1024, 24, 1000), true);
  assert.equal(scrollbackFull(5000, 24, 0), false);
});
test("notice states the retained line count without terminal text", () => {
  assert.match(discardNotice(10000), /10,000 lines/);
});

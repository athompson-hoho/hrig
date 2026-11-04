const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const { Terminal } = require("@xterm/xterm");
const built = buildSync({
  entryPoints: ["src/terminal-scrollback.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["@xterm/xterm"],
});
const mod = new Module("terminal-scrollback", module);
mod.paths = module.paths;
mod._compile(built.outputFiles[0].text, "terminal-scrollback");
const { isScrolledUp, discardNotice, watchScrollbackLoss } = mod.exports;
const write = (term, text) => new Promise((resolve) => term.write(text, resolve));
async function lost(writes, cols = 20) {
  const term = new Terminal({ rows: 2, cols, scrollback: 2, allowProposedApi: true });
  let count = 0;
  const watch = watchScrollbackLoss(term, () => count++);
  for (const text of writes) await write(term, text);
  const lines = term.buffer.active.length;
  watch.dispose();
  term.dispose();
  return { count, lines };
}
test("scrolled-up detection compares viewport to live bottom", () => {
  assert.equal(isScrolledUp(40, 40), false);
  assert.equal(isScrolledUp(39, 40), true);
});
test("no loss is reported at first full capacity or on cursor-only line feeds", async () => {
  assert.equal((await lost(["a\r\nb\r\nc\r\n"])).count, 0);
  assert.equal((await lost(["a\r\nb\r\n\x1b[H\n"])).count, 0);
});
test("a real trim by line feeds is reported once", async () => {
  const r = await lost(["a\r\nb\r\nc\r\nd\r\ne\r\nf\r\n"]);
  assert.equal(r.count, 1);
});
test("loss from automatic wrapping without line feeds is reported", async () => {
  assert.equal((await lost(["AAAABBBBCCCCDDDDEEEEFFFF"], 4)).count, 1);
});
test("clearing the screen and scrollback is not reported as loss, later loss still is", async () => {
  assert.equal((await lost(["a\r\nb\r\nc\r\n", "\x1b[3J\x1b[H\x1b[2J"])).count, 0);
  const r = await lost(["a\r\nb\r\nc\r\n", "\x1b[3J\x1b[H\x1b[2J", "1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n"]);
  assert.equal(r.count, 1);
});
test("alternate-screen output does not report loss", async () => {
  assert.equal((await lost(["a\r\n\x1b[?1049h", "x\r\ny\r\nz\r\nw\r\nv\r\n", "\x1b[?1049l"])).count, 0);
});
test("notice states the retained line count without terminal text", () => {
  assert.match(discardNotice(10000), /10,000 lines/);
});

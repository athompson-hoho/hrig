const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const built = buildSync({
  entryPoints: ["src/terminal-reconnect.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = new Module("terminal-reconnect", module);
mod._compile(built.outputFiles[0].text, "terminal-reconnect");
const m = mod.exports;
test("backoff doubles and caps at 15 seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(m.retryDelay), [1000, 2000, 4000, 8000, 15000, 15000]);
});
test("countdown rounds up and never goes negative", () => {
  assert.equal(m.countdownSeconds(null, 5), 0);
  assert.equal(m.countdownSeconds(2500, 1000), 2);
  assert.equal(m.countdownSeconds(1000, 5000), 0);
});
test("view distinguishes retrying, paused and idle; shell terminals have none", () => {
  const base = { seat: true, retrying: false, retries: 0, failed: false, nextAt: null, now: 0 };
  assert.equal(m.reconnectView({ ...base, seat: false, retrying: true }), null);
  assert.deepEqual(m.reconnectView({ ...base, retrying: true, retries: 2, nextAt: 3000 }), { kind: "retrying", attempt: 2, seconds: 3 });
  assert.deepEqual(m.reconnectView({ ...base, retries: 6, failed: true }), { kind: "paused" });
  assert.equal(m.reconnectView({ ...base, retries: 6, failed: false }), null);
});
test("reason prefers the error and falls back to the exit code", () => {
  assert.equal(m.reconnectReason("host down", 1), "host down");
  assert.equal(m.reconnectReason("", 130), "Connection ended (exit 130).");
  assert.equal(m.reconnectReason("", null), "");
});
test("scroll offset round-trips and clamps", () => {
  assert.equal(m.scrollOffset(100, 80), 20);
  assert.equal(m.scrollOffset(100, 100), 0);
  assert.equal(m.restoreLine(150, 20), 130);
  assert.equal(m.restoreLine(5, 20), 0);
});

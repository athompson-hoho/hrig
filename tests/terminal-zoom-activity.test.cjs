const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
function load(entry) {
  const built = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const m = new Module(entry, module);
  m._compile(built.outputFiles[0].text, entry);
  return m.exports;
}
const zoom = load("src/terminal-zoom.ts");
const act = load("src/terminal-activity.ts");
const key = (k, mods = {}) => ({ key: k, ctrlKey: true, metaKey: false, altKey: false, ...mods });
test("zoom keys need Ctrl/Cmd and ignore Alt/AltGr", () => {
  assert.equal(zoom.zoomAction(key("+")), "in");
  assert.equal(zoom.zoomAction(key("=")), "in");
  assert.equal(zoom.zoomAction(key("-")), "out");
  assert.equal(zoom.zoomAction(key("0")), "reset");
  assert.equal(zoom.zoomAction(key("0", { ctrlKey: false, metaKey: true })), "reset");
  assert.equal(zoom.zoomAction(key("+", { altKey: true })), null);
  assert.equal(zoom.zoomAction(key("+", { ctrlKey: false })), null);
  assert.equal(zoom.zoomAction(key("c")), null);
});
test("zoom offsets stay within font bounds relative to the Settings size", () => {
  assert.equal(zoom.effectiveFontSize(13, 2), 15);
  assert.equal(zoom.effectiveFontSize(13, -100), 8);
  assert.equal(zoom.effectiveFontSize(13, 100), 32);
  assert.equal(zoom.nextOffset(13, 0, "in"), 1);
  assert.equal(zoom.nextOffset(13, 19, "in"), 19);
  assert.equal(zoom.nextOffset(13, -5, "out"), -5);
  assert.equal(zoom.nextOffset(13, 6, "reset"), 0);
});
test("an out-of-bounds offset steps from the visible size", () => {
  assert.equal(zoom.effectiveFontSize(30, 5), 32);
  assert.equal(zoom.nextOffset(30, 5, "out"), 1);
  assert.equal(zoom.nextOffset(10, -5, "in"), -1);
});
test("wheel notches accumulate: up zooms in, down zooms out", () => {
  assert.deepEqual(zoom.wheelSteps(0, -100), { steps: 1, remainder: 0 });
  assert.deepEqual(zoom.wheelSteps(0, 100), { steps: -1, remainder: 0 });
  const a = zoom.wheelSteps(0, -40), b = zoom.wheelSteps(a.remainder, -70);
  assert.equal(a.steps, 0);
  assert.equal(b.steps, 1);
});
test("quiet fires once after a burst and not for small output", () => {
  const t = act.createActivityTracker({ burstLines: 5, quietMs: 1000, bellCooldownMs: 5000, settleMs: 100 });
  t.attach(0);
  t.output(50, 100); // inside settle window: replayed history ignored
  assert.equal(t.tick(5000), false);
  t.output(200, 2);
  assert.equal(t.tick(2000), false);
  t.output(300, 4);
  assert.equal(t.tick(900), false);
  assert.equal(t.tick(1400), true);
  assert.equal(t.tick(3000), false);
});
test("bell is rate limited and ignored while attaching", () => {
  const t = act.createActivityTracker({ burstLines: 5, quietMs: 1000, bellCooldownMs: 5000, settleMs: 100 });
  t.attach(0);
  assert.equal(t.bell(50), false);
  assert.equal(t.bell(200), true);
  assert.equal(t.bell(300), false);
  assert.equal(t.bell(5300), true);
});
test("alerts only for unwatched terminals and never contain output", () => {
  assert.equal(act.shouldAlert(true, true), false);
  assert.equal(act.shouldAlert(false, true), true);
  assert.equal(act.shouldAlert(true, false), true);
  const text = act.alertText("quiet", "dev-build", "wsl-box");
  assert.match(text.title, /dev-build went quiet/);
  assert.match(text.body, /wsl-box/);
});

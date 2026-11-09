const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('vi', module);
m._compile(buildSync({ entryPoints: ['src/visible-interval.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'vi.js');
const { visibleInterval } = m.exports;

function env() {
  const listeners = new Set(); let tick, cleared = 0;
  const doc = { hidden: false, addEventListener: (t, f) => t === 'visibilitychange' && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) };
  const timers = { setInterval: (f) => { tick = f; return 7; }, clearInterval: id => { assert.equal(id, 7); cleared++; } };
  return { doc, timers, listeners, fire: () => tick(), show: () => { doc.hidden = false; listeners.forEach(f => f()); }, cleared: () => cleared };
}
test('ticks run while visible, are skipped while hidden, and one catch-up runs on show', () => {
  const e = env(); let n = 0; const stop = visibleInterval(() => n++, 1000, e.doc, e.timers);
  e.fire(); assert.equal(n, 1);
  e.doc.hidden = true; e.fire(); e.fire(); e.fire(); assert.equal(n, 1);
  e.show(); assert.equal(n, 2, 'single catch-up');
  e.show(); assert.equal(n, 2, 'no extra run when nothing was skipped');
  stop(); assert.equal(e.cleared(), 1); assert.equal(e.listeners.size, 0);
});
test('showing without a skipped tick does not run, and no document means plain interval', () => {
  const e = env(); let n = 0; visibleInterval(() => n++, 1000, e.doc, e.timers); e.show(); assert.equal(n, 0);
  let t; let c = 0; const stop = visibleInterval(() => c++, 5, undefined, { setInterval: f => { t = f; return 7; }, clearInterval() {} });
  t(); t(); assert.equal(c, 2); stop();
});
test('refresh polls use it; background-critical timers do not', () => {
  for (const f of ['TaskBoard', 'WorkbenchPanels', 'RigPanels', 'MobileDevices', 'EditorPanel', 'Sidebar'])
    assert.match(fs.readFileSync(`src/${f}.tsx`, 'utf8'), /visibleInterval\(/, f);
  for (const f of ['TerminalAlerts', 'TerminalReconnect'])
    assert.doesNotMatch(fs.readFileSync(`src/${f}.tsx`, 'utf8'), /visibleInterval/, f + ' must keep running in the background');
  assert.match(fs.readFileSync('docs/idle-cpu-audit.md', 'utf8'), /visibleInterval/);
});

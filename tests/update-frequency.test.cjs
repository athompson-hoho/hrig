const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const { scheduleUpdateChecks, CHECK_HOURS } = require('../electron/update-adapter.cjs');

function rig(isPackaged = true) {
  const log = []; let n = 0;
  const timers = {
    setTimeout: (fn, ms) => { const id = ++n; log.push(['timeout', id, ms]); return id; },
    setInterval: (fn, ms) => { const id = ++n; log.push(['interval', id, ms]); return id; },
    clearTimeout: id => log.push(['clearTimeout', id]), clearInterval: id => log.push(['clearInterval', id]),
  };
  const app = { isPackaged, whenReady: () => Promise.resolve(), once() {} };
  const service = { status: () => ({ phase: 'idle' }), operation: async () => {} };
  const controller = scheduleUpdateChecks(app, service, timers);
  return { log, controller };
}

test('default stays 6 hours with a 10 s startup check; changing it re-arms the periodic timer', async () => {
  const { log, controller } = rig(); await Promise.resolve();
  assert.deepEqual(log, [['timeout', 1, 10000], ['interval', 2, 21600000]]);
  controller.setHours(24); assert.deepEqual(log.slice(2), [['clearInterval', 2], ['interval', 3, 86400000]]);
  controller.setHours(168); assert.deepEqual(log.at(-1), ['interval', 4, 604800000]);
});

test('never (0) cancels the pending startup check and the periodic timer, and can be re-enabled', async () => {
  const { log, controller } = rig(); await Promise.resolve();
  controller.setHours(0);
  assert.ok(log.some(e => e[0] === 'clearTimeout' && e[1] === 1)); assert.ok(log.some(e => e[0] === 'clearInterval' && e[1] === 2));
  const before = log.length; controller.setHours(12);
  assert.deepEqual(log.slice(before), [['interval', 3, 43200000]]);
});

test('a value chosen before the app is ready is honored at ready (0 = no startup check)', async () => {
  const log = []; let n = 0; let resolve; const ready = new Promise(r => { resolve = r; });
  const timers = { setTimeout: (f, ms) => (log.push(['timeout', ms]), ++n), setInterval: (f, ms) => (log.push(['interval', ms]), ++n), clearTimeout() {}, clearInterval() {} };
  const c = scheduleUpdateChecks({ isPackaged: true, whenReady: () => ready, once() {} }, { status: () => ({ phase: 'idle' }), operation: async () => {} }, timers);
  c.setHours(0); resolve(); await ready; await Promise.resolve();
  assert.deepEqual(log, [], 'no startup check, no periodic timer');
  c.setHours(6); assert.deepEqual(log, [['interval', 21600000]]);
});

test('unsupported values are rejected; development builds still never schedule', () => {
  const { controller } = rig();
  for (const bad of [-1, 1, 5, 7, 1000, '6', NaN, undefined]) assert.throws(() => controller.setHours(bad), /Unsupported/, String(bad));
  assert.deepEqual(CHECK_HOURS, [0, 6, 12, 24, 168]);
  const dev = rig(false); assert.deepEqual(dev.log, []); assert.doesNotThrow(() => dev.controller.setHours(12));
});

test('setting, IPC and renderer wiring', () => {
  const m = new Module('s', module);
  m._compile(buildSync({ entryPoints: ['src/settings.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 's.js');
  const s = m.exports;
  assert.equal(s.resolveSettings()['workspace.updateCheckHours'], '6');
  const row = s.schema.find(r => r.key === 'workspace.updateCheckHours');
  assert.deepEqual(row.options.map(o => o.value), ['6', '12', '24', '168', '0']);
  assert.deepEqual(row.options.map(o => o.value).map(Number), CHECK_HOURS.slice(1).concat(0));
  for (const bad of ['1', 6, '', 'daily']) assert.throws(() => s.validateOverrides({ 'workspace.updateCheckHours': bad }));
  assert.match(fs.readFileSync('electron/preload.cjs', 'utf8'), /updateFrequency: invoke\('updates:frequency'\)/);
  assert.match(fs.readFileSync('electron/update-adapter.cjs', 'utf8'), /ipcMain\.handle\("updates:frequency", \(event, hours\) => \{\s*trusted\(event\);/);
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /updateFrequency\(Number\(preferences\["workspace\.updateCheckHours"\]\)\)/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`workspace\.updateCheckHours` \| `6`/);
  assert.match(fs.readFileSync('src/UpdateNotice.tsx', 'utf8'), /Release notes/, 'the update notice already shows release notes');
});

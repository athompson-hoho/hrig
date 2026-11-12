const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('cs', module);
m._compile(buildSync({ entryPoints: ['src/connection-status.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'cs.js');
const { connectionStatus: s } = m.exports;
const { CHECKING_SNAPSHOT } = { CHECKING_SNAPSHOT: 'Checking the last successful snapshot…' };
const I = (error, hasInventory, busy = false, local = false) => JSON.parse(JSON.stringify(s({ error, hasInventory, busy, local })));

test('every combination reproduces the previous header label, dot and error tone', () => {
  // previous App.tsx logic, reimplemented literally as the oracle
  const old = (error, inv, busy, local) => ({
    label: busy && !inv ? 'Connecting' : error && error !== CHECKING_SNAPSHOT ? 'Unavailable' : local ? 'Local' : inv ? 'Connected' : 'Ready',
    dot: busy && !inv ? 'unknown' : local || inv ? 'running' : 'unknown',
    error: !!error && error !== CHECKING_SNAPSHOT,
  });
  for (const error of ['', CHECKING_SNAPSHOT, 'ssh: timeout']) for (const inv of [false, true]) for (const busy of [false, true]) for (const local of [false, true]) {
    const r = I(error, inv, busy, local), o = old(error, inv, busy, local);
    assert.deepEqual({ label: r.label, dot: r.dot, error: r.error }, o, JSON.stringify([error, inv, busy, local]));
  }
});
test('sidebar banners: refreshing only for the unverified snapshot, stale for failures with data, unavailable without data', () => {
  assert.equal(I(CHECKING_SNAPSHOT, true).banner, 'refreshing');
  assert.equal(I(CHECKING_SNAPSHOT, false).banner, null);
  assert.equal(I('boom', true).banner, 'stale');
  assert.equal(I('boom', false).banner, 'unavailable');
  assert.equal(I('', true).banner, null);
  assert.equal(I('boom', true).state, 'stale'); assert.equal(I('boom', false).state, 'unavailable');
  assert.equal(I('', false, true).state, 'connecting'); assert.equal(I(CHECKING_SNAPSHOT, true).state, 'checking');
  assert.equal(I('', false, false, true).state, 'local'); assert.equal(I('', true).state, 'connected'); assert.equal(I('', false).state, 'ready');
});
test('header and sidebar both consume the shared function', () => {
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /connectionStatus\(\{\s*error: inventoryError/);
  const sb = fs.readFileSync('src/Sidebar.tsx', 'utf8');
  assert.match(sb, /connState\.banner === "refreshing"/); assert.match(sb, /connState\.banner === "stale"/);
});

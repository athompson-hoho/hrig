const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exp = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/rig-health.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exp, require });
const { rigHealthSummary } = exp;
const seat = (status, rigId = 'r1') => ({ id: status + Math.random(), rigId, status });

test('counts only known-working as working; running-unknown, stopped, failed are "other"', () => {
  const h = rigHealthSummary([seat('working'), seat('running'), seat('idle'), seat('attention'), seat('attention'),
    seat('stopped'), seat('failed'), seat('unknown')], 'Rig', true);
  assert.deepEqual([h.working, h.idle, h.attention, h.other, h.total], [1, 1, 2, 4, 8]);
  assert.equal(h.text, '1 working · 1 idle · 2 attention · 4 other');
  assert.match(h.detail, /4 other \(running with unknown activity, stopped, failed or unknown\)/);
  assert.match(h.detail, /last inventory snapshot/);
});

test('empty, stale and no-inventory are disclosed, not shown as healthy zeros', () => {
  assert.equal(rigHealthSummary([], 'Rig', true).text, 'No sessions');
  const stale = rigHealthSummary([seat('idle')], 'Rig', false);
  assert.match(stale.text, /· stale$/); assert.match(stale.detail, /stale or not verified/); assert.equal(stale.current, false);
  const none = rigHealthSummary(null, 'Rig', false);
  assert.equal(none.available, false); assert.equal(none.text, 'Health unavailable'); assert.match(none.detail, /unavailable/);
  assert.doesNotMatch(none.text, /0 working/);
});

test('singular wording and scope name in detail', () => {
  assert.match(rigHealthSummary([seat('idle')], 'Alpha', true).detail, /^Alpha: 1 session: /);
});

test('RigHealthStatus consumer scopes by selected rig and takes verified scope from attentionScope', () => {
  const ui = fs.readFileSync('src/RigHealthStatus.tsx', 'utf8');
  assert.match(ui, /!rigId \|\| s\.rigId === rigId/);
  assert.match(ui, /rigHealthSummary\(seats, scopeName, ready, /);
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /<RigHealthStatus[^>]*\n\s*scope=\{attentionScope\(connection, connection, inventory, inventoryHealth\.current, inventoryError\)\}/);
  assert.doesNotMatch(ui, /setInterval|setTimeout|window\.hrig/);
});

test('a selected rig missing from a verified inventory reads "Rig not found", not an empty healthy rig', () => {
  const h = rigHealthSummary([], 'Selected rig', true, true);
  assert.equal(h.text, 'Rig not found'); assert.equal(h.available, false);
  assert.doesNotMatch(h.text, /No sessions/); assert.match(h.detail, /not in the represented inventory/);
  const ui = fs.readFileSync('src/RigHealthStatus.tsx', 'utf8');
  assert.match(ui, /!!rigId && !!inventory && !rig/);
});

test('sessions with unknown activity never read as an all-zero rig on screen', () => {
  const h = rigHealthSummary([seat('running'), seat('running')], 'Rig', true);
  assert.equal(h.text, '0 working · 0 idle · 0 attention · 2 other');
  assert.equal(rigHealthSummary([seat('idle')], 'Rig', true).text, '0 working · 1 idle · 0 attention');
});

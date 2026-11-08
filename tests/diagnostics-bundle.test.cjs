const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preferences } = require('./diagnostics-export-app.test.cjs');
const catalog = ['Windows workspace', 'OpenRig host', 'Node.js', 'OpenRig', 'tmux', 'Python 3', 'OpenRig daemon', 'Connection / Python'];
const policy = () => import('../electron/diagnostics-bundle.mjs');

test('finite projection preserves useful known statuses and nine selected settings without inspecting private getters', async () => {
  const { projectDiagnosticsRequest } = await policy();
  const forbidden = () => { throw Error('private getter must remain untouched'); };
  const row = { name: 'Node.js', ok: true };
  Object.defineProperties(row, { detail: { get: forbidden }, toJSON: { get: forbidden } });
  const report = { checks: [row, { name: 'tmux', ok: false }, { name: 'SYNTHETIC_PRIVATE_CANARY', get ok() { forbidden(); } }] };
  Object.defineProperties(report, { healthy: { get: forbidden }, toJSON: { get: forbidden }, unknown: { get: forbidden } });
  const settings = { ...preferences, 'appearance.fontFamily': 'SYNTHETIC_PRIVATE_CANARY' };
  Object.defineProperties(settings, { toJSON: { get: forbidden }, unknown: { get: forbidden } });
  const text = projectDiagnosticsRequest(report, settings, true);
  const request = JSON.parse(text);
  assert.deepEqual(Object.keys(request), ['schemaVersion', 'source', 'checks', 'settings']);
  assert.equal(request.schemaVersion, 1); assert.equal(request.source, 'represented-connection-doctor');
  assert.equal(request.checks.availability, 'available');
  assert.deepEqual(request.checks.entries, catalog.map(name => ({ name, status: name === 'Node.js' ? 'ok' : name === 'tmux' ? 'failed' : 'unknown' })));
  assert.equal(Object.keys(request.settings).length, 9); assert.equal(request.settings['terminal.scrollback'], 1001);
  assert.ok(!text.includes('SYNTHETIC_PRIVATE_CANARY')); assert.ok(Buffer.byteLength(text) <= 16384);
});

test('duplicates and invalid booleans become unknown and absent oversized or ineligible reports stay unavailable', async () => {
  const { projectDiagnosticsRequest } = await policy();
  const read = (report, eligible = true) => JSON.parse(projectDiagnosticsRequest(report, preferences, eligible));
  const duplicate = read({ checks: [{ name: 'Node.js', ok: true }, { name: 'Node.js', ok: false }, { name: 'tmux', ok: 'true' }] });
  assert.ok(duplicate.checks.entries.every(c => c.status === 'unknown'));
  for (const report of [null, {}, { checks: [] }, { checks: 'bad' }, { checks: Array(33).fill({ name: 'Node.js', ok: true }) }]) {
    const result = read(report); assert.equal(result.checks.availability, 'unavailable');
    assert.equal(result.settings['editor.fontSize'], 14);
  }
  assert.equal(read({ checks: [{ name: 'Node.js', ok: true }] }, false).checks.availability, 'unavailable');
});

test('settings accept source integer boundaries and omit coercion nonfinite fractional and arbitrary text', async () => {
  const { projectDiagnosticsRequest } = await policy();
  const ranges = { 'editor.fontSize': [10, 32], 'editor.tabSize': [1, 8], 'terminal.fontSize': [10, 32], 'terminal.scrollback': [1000, 100000], 'workspace.refreshInterval': [5, 120] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    for (const value of [min, max]) assert.equal(JSON.parse(projectDiagnosticsRequest(null, { [key]: value }, false)).settings[key], value);
    for (const value of [min - 1, max + 1, min + 0.5, NaN, Infinity, String(min), null, {}]) {
      assert.deepEqual(JSON.parse(projectDiagnosticsRequest(null, { [key]: value }, false)).settings, {});
    }
  }
  for (const [key, value] of [['appearance.density', 'SYNTHETIC_PRIVATE_CANARY'], ['appearance.reduceMotion', 'false'], ['editor.wordWrap', true], ['terminal.cursorStyle', 'SYNTHETIC_PRIVATE_CANARY']]) {
    assert.deepEqual(JSON.parse(projectDiagnosticsRequest(null, { [key]: value }, false)).settings, {});
  }
});

test('native request parsing rejects malformed oversized UTF8 and reprojects forged keys while versions stay strictly numeric', async () => {
  const { projectDiagnosticsRequest, parseDiagnosticsRequest, createDiagnosticsBundle } = await policy();
  const valid = projectDiagnosticsRequest({ checks: [{ name: 'Node.js', ok: true }] }, preferences, true);
  const forged = JSON.stringify({ ...JSON.parse(valid), path: '/synthetic/forged', versions: { node: '99.99' }, secret: 'SYNTHETIC_PRIVATE_CANARY' });
  const request = parseDiagnosticsRequest(forged);
  assert.ok(!JSON.stringify(request).includes('SYNTHETIC_PRIVATE_CANARY'));
  const bundle = createDiagnosticsBundle(request, { hrig: '1.2.3', electron: '45.0.0', chromium: '150.0.1.2', node: '24.1' });
  const result = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
  assert.deepEqual(result.versions, { hrig: '1.2.3', electron: '45.0.0', chromium: '150.0.1.2', node: '24.1' });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
  for (const value of ['v1.2', '1.2-private', '1.2\n', '/fake/1.2', '1', '123456.1', {}, null]) {
    const invalid = createDiagnosticsBundle(request, { hrig: value, electron: value, chromium: value, node: value });
    assert.ok(Object.values(typeof invalid === 'string' ? JSON.parse(invalid).versions : invalid.versions).every(v => v === 'unavailable'));
  }
  for (const value of [null, {}, '{', '"' + 'é'.repeat(8192) + '"']) {
    let rejected = false;
    try { rejected = !parseDiagnosticsRequest(value); } catch { rejected = true; }
    assert.equal(rejected, true, 'malformed or oversized request rejected');
  }
});

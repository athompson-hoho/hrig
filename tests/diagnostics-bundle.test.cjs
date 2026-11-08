const { test } = require('node:test');
const assert = require('node:assert/strict');
const preferences = { 'appearance.density': 'compact', 'appearance.reduceMotion': false, 'editor.fontSize': 14, 'editor.tabSize': 2, 'editor.wordWrap': 'on', 'terminal.fontSize': 13, 'terminal.cursorStyle': 'bar', 'terminal.scrollback': 1001, 'workspace.refreshInterval': 15 };
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

test('throwing allowed getters fail closed while unknown getters and hostile toJSON remain untouched', async () => {
  const { projectDiagnosticsRequest, createDiagnosticsBundle, parseDiagnosticsRequest } = await policy();
  const throws = () => { throw Error('synthetic getter'); };
  for (const report of [{ get checks() { throws(); } }, { checks: [null, { get name() { throws(); } }, { name: 'Node.js', get ok() { throws(); } }] }]) {
    const result = JSON.parse(projectDiagnosticsRequest(report, { get 'editor.fontSize'() { throws(); }, 'terminal.scrollback': 1001 }, true));
    assert.ok(result.checks.entries.every(row => row.status === 'unknown'));
    assert.deepEqual(result.settings, { 'terminal.scrollback': 1001 });
  }
  let unknownReads = 0;
  const rows = [{ name: 'unknown', get ok() { unknownReads++; throw Error(); } }];
  Object.defineProperty(rows, 'toJSON', { get: throws });
  const text = projectDiagnosticsRequest({ checks: rows }, preferences, true);
  assert.equal(unknownReads, 0);
  const versions = { hrig: '1.2', get electron() { throws(); }, chromium: '150.1', node: '24.0', get toJSON() { throws(); } };
  const bundle = JSON.parse(createDiagnosticsBundle(parseDiagnosticsRequest(text), versions));
  assert.equal(bundle.versions.electron, 'unavailable');
  assert.equal(bundle.versions.node, '24.0');
  assert.ok(Buffer.byteLength(text, 'utf8') <= 16384);
  assert.ok(Buffer.byteLength(JSON.stringify(bundle), 'utf8') <= 65536);
});

test('native reprojects raw status and setting domains into stable fresh keys', async () => {
  const { parseDiagnosticsRequest, createDiagnosticsBundle } = await policy();
  const forged = { schemaVersion: 1, source: 'represented-connection-doctor', checks: { availability: 'available', entries: [{ name: 'tmux', status: 'failed', detail: 'PRIVATE' }, { name: 'Node.js', status: 'ok' }, { name: 'Node.js', status: 'ok' }, { name: 'PRIVATE', status: 'ok' }] }, settings: { 'editor.fontSize': '14', 'terminal.scrollback': 1001, unknown: 'PRIVATE' }, versions: { node: 'PRIVATE' }, path: 'PRIVATE' };
  const request = parseDiagnosticsRequest(JSON.stringify(forged));
  assert.deepEqual(request.settings, { 'terminal.scrollback': 1001 });
  assert.deepEqual(request.checks.entries.map(row => row.name), catalog);
  assert.equal(request.checks.entries.find(row => row.name === 'Node.js').status, 'unknown');
  assert.equal(request.checks.entries.find(row => row.name === 'tmux').status, 'failed');
  assert.ok(!createDiagnosticsBundle(request, { node: '24.0' }).includes('PRIVATE'));
  const reordered = { ...forged, checks: { ...forged.checks, entries: [...forged.checks.entries].reverse() } };
  assert.deepEqual(parseDiagnosticsRequest(JSON.stringify(reordered)), request);
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

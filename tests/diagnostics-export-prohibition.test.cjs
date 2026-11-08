const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, exportButton, notice, tick, preferences } = require('./diagnostics-export-app.test.cjs');
const { nativeHarness } = require('./diagnostics-export.test.cjs');

test('diagnostics export preserves finite projection and explicit local authority', async () => {
  const canary = 'SYNTHETIC_PRIVATE_CANARY';
  const catalog = ['Windows workspace', 'OpenRig host', 'Node.js', 'OpenRig', 'tmux', 'Python 3', 'OpenRig daemon', 'Connection / Python'];
  for (const options of [{}, { canceled: true }, { fail: 'write', existing: true }]) {
    const native = await nativeHarness({ composed: true, ...options });
    const requests = [], notices = [], forbidden = [];
    const record = (name, ...args) => forbidden.push({ name, args });
    const api = { exportDiagnostics: request => {
      requests.push(request);
      return native.preload.exportDiagnostics(request);
    } };
    for (const name of ['readTerminal', 'writeTerminal', 'answerPrompt', 'createTerminal', 'closeTerminal',
      'resetTerminal', 'relaunchTerminal', 'startSeat', 'stopSeat', 'restartSeat', 'rigControl',
      'inventory', 'refreshInventory', 'edit', 'queue', 'upload', 'fetch']) api[name] = (...args) => record(name, ...args);
    const h = await harness(api);
    h.repoint({ id: canary, name: canary, host: canary, root: canary });
    h.scope.useSettings = () => ({ effective: { ...preferences, 'appearance.fontFamily': canary,
      'terminal.shell': canary, unknown: canary } });
    for (const name of ['fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame']) h.scope[name] = (...args) => record(name, ...args);
    h.scope.window.dispatchEvent = (...args) => record('dispatchEvent', ...args);
    h.render(); h.flush();
    h.doctorRequests[0]({ healthy: true, identity: canary, checks: [
      { name: 'Node.js', ok: true, detail: canary }, { name: 'tmux', ok: false, detail: canary },
      { name: canary, ok: true, detail: canary },
    ] });
    await tick(); h.render();
    assert.equal(h.calls.filter(c => c[0] === 'doctor').length, 1, 'existing mount diagnosis is the baseline');
    assert.deepEqual(native.effects, [], 'no Save before activation');
    assert.deepEqual(requests, []);
    const baseline = h.calls.length;
    const subject = {
      record,
      async export() {
        const pending = exportButton(h.render()).props.onClick();
        notices.push(notice(h.render()));
        await pending;
        notices.push(notice(h.render()));
        // Only new export surfaces: old Doctor details are deliberately excluded.
        return { requests, notices, bytes: native.files.get(native.destination),
          effects: native.effects, forbidden, calls: h.calls.slice(baseline) };
      },
    };
    const marker = process.env.GSD_PROHIB_SUBJECT;
    const wrapped = marker ? require(path.resolve(marker))(subject) : subject;
    const observed = await wrapped.export();
    assert.deepEqual([...observed.requests, ...observed.notices, observed.bytes || ''].filter(text => text.includes(canary)), [],
      'privacy: exported request bytes and new notices exclude synthetic private content');
    assert.deepEqual(observed.forbidden, [], 'authority: export adds no forbidden effects or arguments');
    assert.deepEqual(observed.calls, [], 'authority: export adds no Doctor calls after the baseline');
    assert.equal(observed.requests.length, 1);
    assert.ok(Buffer.byteLength(observed.requests[0], 'utf8') <= 16384);
    const request = JSON.parse(observed.requests[0]);
    assert.deepEqual(Object.keys(request), ['schemaVersion', 'source', 'checks', 'settings']);
    assert.equal(request.schemaVersion, 1);
    assert.equal(request.source, 'represented-connection-doctor');
    assert.equal(request.checks.availability, 'available');
    assert.deepEqual(request.checks.entries, catalog.map(name => ({ name,
      status: name === 'Node.js' ? 'ok' : name === 'tmux' ? 'failed' : 'unknown' })));
    const expectedSettings = { ...preferences }; delete expectedSettings['connections.defaultRoot'];
    assert.deepEqual(request.settings, expectedSettings, 'all nine useful finite settings survive');
    const expectedStatus = options.canceled ? 'Export canceled. No file was saved.' : options.fail
      ? 'Could not save diagnostics. The destination may already exist, or the filesystem may not support this export. Try a new file name on a supported, writable filesystem.' : 'Diagnostics saved.';
    assert.deepEqual(observed.notices, ['Preparing diagnostics export…', expectedStatus]);
    const effectNames = observed.effects.map(e => e[0]);
    if (options.canceled) {
      assert.deepEqual(effectNames, ['dialog']); assert.equal(native.files.size, 0);
    } else if (options.fail) {
      assert.deepEqual(effectNames, ['dialog', 'versions', 'open', 'write', 'close', 'unlink']);
      assert.equal(observed.bytes, 'original synthetic bytes'); assert.equal(native.files.size, 1);
    } else {
      assert.deepEqual(effectNames, ['dialog', 'versions', 'open', 'write', 'sync', 'close', 'link', 'unlink']);
      assert.equal(native.files.size, 1);
      assert.ok(Buffer.byteLength(observed.bytes, 'utf8') <= 65536);
      const bundle = JSON.parse(observed.bytes);
      assert.deepEqual(Object.keys(bundle), ['schemaVersion', 'source', 'checks', 'settings', 'versions']);
      assert.deepEqual(bundle.checks, request.checks);
      assert.deepEqual(bundle.settings, expectedSettings);
      assert.deepEqual(bundle.versions, { hrig: '1.2.3', electron: '45.0.0', chromium: '150.0.1', node: '24.1.0' });
    }
  }
});

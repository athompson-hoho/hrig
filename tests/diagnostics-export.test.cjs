const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Only a synthetic in-memory filesystem. No native dialog or real file access.
async function nativeHarness(options = {}) {
  const { registerDiagnosticsExport } = require('../electron/diagnostics-export.cjs');
  const { projectDiagnosticsRequest } = await import('../electron/diagnostics-bundle.mjs');
  const handlers = {}, effects = [], files = new Map();
  const destination = '/synthetic/new.json';
  if (options.existing) files.set(destination, 'original synthetic bytes');
  const fail = step => { if (options.fail === step) throw Error('SYNTHETIC_PRIVATE_CANARY /synthetic/error'); };
  registerDiagnosticsExport({
    handle: (name, fn) => { handlers[name] = fn; }, getWindow: () => null,
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    dialog: { showSaveDialog: async (_window, config) => {
      effects.push(['dialog', config]);
      return options.dialog ? options.dialog() : { canceled: !!options.canceled, filePath: destination };
    } },
    getVersions: () => { effects.push(['versions']); return { hrig: '1.2.3', electron: '45.0.0', chromium: '150.0.1', node: '24.1.0' }; },
    fs: {
      async open(file, flags, mode) {
        effects.push(['open', file, flags, mode]); fail('open');
        assert.equal(path.dirname(file), path.dirname(destination));
        assert.notEqual(file, destination); assert.equal(flags, 'wx'); assert.equal(mode, 0o600);
        assert.ok(!files.has(file)); files.set(file, '');
        return {
          async writeFile(bytes, encoding) { effects.push(['write']); fail('write'); assert.equal(encoding, 'utf8'); files.set(file, bytes); },
          async sync() { effects.push(['sync']); fail('sync'); },
          async close() { effects.push(['close']); fail('close'); },
        };
      },
      async link(from, to) { effects.push(['link', from, to]); fail('link'); if (files.has(to)) throw Error('synthetic EEXIST'); files.set(to, files.get(from)); },
      async unlink(file) { effects.push(['unlink', file]); assert.notEqual(file, destination); fail('unlink'); files.delete(file); },
    },
  });
  assert.equal(typeof handlers['diagnostics:export'], 'function');
  const request = projectDiagnosticsRequest({ checks: [{ name: 'Node.js', ok: true }] }, { 'editor.fontSize': 14 }, true);
  return { effects, files, destination, request, run: value => handlers['diagnostics:export']({}, value ?? request) };
}

test('native Save cancellation precedes version and file effects', async () => {
  const h = await nativeHarness({ canceled: true });
  assert.deepEqual(await h.run(), { status: 'canceled' });
  assert.deepEqual(h.effects.map(e => e[0]), ['dialog']);
  assert.equal(h.files.size, 0);
});
test('native export publishes useful JSON only after private exclusive write sync and close', async () => {
  const h = await nativeHarness();
  assert.deepEqual(await h.run(), { status: 'saved' });
  assert.deepEqual(h.effects.map(e => e[0]), ['dialog', 'versions', 'open', 'write', 'sync', 'close', 'link', 'unlink']);
  assert.equal(h.files.size, 1);
  const bundle = JSON.parse(h.files.get(h.destination));
  assert.equal(bundle.settings['editor.fontSize'], 14); assert.equal(bundle.versions.hrig, '1.2.3');
  assert.equal(bundle.checks.entries.find(e => e.name === 'Node.js').status, 'ok');
  assert.ok(!JSON.stringify(bundle).includes('SYNTHETIC_PRIVATE_CANARY'));
});
test('native failures preserve destination and clean only an owned temporary with generic results', async () => {
  for (const fail of ['open', 'write', 'sync', 'close', 'link']) {
    const h = await nativeHarness({ fail, existing: true });
    assert.deepEqual(await h.run(), { status: 'error' });
    assert.equal(h.files.get(h.destination), 'original synthetic bytes');
    if (fail === 'open') assert.ok(!h.effects.some(e => e[0] === 'unlink'), 'failed exclusive creation owns nothing');
    assert.deepEqual(await h.run(), { status: 'error' }, 'finally releases native guard');
  }
  const collision = await nativeHarness({ existing: true });
  assert.deepEqual(await collision.run(), { status: 'error' });
  assert.equal(collision.files.get(collision.destination), 'original synthetic bytes');
  const cleanup = await nativeHarness({ fail: 'unlink' });
  assert.deepEqual(await cleanup.run(), { status: 'saved' }, 'published success survives cleanup failure');
  assert.ok(cleanup.files.has(cleanup.destination));
});
test('native guard rejects concurrent Save and recovers after cancellation', async () => {
  let finish;
  const h = await nativeHarness({ dialog: () => new Promise(resolve => { finish = resolve; }) });
  const first = h.run();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(await h.run(), { status: 'error' });
  assert.equal(h.effects.filter(e => e[0] === 'dialog').length, 1);
  finish({ canceled: true }); assert.deepEqual(await first, { status: 'canceled' });
});
module.exports = { nativeHarness };

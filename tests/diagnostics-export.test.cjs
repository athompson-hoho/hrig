const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sourceFs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Only a synthetic in-memory filesystem. No native dialog or real file access.
async function nativeHarness(options = {}) {
  const { registerDiagnosticsExport } = require('../electron/diagnostics-export.cjs');
  const { projectDiagnosticsRequest } = await import('../electron/diagnostics-bundle.mjs');
  const handlers = {}, effects = [], files = new Map();
  const destination = '/synthetic/new.json';
  if (options.existing) files.set(destination, 'original synthetic bytes');
  const fail = step => { if (options.fail === step) throw Error('SYNTHETIC_PRIVATE_CANARY /synthetic/error'); };
  let preload, sender = {};
  const dependencies = {
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
        if (options.collision) files.set(file, 'foreign temporary');
        if (files.has(file)) throw Error('synthetic exclusive collision');
        files.set(file, '');
        return {
          async writeFile(bytes, encoding) { effects.push(['write']); if (options.fail === 'partial') { files.set(file, bytes.slice(0, 12)); throw Error('synthetic partial write'); } fail('write'); assert.equal(encoding, 'utf8'); files.set(file, bytes); },
          async sync() { effects.push(['sync']); fail('sync'); },
          async close() { effects.push(['close']); fail('close'); },
        };
      },
      async link(from, to) { effects.push(['link', from, to]); if (options.beforeLink) await options.beforeLink(); fail('link'); if (files.has(to)) throw Error('synthetic EEXIST'); files.set(to, files.get(from)); },
      async unlink(file) { effects.push(['unlink', file]); assert.notEqual(file, destination); fail('unlink'); files.delete(file); },
    },
  };
  if (options.composed) {
    const text = sourceFs.readFileSync('electron/main.cjs', 'utf8');
    const root = ts.createSourceFile('main.cjs', text, ts.ScriptTarget.Latest, true);
    const trusted = root.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(root) === 'trusted'));
    const handle = root.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handle');
    const registration = root.statements.filter(node => ts.isExpressionStatement(node) && node.getText(root).includes("require('./diagnostics-export.cjs').registerDiagnosticsExport"));
    assert.equal(registration.length, 1);
    const fakeVersions = { electron: '45.0.0', chrome: '150.0.1', node: '24.1.0' };
    vm.runInNewContext([trusted, handle, registration[0]].map(node => node.getText(root)).join('\n'), {
      mainWindow: { webContents: sender },
      ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
      dialog: dependencies.dialog, fs: dependencies.fs,
      app: { getVersion: () => { effects.push(['versions']); return '1.2.3'; } },
      process: { versions: fakeVersions },
      require: id => {
        if (id === './diagnostics-export.cjs') return { registerDiagnosticsExport };
        if (id === 'node:crypto') return { randomUUID: dependencies.randomUUID };
        throw Error('unexpected main dependency');
      },
    });
    vm.runInNewContext(sourceFs.readFileSync('electron/preload.cjs', 'utf8'), {
      process: { platform: 'synthetic' },
      require: id => {
        assert.equal(id, 'electron');
        return { contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'hrig'); preload = api; } }, ipcRenderer: { invoke: (channel, ...args) => handlers[channel]({ sender }, ...args) } };
      },
    });
  } else registerDiagnosticsExport(dependencies);
  assert.equal(typeof handlers['diagnostics:export'], 'function');
  const request = projectDiagnosticsRequest({ checks: [{ name: 'Node.js', ok: true }] }, { 'editor.fontSize': 14 }, true);
  return { effects, files, destination, request, preload,
    raw: value => handlers['diagnostics:export']({ sender }, value),
    untrusted: value => handlers['diagnostics:export']({ sender: {} }, value),
    run: value => options.composed ? preload.exportDiagnostics(value ?? request) : handlers['diagnostics:export']({}, value ?? request) };
}

if (require.main === module) test('native Save cancellation precedes version and file effects', async () => {
  const h = await nativeHarness({ canceled: true });
  assert.deepEqual(await h.run(), { status: 'canceled' });
  assert.deepEqual(h.effects.map(e => e[0]), ['dialog']);
  assert.equal(h.files.size, 0);
});
if (require.main === module) test('native export publishes useful JSON only after private exclusive write sync and close', async () => {
  const h = await nativeHarness();
  assert.deepEqual(await h.run(), { status: 'saved' });
  assert.deepEqual(h.effects.map(e => e[0]), ['dialog', 'versions', 'open', 'write', 'sync', 'close', 'link', 'unlink']);
  assert.equal(h.files.size, 1);
  const bundle = JSON.parse(h.files.get(h.destination));
  assert.equal(bundle.settings['editor.fontSize'], 14); assert.equal(bundle.versions.hrig, '1.2.3');
  assert.equal(bundle.checks.entries.find(e => e.name === 'Node.js').status, 'ok');
  assert.ok(!JSON.stringify(bundle).includes('SYNTHETIC_PRIVATE_CANARY'));
});
if (require.main === module) test('native failures preserve destination and clean only an owned temporary with generic results', async () => {
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
if (require.main === module) test('native guard rejects concurrent Save and recovers after cancellation', async () => {
  let finish;
  const h = await nativeHarness({ dialog: () => new Promise(resolve => { finish = resolve; }) });
  const first = h.run();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(await h.run(), { status: 'error' });
  assert.equal(h.effects.filter(e => e[0] === 'dialog').length, 1);
  finish({ canceled: true }); assert.deepEqual(await first, { status: 'canceled' });
});
module.exports = { nativeHarness };

if (require.main === module) test('actual preload and trusted main registration compose with the real native adapter', async () => {
  const h = await nativeHarness({ composed: true });
  await assert.rejects(h.untrusted(h.request), /Untrusted application window/);
  assert.deepEqual(h.effects, []);
  const forged = JSON.stringify({ ...JSON.parse(h.request), path: '/synthetic/forged', versions: { node: '99.99' }, unknown: 'SYNTHETIC_PRIVATE_CANARY' });
  assert.equal((await h.preload.exportDiagnostics(forged)).status, 'saved');
  const output = JSON.parse(h.files.get(h.destination));
  assert.equal(output.versions.node, '24.1.0');
  assert.equal(output.checks.entries.find(row => row.name === 'Node.js').status, 'ok');
  assert.equal(output.settings['editor.fontSize'], 14);
  assert.ok(!h.files.get(h.destination).includes('SYNTHETIC_PRIVATE_CANARY'));
  assert.ok(!h.files.has('/synthetic/forged'));
});

if (require.main === module) test('native rejects raw malformed and oversized UTF8 requests before parse or any effect', async () => {
  const h = await nativeHarness();
  for (const value of [undefined, null, {}, '{', '[]', '{}', '"' + 'é'.repeat(8192) + '"']) {
    assert.deepEqual(await h.raw(value), { status: 'error' });
    assert.deepEqual(h.effects, []);
  }
  // The oversized string must be refused before even loading the parser module.
  const source = sourceFs.readFileSync('electron/diagnostics-export.cjs', 'utf8');
  const handlers = {};
  const module = { exports: {} };
  vm.runInNewContext(source, { module, Buffer, require: id => { assert.equal(id, 'node:path'); return path; } });
  module.exports.registerDiagnosticsExport({ handle: (name, fn) => { handlers[name] = fn; } });
  assert.equal((await handlers['diagnostics:export']({}, 'é'.repeat(8193))).status, 'error');
  assert.deepEqual(await h.run(), { status: 'saved' }, 'bad inputs release pending guard');
});

if (require.main === module) test('native partial write and exclusive temp collision never publish or remove foreign data', async () => {
  const partial = await nativeHarness({ fail: 'partial', existing: true });
  assert.deepEqual(await partial.run(), { status: 'error' });
  assert.equal(partial.files.get(partial.destination), 'original synthetic bytes');
  assert.equal(partial.files.size, 1, 'owned partial temporary removed');
  assert.ok(!partial.effects.some(e => e[0] === 'link'));
  const collision = await nativeHarness({ collision: true });
  assert.deepEqual(await collision.run(), { status: 'error' });
  assert.deepEqual([...collision.files.values()], ['foreign temporary']);
  assert.ok(!collision.effects.some(e => e[0] === 'unlink'));
});

if (require.main === module) test('native guard recovers after cancellation and a subsequent explicit request publishes', async () => {
  let calls = 0;
  const h = await nativeHarness({ dialog: async () => ++calls === 1 ? { canceled: true } : { canceled: false, filePath: '/synthetic/new.json' } });
  assert.deepEqual(await h.run(), { status: 'canceled' });
  assert.deepEqual(await h.run(), { status: 'saved' });
  assert.equal(h.effects.filter(e => e[0] === 'versions').length, 1);
  assert.equal(h.files.size, 1);
});

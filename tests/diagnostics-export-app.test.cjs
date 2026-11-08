const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const host = { id: 'synthetic', name: 'Synthetic connection', kind: 'ssh', host: 'fake.invalid', root: '/synthetic' };
const preferences = {
  'appearance.density': 'compact', 'appearance.reduceMotion': false,
  'editor.fontSize': 14, 'editor.tabSize': 2, 'editor.wordWrap': 'on',
  'terminal.fontSize': 13, 'terminal.cursorStyle': 'bar',
  'terminal.scrollback': 1001, 'workspace.refreshInterval': 15,
  'connections.defaultRoot': 'SYNTHETIC_PRIVATE_CANARY',
};
function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value == null || value === false) return [];
  return typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [value];
}
function unique(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  assert.equal(found.length, 1, 'actual source seam is unique');
  return found[0];
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function harness(api = {}) {
  const file = 'src/WorkbenchPanels.tsx';
  const root = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = unique(root, n => ts.isFunctionDeclaration(n) && n.name?.text === 'DoctorPanel');
  // Before implementation the actual Doctor uses no policy. Do not substitute a
  // fake projection: once added, load the real shared module for the consumer.
  const policy = fs.existsSync('electron/diagnostics-bundle.mjs') ? await import('../electron/diagnostics-bundle.mjs') : {};
  const values = [], effects = [], pending = [], calls = [];
  let cursor = 0, nextId = 0, unmounted = false, lateUpdates = 0;
  const doctorRequests = [], doctorRejects = [];
  const scope = {
    ...policy,
    JSON, TextEncoder,
    React: { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } },
    useSettings: () => ({ effective: preferences }),
    useId: () => { const i = cursor++; return values[i] ??= `diagnostics-${nextId++}`; },
    useState(initial) {
      const i = cursor++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => {
        if (unmounted) lateUpdates++;
        values[i] = typeof value === 'function' ? value(values[i]) : value;
      }];
    },
    useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!effects[i] || deps.some((value, j) => !Object.is(value, effects[i].deps[j]))) {
        pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
      }
    },
    window: { hrig: {
      doctor: connection => { calls.push(['doctor', connection]); return new Promise((resolve, reject) => { doctorRequests.push(resolve); doctorRejects.push(reject); }); },
      exportDiagnostics: request => { calls.push(['export', request]); return Promise.resolve({ status: 'saved' }); },
      ...api,
    } },
    Network: 'Network', RefreshCw: 'RefreshCw', Check: 'Check', AlertCircle: 'AlertCircle', ErrorBox: 'ErrorBox', Loading: 'Loading',
  };
  const context = vm.createContext(scope);
  vm.runInContext(ts.transpileModule(`component = (${node.getText(root).replace(/^export\s+/, '')});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context);
  let connection = { ...host };
  return {
    calls, doctorRequests, doctorRejects, scope,
    render() { cursor = 0; return context.component({ connection }); },
    flush() { while (pending.length) pending.shift()(); },
    repoint(change) { connection = { ...connection, ...change }; },
    unmount() { unmounted = true; for (const e of effects) e?.cleanup?.(); },
    get lateUpdates() { return lateUpdates; },
  };
}
function exportButton(tree) {
  const button = flatten(tree).find(n => n?.type === 'button' && flatten(n.props.children).some(v => v === 'Export redacted diagnostics…' || v === 'Exporting…'));
  assert.ok(button, 'actual Doctor exposes the explicit redacted diagnostics export action');
  return button;
}
function notice(tree) {
  const region = flatten(tree).find(n => n?.props?.role === 'status');
  assert.ok(region, 'persistent export status region exists');
  assert.equal(region.props['aria-live'], 'polite');
  assert.equal(region.props['aria-atomic'], true);
  return flatten(region.props.children).filter(x => typeof x === 'string').join('');
}

if (require.main === module) test('actual Doctor exports a useful finite snapshot only after explicit activation', async () => {
  const h = await harness();
  let tree = h.render();
  const initial = exportButton(tree);
  assert.equal(initial.props.type, 'button');
  assert.ok(initial.props['aria-describedby']);
  assert.deepEqual(h.calls, [], 'render does not export or collect');
  h.flush();
  h.doctorRequests[0]({ healthy: true, checks: [{ name: 'Node.js', ok: true, detail: 'SYNTHETIC_PRIVATE_CANARY' }] });
  await tick(); tree = h.render();
  await exportButton(tree).props.onClick();
  const exports = h.calls.filter(c => c[0] === 'export');
  assert.equal(exports.length, 1);
  assert.equal(h.calls.filter(c => c[0] === 'doctor').length, 1, 'export adds no diagnosis');
  const text = exports[0][1];
  assert.equal(typeof text, 'string'); assert.ok(Buffer.byteLength(text) <= 16384);
  const request = JSON.parse(text);
  assert.equal(request.source, 'represented-connection-doctor');
  assert.equal(request.checks.availability, 'available');
  assert.deepEqual(request.checks.entries.find(c => c.name === 'Node.js'), { name: 'Node.js', status: 'ok' });
  assert.equal(request.settings['terminal.scrollback'], 1001);
  assert.equal(Object.keys(request.settings).length, 9);
  assert.ok(!text.includes('SYNTHETIC_PRIVATE_CANARY'));
  assert.equal(notice(h.render()), 'Diagnostics saved.');
});

if (require.main === module) test('actual Doctor synchronously guards duplicate activations and waits for the native result', async () => {
  const requests = [];
  const h = await harness({ exportDiagnostics: value => new Promise(resolve => requests.push({ value, resolve })) });
  const button = exportButton(h.render()); h.flush();
  const first = button.props.onClick(); const second = button.props.onClick();
  assert.equal(requests.length, 1, 'two immediate activations send one request');
  const busy = exportButton(h.render());
  assert.equal(busy.props.disabled, true); assert.equal(busy.props['aria-busy'], true);
  assert.equal(notice(h.render()), 'Preparing diagnostics export…');
  requests[0].resolve({ status: 'canceled' }); await Promise.all([first, second]);
  assert.equal(notice(h.render()), 'Export canceled. No file was saved.');
  assert.ok(!exportButton(h.render()).props.disabled);
});

module.exports = { harness, flatten, exportButton, notice, tick, host, preferences, unique };

if (require.main === module) test('actual Doctor through preload trusted main and native Save publishes only its finite click snapshot', async () => {
  const { nativeHarness } = require('./diagnostics-export.test.cjs');
  const native = await nativeHarness({ composed: true });
  const h = await harness({ exportDiagnostics: native.preload.exportDiagnostics });
  h.render(); h.flush();
  h.doctorRequests[0]({ checks: [{ name: 'Node.js', ok: true, detail: 'SYNTHETIC_PRIVATE_CANARY' }, { name: 'tmux', ok: false }] });
  await tick();
  assert.deepEqual(native.effects, [], 'mount diagnosis never opens Save');
  await exportButton(h.render()).props.onClick();
  assert.equal(notice(h.render()), 'Diagnostics saved.');
  assert.equal(native.files.size, 1);
  const bytes = native.files.get(native.destination);
  const bundle = JSON.parse(bytes);
  assert.equal(bundle.checks.entries.find(row => row.name === 'Node.js').status, 'ok');
  assert.equal(bundle.checks.entries.find(row => row.name === 'tmux').status, 'failed');
  assert.equal(bundle.versions.node, '24.1.0');
  assert.equal(bundle.settings['terminal.scrollback'], 1001);
  assert.equal(Object.keys(bundle.settings).length, 9);
  assert.ok(!bytes.includes('SYNTHETIC_PRIVATE_CANARY'));
  assert.equal(h.calls.filter(c => c[0] === 'doctor').length, 1);
  assert.deepEqual(native.effects.map(e => e[0]), ['dialog', 'versions', 'open', 'write', 'sync', 'close', 'link', 'unlink']);
});

if (require.main === module) test('Run checks invalidates old callbacks synchronously before effect cleanup', async () => {
  const h = await harness(); h.render(); h.flush();
  const run = flatten(h.render()).find(n => n?.type === 'button' && flatten(n.props.children).includes('Run checks'));
  run.props.onClick(); h.render();
  h.doctorRequests[0]({ checks: [{ name: 'Node.js', ok: true }] }); await tick();
  await exportButton(h.render()).props.onClick();
  assert.equal(JSON.parse(h.calls.at(-1)[1]).checks.availability, 'unavailable');
});

if (require.main === module) test('actual Doctor stays busy until native no-clobber publication completes', async () => {
  const { nativeHarness } = require('./diagnostics-export.test.cjs');
  let release, arrived;
  const publication = new Promise(resolve => { arrived = resolve; });
  const native = await nativeHarness({ composed: true, beforeLink: () => { arrived(); return new Promise(resolve => { release = resolve; }); } });
  const h = await harness({ exportDiagnostics: native.preload.exportDiagnostics });
  h.render(); h.flush();
  const pending = exportButton(h.render()).props.onClick();
  await publication;
  assert.equal(notice(h.render()), 'Preparing diagnostics export…');
  assert.equal(exportButton(h.render()).props.disabled, true);
  assert.ok(!native.files.has(native.destination));
  release(); await pending;
  assert.equal(notice(h.render()), 'Diagnostics saved.');
  assert.ok(native.files.has(native.destination));
});

if (require.main === module) test('actual Doctor malformed zero and oversized represented collections show unavailable copy and finite unknown checks', async () => {
  for (const checks of [undefined, 'invalid', [], Array(33).fill({ name: 'Node.js', ok: true }), [null]]) {
    const h = await harness(); h.render(); h.flush();
    h.doctorRequests[0]({ checks }); await tick();
    const tree = h.render();
    await exportButton(tree).props.onClick();
    const request = JSON.parse(h.calls.at(-1)[1]);
    assert.ok(request.checks.entries.every(row => row.status === 'unknown'));
    if (checks?.length !== 1) {
      assert.equal(request.checks.availability, 'unavailable');
      assert.ok(flatten(tree).includes('Check statuses are unavailable. You can still export local versions and selected settings.'));
    }
    assert.equal(request.settings['editor.fontSize'], 14);
  }
});

if (require.main === module) test('actual Doctor suppresses foreign reports before effect cleanup for every raw owner field', async () => {
  for (const change of [{ id: 'different' }, { name: 'different' }, { kind: 'wsl' }, { host: 'FAKE.invalid' }, { host: 'fake.invalid ' }, { port: 22 }, { distro: 'fake' }, { root: '/synthetic/' }, { rigBinary: 'rig' }]) {
    const h = await harness(); h.render(); h.flush();
    h.doctorRequests[0]({ checks: [{ name: 'Node.js', ok: true }] }); await tick(); h.render();
    h.repoint(change);
    await exportButton(h.render()).props.onClick();
    const request = JSON.parse(h.calls.find(c => c[0] === 'export')[1]);
    assert.equal(request.checks.availability, 'unavailable');
    assert.equal(request.settings['terminal.scrollback'], 1001);
  }
});

if (require.main === module) test('actual Doctor ignores late report and export callbacks after repoint and unmount', async () => {
  let complete;
  const h = await harness({ exportDiagnostics: () => new Promise(resolve => { complete = resolve; }) });
  h.render(); h.flush();
  const pending = exportButton(h.render()).props.onClick();
  h.repoint({ root: '/other' }); h.render();
  h.doctorRequests[0]({ checks: [{ name: 'Node.js', ok: true }] }); await tick();
  complete({ status: 'saved' }); await pending;
  assert.equal(notice(h.render()), '');
  h.flush();
  const next = exportButton(h.render()).props.onClick();
  h.unmount(); complete({ status: 'saved' });
  h.doctorRequests.at(-1)({ checks: [] }); await next; await tick();
  assert.equal(h.lateUpdates, 0);
});

if (require.main === module) test('actual Doctor errors invalid results and cancellation clear busy and allow explicit retry', async () => {
  for (const result of [null, {}, { status: 'unexpected', error: 'SYNTHETIC_PRIVATE_CANARY' }, { status: 'error' }, 'reject', { status: 'canceled' }]) {
    let count = 0;
    const h = await harness({ exportDiagnostics: async () => {
      count++;
      if (count > 1) return { status: 'saved' };
      if (result === 'reject') throw Error('SYNTHETIC_PRIVATE_CANARY');
      return result;
    } });
    h.render(); h.flush();
    await exportButton(h.render()).props.onClick();
    const text = notice(h.render());
    assert.equal(text, result?.status === 'canceled' ? 'Export canceled. No file was saved.' : 'Could not save diagnostics. The destination may already exist, or the filesystem may not support this export. Try a new file name on a supported, writable filesystem.');
    assert.ok(!text.includes('SYNTHETIC_PRIVATE_CANARY'));
    assert.equal(exportButton(h.render()).props.disabled, false);
    await exportButton(h.render()).props.onClick();
    assert.equal(notice(h.render()), 'Diagnostics saved.');
    assert.equal(count, 2);
  }
});

if (require.main === module) test('actual Doctor unavailable states still export settings and Run checks keeps its explicit effect', async () => {
  const h = await harness(); let tree = h.render(); h.flush();
  await exportButton(tree).props.onClick();
  assert.equal(JSON.parse(h.calls.at(-1)[1]).checks.availability, 'unavailable');
  h.doctorRejects[0](Error('synthetic doctor failure')); await tick();
  await exportButton(h.render()).props.onClick();
  assert.equal(JSON.parse(h.calls.at(-1)[1]).checks.availability, 'unavailable');
  const run = flatten(h.render()).find(n => n?.type === 'button' && flatten(n.props.children).includes('Run checks'));
  run.props.onClick(); h.render(); h.flush();
  assert.equal(h.doctorRequests.length, 2);
  h.doctorRequests[1]({ checks: [{ name: 'tmux', ok: false }] }); await tick();
  await exportButton(h.render()).props.onClick();
  assert.equal(JSON.parse(h.calls.at(-1)[1]).checks.entries.find(row => row.name === 'tmux').status, 'failed');
});

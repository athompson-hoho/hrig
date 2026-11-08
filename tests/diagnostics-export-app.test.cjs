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
  const doctorRequests = [];
  const scope = {
    ...policy,
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
      doctor: connection => { calls.push(['doctor', connection]); return new Promise(resolve => doctorRequests.push(resolve)); },
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
    calls, doctorRequests, scope,
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

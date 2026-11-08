const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Extract actual expressions, never copied implementations. This fixture does
// not render the whole App or run Electron, IPC, disk writes or a process restart.
const source = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) {
    if (found) return;
    if (predicate(node)) { found = node; return; }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, 'actual App expression must exist');
  return found;
}
function evaluate(node, scope) {
  const context = vm.createContext({ ...scope });
  vm.runInContext(ts.transpileModule(`result = (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.result;
}
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: id => id === './seat-pins' ? pins : require(id) });
  return exports;
}
const pins = load('src/seat-pins.ts');
const helpers = { ...pins, ...load('src/seat-pods.ts') };
const { normalizeHistory } = load('src/project-history.ts');
const host = Object.freeze({ id: 'host', name: 'Host', kind: 'ssh', host: 'server', root: '~' });
const local = Object.freeze({ id: 'local', name: 'Local', kind: 'local', root: '~' });
const seat = Object.freeze({ id: 'rig:seat', rigId: 'rig', rigName: 'Rig', pod: 'Builders' });
const identity = '["host","ssh","server",null,null,null,"rigId","rig","Builders"]';
const callback = find(n => ts.isJsxAttribute(n) && n.name.text === 'onTogglePod').initializer.expression;
const variable = name => find(n => ts.isVariableDeclaration(n) && n.name.getText(source) === name).initializer;
const boot = find(n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
  n.expression.name.text === 'then' && n.expression.expression.getText(source).startsWith('Promise.all(')).arguments[0];
const effect = method => find(n => ts.isCallExpression(n) && n.expression.getText(source) === 'useEffect' &&
  n.arguments[0].getText(source).includes(`window.hrig.${method}(`) &&
  (method !== 'flushState' || n.arguments[0].getText(source).includes('"beforeunload"'))).arguments[0];
function propsFor(state, ownerKey, setState) {
  const scope = { ...helpers, state, local, inventoryHealth: { current: { key: ownerKey } }, setState };
  scope.connection = evaluate(variable('connection'), scope);
  scope.pinOwner = evaluate(variable('pinOwner'), scope);
  scope.pinsAvailable = evaluate(variable('pinsAvailable'), scope);
  scope.podsAvailable = evaluate(variable('podsAvailable'), scope);
  return { podsAvailable: scope.podsAvailable,
    onTogglePod: evaluate(callback, scope) };
}
function workspace(extra = {}) {
  return { version: 1, connections: [host], activeConnection: host.id,
    roots: {}, activeRig: '', layouts: {}, savedLayouts: [], ...extra };
}

test('actual App callback uses latest functional state and preserves unrelated edits and queued pods', () => {
  let state = workspace();
  const queued = [];
  const props = propsFor(state, '["host","ssh","server",null,null,null]', update => queued.push(update));
  assert.equal(props.podsAvailable, true);
  props.onTogglePod(seat);
  props.onTogglePod({ id: 'rig:second', rigId: 'rig', pod: 'Other' });
  state = { ...state, sidebarWidth: 400, roots: { host: '/changed' } };
  for (const update of queued) state = update(state);
  assert.deepEqual(Array.from(state.collapsedPods), [identity,
    '["host","ssh","server",null,null,null,"rigId","rig","Other"]']);
  assert.equal(state.sidebarWidth, 400);
  assert.deepEqual(state.roots, { host: '/changed' });
  const expand = propsFor(state, helpers.pinConnectionIdentity(host), update => { state = update(state); });
  expand.onTogglePod(seat);
  assert.deepEqual(Array.from(state.collapsedPods), ['["host","ssh","server",null,null,null,"rigId","rig","Other"]']);
});

test('actual App rejects old inventory ownership and obsolete active-host or repointed callbacks', () => {
  const initial = workspace();
  const queued = [];
  const foreign = propsFor(initial, helpers.pinConnectionIdentity(local), update => queued.push(update));
  assert.equal(foreign.podsAvailable, false);
  foreign.onTogglePod(seat);
  assert.equal(queued.length, 0);
  const owned = propsFor(initial, helpers.pinConnectionIdentity(host), update => queued.push(update));
  owned.onTogglePod(seat);
  for (const latest of [workspace({ connections: [local, host], activeConnection: local.id }),
    workspace({ connections: [{ ...host, host: 'elsewhere' }] }),
    workspace({ connections: [{ ...host, rigBinary: '/other/rig' }] })]) {
    assert.equal(queued[0](latest), latest, 'reject by original state identity');
  }
  const renamed = workspace({ connections: [{ ...host, root: '/new', name: 'Renamed' }] });
  assert.deepEqual(Array.from(queued[0](renamed).collapsedPods), [identity]);
});

test('actual boot callback normalizes legacy malformed and mixed pods alongside existing state', () => {
  for (const pins of [undefined, null, {}, ['bad', identity, identity]]) {
    let state;
    let loaded = false;
    const saved = workspace({ collapsedPods: pins, sidebarWidth: 310, preferences: { 'editor.fontSize': 17 } });
    const run = evaluate(boot, { ...helpers, normalizeHistory,
      defaultState: workspace(), setDetected() {}, setState(value) { state = value; },
      setLoaded(value) { loaded = value; }, log() {} });
    run([saved, [local]]);
    assert.equal(loaded, true);
    assert.deepEqual(Array.from(state.collapsedPods), Array.isArray(pins) ? [identity] : []);
    assert.deepEqual(Array.from(state.projectHistory), []);
    assert.equal(state.sidebarWidth, 310);
    assert.equal(state.preferences, saved.preferences);
    assert.equal(state.connections[1], local);
    assert.equal(saved.collapsedPods, pins);
  }
});

test('actual queued App callback rejects every changed identity slot and resolves fallback owners', () => {
  const queued = [];
  const initial = workspace();
  propsFor(initial, helpers.pinConnectionIdentity(host), update => queued.push(update))
    .onTogglePod(seat);
  for (const change of [{ id: 'new-id' }, { kind: 'wsl' }, { host: 'other' },
    { port: 22 }, { distro: 'Ubuntu' }, { rigBinary: '/other' }]) {
    const latest = workspace({ connections: [{ ...host, ...change }] });
    assert.equal(queued[0](latest), latest);
  }
  const fallback = workspace({ activeConnection: 'missing' });
  assert.deepEqual(Array.from(queued[0](fallback).collapsedPods), [identity]);
  const empty = workspace({ connections: [], activeConnection: 'missing' });
  assert.equal(queued[0](empty), empty, 'local fallback cannot inherit the old SSH pod');
  let state = initial;
  const update = propsFor(initial, helpers.pinConnectionIdentity(host), fn => { state = fn(state); });
  update.onTogglePod(seat);
  update.onTogglePod(seat);
  assert.deepEqual(Array.from(state.collapsedPods), [], 'reused callback reads latest membership');
});

test('actual debounced save and beforeunload flush carry full latest workspace and preserve errors', async () => {
  const state = workspace({ collapsedPods: [identity], sidebarWidth: 410 });
  const saves = [], timers = [], cleared = [], toasts = [], logs = [], flushes = [];
  const save = evaluate(effect('saveState'), { state, loaded: true,
    window: { hrig: { saveState(value) { saves.push(value); return Promise.reject(new Error('disk full')); } } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return 7; },
    clearTimeout(id) { cleared.push(id); }, setToast(value) { toasts.push(value); },
    log(...args) { logs.push(args); } });
  const cleanup = save();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 350);
  await timers[0].fn();
  assert.equal(saves[0], state);
  assert.deepEqual(toasts, ['Could not save workspace: disk full']);
  assert.deepEqual(logs, [['disk full', 'error']]);
  cleanup();
  assert.deepEqual(cleared, [7]);
  let handler, removed;
  const stateRef = { current: state };
  const flush = evaluate(effect('flushState'), { stateRef, getDirtyBuffers: () => [],
    window: { hrig: { flushState(value) { flushes.push(value); } },
      addEventListener(name, fn) { assert.equal(name, 'beforeunload'); handler = fn; },
      removeEventListener(name, fn) { removed = fn; } } });
  const remove = flush();
  stateRef.current = { ...state, collapsedPods: [], activeRig: 'changed' };
  handler({ preventDefault() { assert.fail('clean buffers must not block shutdown'); } });
  assert.equal(flushes[0], stateRef.current);
  assert.deepEqual(flushes[0].collapsedPods, []);
  remove();
  assert.equal(removed, handler);
});

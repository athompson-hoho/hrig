const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Model, Actions, DockLocation, TabNode } = require('flexlayout-react');
const { webcrypto } = require('node:crypto');

// Execute production functions/callbacks. Only UI owners and host operations are
// inert; policy and installed model constructors/actions remain real.
function evaluate(source, scope = {}) {
  const context = vm.createContext({ result: undefined, exports: {}, structuredClone, crypto: webcrypto, ...scope });
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context.result;
}
const policy = evaluate(fs.readFileSync('src/layout.ts', 'utf8') + '\nresult = exports;', {
  require(id) { assert.equal(id, 'flexlayout-react'); return { Model }; },
});
const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function unique(predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(app);
  assert.equal(found.length, 1, 'actual App seam must be unique');
  return found[0];
}
function callback(name, scope) {
  const node = unique(n => ts.isVariableDeclaration(n) && n.name.getText(app) === name);
  return evaluate(`result = (${node.initializer.getText(app)});`, { ...policy, ...scope });
}
const plain = value => JSON.parse(JSON.stringify(value));
function tab(id, component = 'editor') {
  return { type: 'tab', id, name: `界 e\u0301 ${id}`, component, enableRenderOnDemand: false,
    config: { path: '🧪/e\u0301.ts', connection: { id: 'synthetic', kind: 'local', name: 'Fixture' }, root: '.',
      decoy: { type: 'tab', component: 'settings', enableRenderOnDemand: false } } };
}
function fixture() {
  return { global: { tabEnableRenderOnDemand: false }, layout: { type: 'row', children: [
    { type: 'tabset', id: 'main', selected: 0, children: [tab('welcome', 'welcome'), tab('edit'), tab('term', 'terminal')] },
  ] } };
}
function optionalPolicy(model) {
  const nodes = [];
  model.visitNodes(node => { if (node instanceof TabNode) nodes.push(node); });
  assert.ok(nodes.length > 0, 'nonvacuous installed model');
  for (const node of nodes) {
    if (['editor', 'diff', 'settings'].includes(node.getComponent()))
      assert.equal(node.isEnableRenderOnDemand(), true, `${node.getId()} must defer first activation`);
    if (node.getComponent() === 'terminal') assert.equal(node.isEnableRenderOnDemand(), false);
  }
}

test('normalizer positive controls preserve exact keys Unicode config decoys immutability and idempotence', () => {
  const json = fixture();
  for (const key of ['diff', 'settings', 'Editor', 'editor ', 'settings\u200b', 'ｅditor'])
    json.layout.children[0].children.push(tab(key, key));
  const before = JSON.stringify(json);
  const normalized = policy.normalizeOptionalPanels(json);
  assert.equal(JSON.stringify(json), before);
  assert.deepEqual(plain(policy.normalizeOptionalPanels(normalized)), plain(normalized));
  for (const item of normalized.layout.children[0].children) {
    const original = json.layout.children[0].children.find(t => t.id === item.id);
    assert.deepEqual(plain(item.config), original.config);
    assert.equal(item.config, original.config, 'config ownership stays shared');
    assert.equal(item.name, original.name);
    assert.equal(item.enableRenderOnDemand, ['editor', 'diff', 'settings'].includes(item.component));
  }
  optionalPolicy(policy.restoreModel(json));
});

test('normalizer positive controls traverse borders subLayouts and legacy popouts only at schema nodes', () => {
  const json = fixture();
  json.borders = [{ type: 'border', location: 'left', children: [tab('border', 'settings')] }];
  const sub = id => ({ layout: { type: 'row', children: [{ type: 'tabset', children: [tab(id, 'diff')] }] },
    rect: { x: 0, y: 0, width: 600, height: 400 } });
  json.subLayouts = { '浮動': sub('sub') };
  json.popouts = { legacy: sub('pop') };
  const before = JSON.stringify(json);
  const result = policy.normalizeOptionalPanels(json);
  assert.equal(result.borders[0].children[0].enableRenderOnDemand, true);
  assert.equal(result.subLayouts['浮動'].layout.children[0].children[0].enableRenderOnDemand, true);
  assert.equal(result.popouts.legacy.layout.children[0].children[0].enableRenderOnDemand, true);
  assert.equal(JSON.stringify(json), before);
  assert.deepEqual(plain(policy.normalizeOptionalPanels(result)), plain(result));
  assert.deepEqual(plain(result.subLayouts['浮動'].rect), json.subLayouts['浮動'].rect);
});

test('initial null invalid fallback empty optional-free and one-tab restoration retain existing behavior', () => {
  for (const input of [undefined, null, {}, { layout: null }]) {
    const model = policy.restoreModel(input);
    assert.equal(model.getNodeById('welcome').getComponent(), 'welcome');
    assert.equal(model.toJson().global.tabEnableRenderOnDemand, false);
  }
  assert.equal(policy.initialModel().getNodeById('welcome').getComponent(), 'welcome');
  const empty = policy.restoreModel({ layout: { type: 'row', children: [] } });
  assert.ok(empty instanceof Model);
  for (const component of ['welcome', 'editor', 'terminal']) {
    const json = fixture();
    json.layout.children[0].children = [tab('one', component)];
    const model = policy.restoreModel(json);
    assert.equal(model.getNodeById('one').getComponent(), component);
    optionalPolicy(model);
  }
  assert.equal(policy.arrangement([], 'Focus').getNodeById('welcome').getComponent(), 'welcome');
});

for (const preset of ['Focus', 'Review', 'Team']) test(`actual ${preset} arrangement constructors normalize cloned saved optional tabs`, () => {
  const tabs = [tab('edit'), tab('term', 'terminal'), tab('settings', 'settings'), tab('diff', 'diff')];
  const before = JSON.stringify(tabs);
  optionalPolicy(policy.arrangement(tabs, preset));
  assert.equal(JSON.stringify(tabs), before);
});

for (const direction of ['undo', 'redo']) test(`actual App ${direction} callback normalizes input and retains previous-model constructor argument`, () => {
  const json = fixture(), model = policy.restoreModel(fixture());
  const history = { current: { past: direction === 'undo' ? [json] : [], future: direction === 'redo' ? [json] : [] } };
  const calls = [], selected = [], changed = [];
  callback('travel', { model, history,
    Model: { fromJson(...args) { calls.push(args); return Model.fromJson(...args); } },
    setModel(next) { selected.push(next); }, modelChanged(next) { changed.push(next); },
  })(direction);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], model, 'previous-model identity reuse remains connected');
  assert.equal(calls[0][0].layout.children[0].children[1].enableRenderOnDemand, true,
    'constructor input must be normalized before installed model identity reuse');
  assert.equal(json.layout.children[0].children[1].enableRenderOnDemand, false);
  assert.equal(selected[0], changed[0]);
  optionalPolicy(selected[0]);
});

for (const route of ['active', 'action', 'no-tabset']) test(`actual addPanel ${route} route applies optional policy before handing off new tab`, () => {
  const model = route === 'no-tabset'
    ? Model.fromJson({ layout: { type: 'row', children: [] }, global: { tabEnableRenderOnDemand: false } })
    : policy.restoreModel(fixture());
  // Flexlayout inserts an empty tabset itself. Inject only the absent-tabset
  // lookup to reach App's fallback; the callback and fallback Model stay real.
  if (route === 'no-tabset') model.getFirstTabSet = () => undefined;
  const handed = [], selected = [];
  callback('addPanel', { model, Actions, DockLocation, uid: () => 'fixture-id', root: '.',
    connection: { id: 'synthetic', name: 'Fixture' }, history: { current: {} },
    layout: { current: { addTabToActiveTabSet(t) { handed.push(t); return route === 'active'; } } },
    Model, setModel(next) { selected.push(next); }, modelChanged() {}, setRecentPanels(fn) { fn([]); }, setModal() {}, log() {},
  })('settings', 'Settings', {}, 'settings');
  assert.equal(handed.length, 1);
  assert.equal(handed[0].enableRenderOnDemand, true, 'active-tabset API must receive a deferred optional tab');
  if (route === 'action') optionalPolicy(model);
  if (route === 'no-tabset') { assert.equal(selected.length, 1); optionalPolicy(selected[0]); }
});

test('actual addPanel existing-tab route only selects without constructing or resetting history', () => {
  const model = policy.restoreModel(fixture()), history = { current: { past: ['retained'], future: [] } };
  callback('addPanel', { model, Actions, history, modelChanged() {} })('editor', 'Editor', {}, 'edit');
  assert.equal(model.getNodeById('edit').isSelected(), true);
  assert.deepEqual(history.current.past, ['retained']);
});

test('actual saved-layout onClick executes restoreModel policy and owner callbacks', () => {
  const saved = { model: fixture(), name: 'synthetic saved' }, selected = [], changed = [];
  const node = unique(n => ts.isJsxAttribute(n) && n.name.getText(app) === 'onClick' && n.getText(app).includes('restoreModel(saved.model)'));
  const fn = evaluate(`result = (${node.initializer.expression.getText(app)});`, { ...policy, saved,
    protect: run => run(), setModel: next => selected.push(next), modelChanged: next => changed.push(next), setMenu() {}, notify() {},
  });
  fn();
  assert.equal(selected.length, 1);
  assert.equal(selected[0], changed[0]);
  optionalPolicy(selected[0]);
});

test('actual role-template callback restores after real role substitution', () => {
  const selected = [], changed = [], json = fixture();
  json.layout.children[0].children.push({ ...tab('role', 'terminal'), config: { role: 'builder' } });
  const before = JSON.stringify(json);
  const node = unique(n => ts.isJsxAttribute(n) && n.name.getText(app) === 'onApplyTemplate');
  evaluate(`result = (${node.initializer.expression.getText(app)});`, { ...policy, state: { activeRig: 'synthetic' },
    connection: { id: 'synthetic', name: 'Fixture' }, root: '.',
    seats: [{ id: 'builder', name: 'builder', session: 'synthetic-session' }],
    protect: run => run(), remember() {}, notify() {}, setModel: next => selected.push(next), modelChanged: next => changed.push(next),
  })({ model: json });
  assert.equal(selected.length, 1);
  assert.equal(selected[0], changed[0]);
  optionalPolicy(selected[0]);
  assert.equal(selected[0].getNodeById('seat:synthetic:builder').getComponent(), 'terminal');
  assert.equal(JSON.stringify(json), before);
});

for (const name of ['applyPreset', 'openAll']) test(`actual App ${name} retains arrangement constructor link`, () => {
  const selected = [], changed = [], tabs = [tab('edit'), tab('term', 'terminal')];
  callback(name, { allTabs: () => tabs, remember() {}, seats: [], connection: { id: 'synthetic' }, root: '.',
    setModel: next => selected.push(next), modelChanged: next => changed.push(next), setMenu() {}, notify() {},
  })('Focus');
  assert.equal(selected.length, 1);
  assert.equal(selected[0], changed[0]);
  optionalPolicy(selected[0]);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Model, TabNode, TabSetNode, BorderNode, Actions, Rect } = require('flexlayout-react');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

// Actual production AST seams and installed controller decisions, with inert
// module exports and portal targets. This is not ReactDOM/native evidence.
function parse(file, kind = ts.ScriptKind.TSX) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}
function unique(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  assert.equal(found.length, 1, 'production AST seam must be unique');
  return found[0];
}
function evaluate(text, scope) {
  const context = vm.createContext({ result: undefined, ...scope });
  vm.runInContext(ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context.result;
}
function expression(root, node, scope) {
  return evaluate(`result = (${node.getText(root)});`, scope);
}
function fixture(selected) {
  const config = { connection: { id: 'synthetic', name: 'Fixture', kind: 'local', root: '.' }, root: '.', path: 'fixture.ts' };
  return { global: { tabEnableRenderOnDemand: false }, layout: { type: 'row', children: [{
    type: 'tabset', id: 'main', selected, children: [
      { type: 'tab', id: 'welcome', component: 'welcome' },
      { type: 'tab', id: 'editor', component: 'editor', enableRenderOnDemand: false, config },
      { type: 'tab', id: 'terminal', component: 'terminal', config },
    ],
  }] } };
}
function harness(selected, options = {}) {
  const events = [], propsSeen = [];
  const app = parse('src/App.tsx');
  const layoutSource = fs.readFileSync('src/layout.ts', 'utf8');
  const layout = evaluate(`${layoutSource}\nresult = exports;`, {
    exports: {}, require(id) {
      assert.equal(id, 'flexlayout-react', 'layout dependency is allowlisted');
      return { Model };
    },
  });
  const json = fixture(selected);
  options.configure?.(json);
  let model = layout.restoreModel(json);
  let React, DeferredPanel, buffers;
  const mounts = [], cleanups = [];
  const ui = mountComponent(null, null, { content: [] }, {
    actualComponents: true,
    dependencies: { './drafts': { draftKey: () => 'fixture', draftOperation: () => { throw new Error('owner operation forbidden'); } } },
    imports: { './EditorPanel': () => {
      events.push('editor-module-evaluation');
      const inertEditor = props => {
        const token = React.useRef({});
        const [local, setLocal] = React.useState('initial');
        React.useEffect(() => { mounts.push({ id: props.id, token: token.current }); return () => cleanups.push(props.id); }, []);
        propsSeen.push(props);
        return React.createElement('button', { 'data-editor': props.id, onClick: () => setLocal('edited') }, local);
      };
      return options.importModule ? options.importModule({ default: inertEditor }, events) : { default: inertEditor };
    } },
    root(env) {
      React = env.react;
      DeferredPanel = env.load('src/DeferredPanel.tsx').default;
      buffers = env.load('src/editor-buffers.ts').buffers;
      return props => props.content;
    },
  });
  const factoryNode = unique(app, n => ts.isVariableDeclaration(n) && n.name.getText(app) === 'factory');
  const scope = {
    React, DeferredPanel, SettingsPage: 'settings', Loading: 'loading',
    TerminalPanel: props => { events.push('terminal-mount'); propsSeen.push(props); return null; },
    Welcome: () => null, openConnect() {}, openProject() {}, openShell() {}, openAll() {}, seats: [],
    connection: fixture(0).layout.children[0].children[1].config.connection,
    inventory: null, freshSeats: () => [], markDirty() {}, setFileRevision() {}, notify() {},
    pendingFileFocus: { current: null }, modalRef: { current: null }, modelRef: { current: model },
  };
  const factory = expression(app, factoryNode.initializer, scope);
  const wrapper = unique(app, n => ts.isJsxAttribute(n) && n.name.getText(app) === 'factory');
  const wrappedFactory = expression(app, wrapper.initializer.expression, { React, factory });
  const installed = parse('node_modules/flexlayout-react/dist/index.js', ts.ScriptKind.JS);
  const renderer = unique(installed, n => ts.isVariableDeclaration(n) && n.name.getText(installed) === 'TabContentRenderer');
  const jsx = (type, props, key) => ({ type, props, key });
  const TabContentRenderer = expression(installed, renderer.initializer, {
    React: { memo: value => value }, jsx, ErrorBoundary: 'boundary',
    I18nLabel: { Error_rendering_component: 'error', Error_rendering_component_retry: 'retry' },
    arePropsEqual$1() {},
  });
  const method = unique(installed, n => ts.isMethodDeclaration(n) && n.name.getText(installed) === 'renderTabContents');
  const renderTabContents = evaluate(`result = ({ ${method.getText(installed)} }).renderTabContents;`, {
    TabNode, jsx, TabContentRenderer, createPortal: child => child,
  });
  model.visitNodes(node => {
    if (node instanceof TabNode) {
      // Geometry and DOM alone are synthetic; policy/selection are real nodes.
      node.getTabContainer().getContentRect = () => new Rect(0, 0, 600, 400);
      node.setMoveableElement({ style: {} });
    }
  });
  const controller = {
    _props: { model }, _state: { fullRedrawRevision: 0 },
    getFactory: () => wrappedFactory, i18nName: value => value,
  };
  const positionMethod = unique(installed, n => ts.isMethodDeclaration(n) && n.name.getText(installed) === 'positionTabPanels');
  const position = evaluate(`result = ({ ${positionMethod.getText(installed)} }).positionTabPanels;`, { TabSetNode, BorderNode });
  const positionPanels = () => {
    controller._tabPanels = new Map();
    model.visitNodes(node => { if (node instanceof TabNode) controller._tabPanels.set(node.getId(), { node, element: { style: {} } }); });
    position.call(controller);
    ui.flush();
  };
  return {
    events, propsSeen, get model() { return model; }, ui, buffers, mounts, cleanups, scope,
    positionPanels,
    replaceModel() {
      model = layout.restoreModel(json);
      model.visitNodes(node => { if (node instanceof TabNode) {
        node.getTabContainer().getContentRect = () => new Rect(0, 0, 600, 400);
        node.setMoveableElement({ style: {} });
      } });
      controller._props.model = model;
      scope.modelRef.current = model;
    },
    async render() {
      positionPanels();
      const portals = renderTabContents.call(controller);
      ui.update({ content: [...portals.values()] });
      await ui.settle();
      return portals;
    },
  };
}

test('restored hidden editor with saved false never evaluates its optional module', async () => {
  const h = harness(0);
  const portals = await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 0,
    'unopened hidden editor must not evaluate its literal import');
  assert.equal(portals.has('editor'), false, 'unopened editor has no content portal');
});

test('visible restored editor evaluates the literal import and receives actual factory props', async () => {
  const h = harness(1);
  await h.render();
  await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1);
  const editor = h.propsSeen.find(props => props.id === 'editor');
  assert.ok(editor, 'resolved editor export is consumed');
  assert.equal(editor.config, h.model.getNodeById('editor').getConfig());
  assert.equal(editor.diff, false);
  assert.equal(typeof editor.onReady, 'function');
  assert.equal(typeof editor.onDirty, 'function');
  assert.equal(typeof editor.onSaved, 'function');
  assert.equal(editor.onReady('editor'), false, 'pending focus guard stays authoritative');
});

test('hidden terminal remains rendered under the existing background policy', async () => {
  const h = harness(0);
  const portals = await h.render();
  assert.equal(portals.has('terminal'), true);
  assert.ok(h.events.includes('terminal-mount'), 'actual terminal factory branch is consumed');
  assert.equal(h.model.getNodeById('terminal').isEnableRenderOnDemand(), false);
  h.model.doAction(Actions.selectTab('editor'));
  await h.render();
  assert.equal(h.model.getNodeById('terminal').isRendered(), true);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const button = h => h.ui.nodes().find(n => n.type === 'button' && h.ui.text(n) === 'Retry');
const editorButton = (h, id = 'editor') => h.ui.nodes().find(n => n.props['data-editor'] === id);
const roles = (h, role) => h.ui.nodes().filter(n => n.props.role === role);
const text = h => h.ui.nodes().filter(n => !n.parentElement).map(n => h.ui.text(n)).join('');

test('actual selection then hide and revisit retains component local state and shared dirty buffer object', async () => {
  const h = harness(0);
  const dirty = { content: 'unsaved fixture', saved: 'saved fixture', revision: 'r1' };
  h.buffers.set('editor', dirty);
  await h.render();
  h.model.doAction(Actions.selectTab('editor'));
  await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1);
  h.ui.event(editorButton(h), 'onClick');
  const mounted = h.mounts.find(m => m.id === 'editor');
  h.model.doAction(Actions.selectTab('welcome'));
  const hidden = await h.render();
  assert.equal(hidden.has('editor'), true, 'installed controller retains rendered portal');
  assert.equal(h.ui.text(editorButton(h)), 'edited');
  h.model.doAction(Actions.selectTab('editor'));
  await h.render();
  assert.equal(h.ui.text(editorButton(h)), 'edited');
  assert.equal(h.mounts.filter(m => m.id === 'editor').length, 1);
  assert.equal(h.mounts.find(m => m.id === 'editor').token, mounted.token);
  assert.equal(h.buffers.get('editor'), dirty);
  assert.deepEqual(h.cleanups, []);
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1);
});

test('transient import rejection is fixed local error and explicit Retry alone reattempts once', async () => {
  const h = harness(1, { importModule(module, events) {
    if (events.filter(e => e === 'editor-module-evaluation').length === 1) throw new Error('synthetic-private-path-url-stack');
    return module;
  } });
  await h.render();
  assert.equal(roles(h, 'alert').length, 1);
  assert.match(text(h), /Could not open the editor\. Select Retry to try again\./);
  assert.doesNotMatch(text(h), /synthetic-private/);
  assert.equal(h.ui.nodes().find(n => n.props.className === 'deferred-panel').props['aria-busy'], false);
  assert.equal(button(h).props.type, 'button');
  h.model.doAction(Actions.selectTab('welcome'));
  await h.render();
  assert.equal(roles(h, 'alert').length, 0);
  h.model.doAction(Actions.selectTab('editor'));
  await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1);
  const retry = button(h);
  h.ui.event(retry, 'onClick');
  h.ui.event(retry, 'onClick'); // captured rapid second activation cannot overlap
  assert.equal(button(h), undefined);
  assert.equal(roles(h, 'status').length, 1);
  assert.equal(roles(h, 'status')[0].props['aria-live'], 'polite');
  assert.equal(roles(h, 'status')[0].props['aria-atomic'], 'true');
  await h.ui.settle();
  assert.ok(editorButton(h));
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 2);
  assert.equal(roles(h, 'alert').length, 0);
});

test('permanent failure stays local after repeated explicit retry without an automatic loop', async () => {
  const h = harness(1, { importModule() { return Promise.reject({ private: 'synthetic-private-marker' }); } });
  await h.render();
  for (let i = 0; i < 2; i++) {
    assert.ok(button(h));
    h.ui.event(button(h), 'onClick');
    await h.ui.settle();
    assert.equal(roles(h, 'alert').length, 1);
    assert.doesNotMatch(text(h), /synthetic-private-marker/);
  }
  await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 3);
  assert.equal(h.mounts.length, 0);
  assert.ok(h.events.includes('terminal-mount'));
});

test('concurrent editor and diff share import while retrying a failed sibling preserves healthy local state', async () => {
  const first = deferred();
  let success;
  const h = harness(1, {
    configure(json) {
      const editor = json.layout.children[0].children[1];
      json.layout.children.push({ type: 'tabset', id: 'second', children: [{ ...editor, id: 'diff', component: 'diff' }] });
    },
    importModule(module, events) {
      success = module;
      return events.filter(e => e === 'editor-module-evaluation').length === 1 ? first.promise : module;
    },
  });
  const dirty = { content: 'dirty', saved: '', revision: 'r' };
  h.buffers.set('editor', dirty);
  await h.render();
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1, 'concurrent editor/diff import deduplicates');
  assert.equal(roles(h, 'status').length, 2);
  first.reject(new Error('synthetic-private'));
  await h.ui.settle();
  assert.equal(roles(h, 'alert').length, 2);
  const retries = h.ui.nodes().filter(n => n.type === 'button' && h.ui.text(n) === 'Retry');
  h.ui.event(retries[1], 'onClick');
  await h.ui.settle();
  assert.ok(editorButton(h, 'diff'));
  assert.equal(roles(h, 'alert').length, 1, 'healthy sibling does not reset failed sibling');
  h.ui.event(editorButton(h, 'diff'), 'onClick');
  const token = h.mounts.find(m => m.id === 'diff').token;
  h.ui.event(button(h), 'onClick');
  await h.ui.settle();
  assert.ok(editorButton(h));
  assert.equal(h.ui.text(editorButton(h, 'diff')), 'edited');
  assert.equal(h.mounts.find(m => m.id === 'diff').token, token);
  assert.equal(h.mounts.filter(m => m.id === 'diff').length, 1);
  assert.deepEqual(h.cleanups, []);
  assert.equal(h.buffers.get('editor'), dirty);
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 2, 'fulfilled registry module reused on local retry');
  assert.equal(h.propsSeen.find(p => p.id === 'diff').diff, true);
  assert.ok(success);
});

for (const outcome of ['resolve', 'reject']) test(`hidden pending ${outcome} is silent and retained without selecting or focusing`, async () => {
  const pending = deferred();
  let exported;
  const h = harness(1, { importModule(module) { exported = module; return pending.promise; } });
  await h.render();
  assert.equal(roles(h, 'status').length, 1);
  h.model.doAction(Actions.selectTab('welcome'));
  h.positionPanels(); // hidden factory can remain memoized by the installed renderer
  assert.equal(roles(h, 'status').length, 0);
  const focus = { synthetic: 'outside' };
  h.ui.document.activeElement = focus;
  pending[outcome](outcome === 'resolve' ? exported : new Error('synthetic-private'));
  await h.ui.settle();
  assert.equal(roles(h, 'alert').length, 0);
  assert.equal(roles(h, 'status').length, 0);
  assert.equal(h.ui.document.activeElement, focus);
  assert.equal(h.model.getNodeById('welcome').isSelected(), true);
  h.model.doAction(Actions.selectTab('editor'));
  await h.render();
  assert.equal(outcome === 'resolve' ? !!editorButton(h) : !!button(h), true);
  assert.equal(h.events.filter(e => e === 'editor-module-evaluation').length, 1);
});

test('superseded node ignores its pending completion while the current consumer settles once', async () => {
  const pending = deferred();
  let exported;
  const h = harness(1, { importModule(module) { exported = module; return pending.promise; } });
  await h.render();
  const previous = h.model.getNodeById('editor');
  h.replaceModel();
  await h.render();
  assert.notEqual(h.model.getNodeById('editor'), previous);
  const before = h.ui.observations.stateUpdates;
  pending.resolve(exported);
  await h.ui.settle();
  assert.equal(h.ui.observations.stateUpdates - before, 1, 'only current attempt updates');
  assert.equal(h.mounts.filter(m => m.id === 'editor').length, 1);
  assert.equal(h.propsSeen.find(p => p.id === 'editor').config, h.model.getNodeById('editor').getConfig());
  previous.setVisible(false);
  h.ui.flush();
  assert.equal(h.ui.observations.stateUpdates - before, 1, 'superseded node listener removed');
});

for (const outcome of ['resolve', 'reject']) test(`closed pending ${outcome} cannot update disposed adapter or clean shared buffers`, async () => {
  const pending = deferred();
  let exported;
  const h = harness(1, { importModule(module) { exported = module; return pending.promise; } });
  const dirty = { content: 'unsaved', saved: '', revision: 'r' };
  h.buffers.set('editor', dirty);
  await h.render();
  h.model.doAction(Actions.deleteTab('editor'));
  await h.render();
  const updates = h.ui.observations.stateUpdates;
  pending[outcome](outcome === 'resolve' ? exported : new Error('synthetic-private'));
  await h.ui.settle();
  assert.equal(h.ui.observations.stateUpdates, updates);
  assert.equal(h.model.getNodeById('editor'), undefined);
  assert.equal(h.buffers.get('editor'), dirty, 'loader never owns explicit close cleanup');
  assert.equal(h.mounts.length, 0);
  assert.equal(roles(h, 'alert').length, 0);
});

test('Retry focus handoff stays in its visible wrapper and respects moved focus', async () => {
  const h = harness(1, { importModule() { throw new Error('fixture'); } });
  await h.render();
  const retry = button(h);
  retry.focus();
  h.ui.event(retry, 'onClick');
  assert.equal(h.ui.document.activeElement.props['data-panel-id'], 'editor');
  await h.ui.settle();
  const outside = { synthetic: 'outside' };
  h.ui.document.activeElement = outside;
  h.ui.event(button(h), 'onClick');
  assert.equal(h.ui.document.activeElement, outside);
  await h.ui.settle();
  h.model.doAction(Actions.selectTab('welcome'));
  await h.render();
  const count = h.events.length;
  h.ui.event(button(h), 'onClick');
  await h.ui.settle();
  assert.equal(h.events.length, count, 'hidden retry cannot request or move focus');
  assert.equal(h.ui.document.activeElement, outside);
});

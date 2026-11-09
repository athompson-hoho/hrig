const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { Model, TabNode, Actions } = require('flexlayout-react');

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
function harness(selected) {
  const events = [], propsSeen = [];
  const app = parse('src/App.tsx');
  const layoutSource = fs.readFileSync('src/layout.ts', 'utf8');
  const layout = evaluate(`${layoutSource}\nresult = exports;`, {
    exports: {}, require(id) {
      assert.equal(id, 'flexlayout-react', 'layout dependency is allowlisted');
      return { Model };
    },
  });
  const model = layout.restoreModel(fixture(selected));
  const inertEditor = props => { propsSeen.push(props); return null; };
  const lazyInitializer = unique(app, n => ts.isVariableDeclaration(n) && n.name.getText(app) === 'EditorPanel').initializer;
  const EditorPanel = expression(app, lazyInitializer, {
    lazy: React.lazy,
    require(id) {
      assert.equal(id, './EditorPanel', 'literal dynamic import dependency is allowlisted');
      events.push('editor-module-evaluation');
      return { default: inertEditor };
    },
  });
  const factoryNode = unique(app, n => ts.isVariableDeclaration(n) && n.name.getText(app) === 'factory');
  const scope = {
    React, EditorPanel, Suspense: React.Suspense, Loading: 'loading',
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
      node.getTabContainer().getContentRect = () => ({ width: 600, height: 400 });
      node.setMoveableElement({ style: {} });
    }
  });
  const controller = {
    _props: { model }, _state: { fullRedrawRevision: 0 },
    getFactory: () => wrappedFactory, i18nName: value => value,
  };
  function consume(value) {
    if (Array.isArray(value)) { value.forEach(consume); return; }
    if (!value || typeof value !== 'object') return;
    if (value.type?.$$typeof === Symbol.for('react.lazy')) {
      try {
        const Component = value.type._init(value.type._payload);
        consume(Component(value.props));
      } catch (pending) {
        if (!pending || typeof pending.then !== 'function') throw pending;
        pending.catch(() => {});
      }
    } else if (typeof value.type === 'function') consume(value.type(value.props));
    else consume(value.props?.children);
  }
  return {
    events, propsSeen, model,
    async render() {
      const portals = renderTabContents.call(controller);
      for (const portal of portals.values()) consume(portal);
      for (let i = 0; i < 8; i++) await Promise.resolve();
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

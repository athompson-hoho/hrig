const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Model, Actions } = require('flexlayout-react');
const helperModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/file-tree.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: helperModule.exports });
const { fileTreeOwner } = helperModule.exports;

// Execute the existing App JSX and callbacks; never require a prospective prop
// declaration. An absent activeFile is observable data for the RED assertion.
const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function unique(predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.equal(found.length, 1, 'existing App AST seam must be unique');
  return found[0];
}
function evaluate(node, scope) {
  const context = vm.createContext({ ...scope });
  vm.runInContext(ts.transpileModule(`result = (${node.getText(app)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context.result;
}
const sidebar = unique(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(app) === 'Sidebar');
const openFile = unique(n => ts.isVariableDeclaration(n) && n.name.getText(app) === 'openFile').initializer;

function appFixture(component = 'editor') {
  const connection = Object.freeze({ id: 'fixture', kind: 'ssh', name: 'Synthetic',
    host: 'synthetic.invalid', port: 2222, distro: 'fixture-distro',
    rigBinary: '/synthetic/rig', root: '/synthetic/project' });
  const config = { connection, root: connection.root, path: 'nested/selected.ts' };
  const model = Model.fromJson({ global: {}, layout: { type: 'row', children: [{
    type: 'tabset', id: 'main', active: true, selected: 0, children: [
      { type: 'tab', id: 'selected', component, config },
    ],
  }] } });
  const state = { connections: [connection], activeConnection: connection.id,
    roots: {}, layouts: {}, activeRig: '', pinnedSeats: [], collapsedPods: [] };
  const events = [];
  const scope = { connection, root: config.root, state, stateRef: { current: state },
    model, modelRef: { current: model }, revision: 0, Actions, fileTreeOwner,
    pendingFileFocus: { current: null },
    addPanel(...args) { events.push(args); },
    focusPanel() { assert.fail('new explicit file must not focus an existing panel'); },
    Sidebar: 'Sidebar', React: { createElement(type, props) { return { type, props }; } },
    section: 'files', inventory: null, inventoryError: '', busy: false,
    pinsAvailable: false, podsAvailable: false, fileRevision: 0,
    refreshAll() {}, openProject() {}, openConnect() {}, openSeat() {},
    openSeatBeside() {}, dragSeat() {},
  };
  scope.modelOwners = { current: new WeakMap([[model, 'synthetic-workspace']]) };
  scope.workspaceRef = { current: 'synthetic-workspace' };
  scope.setRevision = update => { scope.revision = update(scope.revision); };
  scope.setState = update => { scope.state = update(scope.state); scope.stateRef.current = scope.state; };
  scope.openFile = evaluate(openFile, scope);
  const changed = unique(n => ts.isVariableDeclaration(n) && n.name.getText(app) === 'modelChanged');
  const fixture = { model, config, events, scope, modelChanged: evaluate(changed.initializer, scope), render() {
    for (const name of ['sidebarFileOwner', 'activeFile']) {
      const declaration = unique(n => ts.isVariableDeclaration(n) && n.name.getText(app) === name);
      scope[name] = evaluate(declaration.initializer, scope);
    }
    fixture.props = evaluate(sidebar, scope).props;
    return fixture.props;
  } };
  fixture.render();
  return fixture;
}

function assertCapturedOpen(fixture) {
  fixture.props.onFile('nested/clicked.ts');
  fixture.props.onDiff('nested/changed.ts');
  assert.equal(fixture.events.length, 2);
  for (const [index, kind, path] of [[0, 'editor', 'nested/clicked.ts'],
    [1, 'diff', 'nested/changed.ts']]) {
    const [actualKind, name, captured, id] = fixture.events[index];
    assert.equal(actualKind, kind);
    assert.equal(name, path.split('/').pop());
    assert.equal(captured.connection, fixture.config.connection);
    assert.equal(captured.root, fixture.config.root);
    assert.equal(captured.path, path);
    assert.equal(id, `${kind === 'diff' ? 'diff' : 'file'}:fixture:${fixture.config.root}:${path}`);
  }
}

module.exports = { appFixture, assertCapturedOpen };
if (require.main === module) {
  const { test } = require('node:test');
  test('actual App Sidebar ordinary captured file and diff opens succeed', () => {
    assertCapturedOpen(appFixture());
  });
  test('actual App Sidebar exposes selected editor and diff captured targets for explicit Reveal', () => {
    const fixtures = ['editor', 'diff'].map(appFixture);
    for (const fixture of fixtures) {
      assert.equal(fixture.model.getActiveTabset().getSelectedNode().getId(), 'selected');
      assert.equal(fixture.events.length, 0, 'deriving Sidebar props must not open files');
      assertCapturedOpen(fixture);
    }
    assert.deepEqual(fixtures.map(f => f.props.activeFile), fixtures.map(f => f.config),
      'selected editor/diff must expose captured connection/root/path to Reveal');
  });
  for (const [slot, value] of Object.entries({ id: 'other', kind: 'wsl', host: 'other.invalid',
    port: 2200, distro: 'other', rigBinary: '/other/rig' })) {
    test(`actual retained App callbacks refuse latest ${slot} repoint before rerender`, () => {
      const f = appFixture();
      const current = { ...f.config.connection, [slot]: value };
      f.scope.stateRef.current = { ...f.scope.state, connections: [current], activeConnection: current.id };
      f.props.onFile('obsolete.ts'); f.props.onDiff('obsolete.ts');
      assert.equal(f.events.length, 0);
      f.scope.connection = current;
      f.scope.state = f.scope.stateRef.current;
      f.render();
      f.props.onFile('fresh.ts'); f.props.onDiff('fresh.ts');
      assert.equal(f.events.length, 2);
      for (const event of f.events) assert.equal(event[2].connection, current);
    });
  }
  test('actual retained callbacks refuse root and model replacement while fresh root opens', () => {
    const f = appFixture();
    const old = f.props;
    f.scope.stateRef.current = { ...f.scope.state, roots: { fixture: '/other/project' } };
    old.onFile('obsolete.ts'); old.onDiff('obsolete.ts');
    assert.equal(f.events.length, 0);
    f.scope.root = '/other/project';
    f.render();
    f.props.onFile('fresh.ts'); f.props.onDiff('fresh.ts');
    assert.equal(f.events.length, 2);
    for (const event of f.events) assert.equal(event[2].root, '/other/project');
    f.scope.modelRef.current = Model.fromJson(f.model.toJson());
    f.props.onFile('obsolete.ts'); f.props.onDiff('obsolete.ts');
    assert.equal(f.events.length, 2);
  });
  test('actual selection and revision renders retain captured foreign configs and exclude terminal or absent selection', () => {
    const f = appFixture();
    const selected = f.model.getNodeById('selected');
    f.model.doAction(Actions.addNode({ type: 'tab', id: 'terminal', component: 'terminal' }, 'main', require('flexlayout-react').DockLocation.CENTER, -1, true));
    f.modelChanged(f.model);
    assert.equal(f.render().activeFile, null);
    assert.equal(f.scope.revision, 1);
    f.model.doAction(Actions.selectTab('selected'));
    f.modelChanged(f.model);
    assert.equal(f.render().activeFile, selected.getConfig());
    const foreign = { ...f.config, root: '/foreign', connection: { ...f.config.connection, host: 'foreign.invalid' } };
    f.model.doAction(Actions.updateNodeAttributes('selected', { config: foreign }));
    f.modelChanged(f.model);
    assert.equal(f.render().activeFile, selected.getConfig());
    assert.equal(f.props.activeFile.root, '/foreign');
    assert.equal(f.events.length, 0);
    f.model.doAction(Actions.deleteTab('selected'));
    f.model.doAction(Actions.deleteTab('terminal'));
    assert.equal(f.render().activeFile, null);
  });
  test('actual App props drive filter and explicit Reveal without changing selection or real dirty buffers', async (t) => {
    const { mountScenario, searchFor, button, entry, visibleRows } = require('./file-explorer.test.cjs');
    const f = appFixture();
    const bufferExports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/editor-buffers.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports: bufferExports, require(id) {
      assert.equal(id, './drafts');
      return new Proxy({}, { get() { return () => assert.fail('navigation must not persist drafts'); } });
    } });
    const dirty = { content: 'unsaved synthetic', saved: 'saved synthetic', revision: 'r1' };
    bufferExports.buffers.set('selected', dirty);
    bufferExports.bufferConfigs.set('selected', f.config);
    const selection = JSON.stringify(f.model.toJson());
    const view = mountScenario({ props: f.props, handle(owner, request) {
      assert.equal(owner, f.config.connection);
      assert.equal(request.root, f.config.root);
      return request.op === 'search' || request.path === 'nested'
        ? [entry('nested/selected.ts')] : [entry('nested', true)];
    } });
    t.after(() => view.unmount());
    await view.settle();
    await searchFor(view, 'selected');
    view.event(button(view, 'Reveal active file'), 'onClick');
    await view.settle();
    assert.ok(visibleRows(view).some(n => n.props.title === 'nested/selected.ts' && n.props.className.includes('file-revealed')));
    assert.equal(view.observations.scrolls.length, 1);
    assert.equal(JSON.stringify(f.model.toJson()), selection);
    assert.equal(bufferExports.buffers.get('selected'), dirty);
    assert.deepEqual(dirty, { content: 'unsaved synthetic', saved: 'saved synthetic', revision: 'r1' });
    assert.equal(bufferExports.bufferConfigs.get('selected'), f.config);
    assert.equal(f.scope.pendingFileFocus.current, null);
    assert.deepEqual(f.events, []);
    assert.deepEqual(view.actions, []);
    assert.deepEqual(view.forbidden, []);
    view.event(visibleRows(view).find(n => n.props.title === 'nested/selected.ts'), 'onClick');
    assert.equal(f.events.length, 1, 'ordinary explicit row click still reaches actual App openFile');
    assert.equal(f.events[0][2].connection, f.config.connection);
  });
}

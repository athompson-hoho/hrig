const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Model, Actions } = require('flexlayout-react');

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
    roots: {}, activeRig: '', pinnedSeats: [], collapsedPods: [] };
  const events = [];
  const scope = { connection, root: config.root, state, stateRef: { current: state },
    model, modelRef: { current: model }, revision: 0, Actions,
    pendingFileFocus: { current: null },
    addPanel(...args) { events.push(args); },
    focusPanel() { assert.fail('new explicit file must not focus an existing panel'); },
    Sidebar: 'Sidebar', React: { createElement(type, props) { return { type, props }; } },
    section: 'files', inventory: null, inventoryError: '', busy: false,
    pinsAvailable: false, podsAvailable: false, fileRevision: 0,
    refreshAll() {}, openProject() {}, openConnect() {}, openSeat() {},
    openSeatBeside() {}, dragSeat() {},
  };
  scope.openFile = evaluate(openFile, scope);
  return { model, config, events, props: evaluate(sidebar, scope).props };
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
}

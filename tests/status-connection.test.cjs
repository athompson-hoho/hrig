const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

// Evaluate the actual conditional footer from App.tsx with real connection data.
const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const matches = [];
(function visit(n) {
  if (ts.isJsxExpression(n) && n.expression && n.expression.getText(app).startsWith('preferences["appearance.statusBar"] &&')) matches.push(n.expression);
  ts.forEachChild(n, visit);
})(app);
assert.equal(matches.length, 1);

const conns = [
  { id: 'local', kind: 'local', name: 'Local', root: '~' },
  { id: 'a', kind: 'ssh', name: 'Alpha host', host: 'alpha', root: '~' },
  { id: 'b', kind: 'wsl', name: 'Beta distro', distro: 'Ubuntu', root: '~' },
];
function mount(activeId = 'a') {
  const chosen = []; let menu = null; let view;
  const root = ({ react }) => props => {
    const connection = conns.find(c => c.id === activeId);
    const scope = vm.createContext({ React: react, ...props, connection, root: '~', fileRevision: 0,
      preferences: { 'appearance.statusBar': true },
      GitInfoStatus: () => null, RigHealthStatus: () => null, AccountStatus: 'account-status',
      attentionScope: () => ({ inventory: null, ready: false }), inventory: null, inventoryHealth: { current: {} }, inventoryError: '',
      Network: 'network-icon', ChevronDown: 'chevron-icon', Check: 'check-icon', Activity: 'activity-icon', tabCount: 1,
      state: { activeRig: '', connections: conns },
      menu, setMenu: v => { menu = v; }, chooseConnection: id => { chosen.push(id); menu = null; },
      setSection() {}, setSidebar() {}, addPanel() {} });
    vm.runInContext(ts.transpileModule(`result = (${matches[0].getText(app)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope);
    return scope.result;
  };
  view = mountComponent(null, null, {}, { root });
  const refresh = () => view.update({});
  refresh();
  return { view, chosen, refresh, setMenu: v => { menu = v; } };
}
const button = view => view.nodes().find(n => n.type === 'button' && /status-connection-button/.test(n.props.className || ''));
const items = view => view.nodes().filter(n => n.type === 'button' && n.props.role === 'menuitemradio');

test('status bar shows the selected connection as a menu button; menu is closed by default', () => {
  const m = mount('a');
  const b = button(m.view);
  assert.ok(b); assert.equal(b.props['aria-haspopup'], 'menu'); assert.equal(b.props['aria-expanded'], false);
  assert.match(m.view.text(b), /SSH: Alpha host/);
  assert.match(b.props.title, /Connection: Alpha host/);
  assert.equal(items(m.view).length, 0);
});

test('opening lists every configured connection, marks the selected one, and choosing calls the existing switch handler only', () => {
  const m = mount('a');
  let stopped = false;
  button(m.view).props.onClick({ stopPropagation() { stopped = true; } }); m.refresh();
  assert.ok(stopped, 'does not also trigger the global outside-click close');
  assert.equal(button(m.view).props['aria-expanded'], true);
  assert.deepEqual(items(m.view).map(i => [m.view.text(i).trim(), i.props['aria-checked']]),
    [['LocalLOCAL', false], ['Alpha hostSSH', true], ['Beta distroWSL', false]]);
  assert.deepEqual(m.chosen, [], 'nothing switches until a connection is chosen');
  items(m.view)[2].props.onClick(); m.refresh();
  assert.deepEqual(m.chosen, ['b']);
  assert.equal(items(m.view).length, 0, 'menu closes after choosing');
});

test('local connection keeps its existing label; wiring reuses chooseConnection and the shared menu state', () => {
  const m = mount('local');
  assert.match(m.view.text(button(m.view)), /Local workspace/);
  const src = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(src, /"layout" \| "connection" \| "statusConnection"/);
  assert.match(src, /role="menuitemradio"[\s\S]{0,200}onClick=\{\(\) => chooseConnection\(c\.id\)\}/);
  const footer = matches[0].getText(app);
  assert.doesNotMatch(footer, /setState|saveConnection|openConnect/, 'switching only through chooseConnection');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (id) => dependencies[id] || require(id) });
  return exports;
}

const seat = (id, extra = {}) => Object.freeze({
  id, rigId: 'r1', rigName: 'RigNorth', name: 'Alice', runtime: 'Codex',
  pod: 'Builders', model: 'ModelZ', session: 'terminal-42', status: 'running',
  activity: '', error: '', workCount: 0, ...extra,
});
const seats = Object.freeze([seat('a'), seat('b', { name: 'Bob', pod: 'Reviewers' }),
  seat('c', { rigId: 'r2', name: 'Other' })]);

// This harness checks actual element props and retained query state, not native DOM behavior.
function sidebar(overrides = {}) {
  const state = [];
  let cursor = 0;
  const calls = [];
  const action = (...args) => calls.push(args);
  const health = load('../src/inventory-health.ts');
  const Sidebar = load('../src/Sidebar.tsx', {
    react: { useEffect() {}, useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    } },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    './components': { ErrorBox: 'ErrorBox', IconButton: 'IconButton', StatusDot: 'StatusDot' },
    './inventory-health': health,
    './seat-search': fs.existsSync(require('node:path').join(__dirname, '../src/seat-search.ts'))
      ? load('../src/seat-search.ts') : {},
  }).default;
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: 'r1', fileRevision: 0,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(key => [key, action])),
    ...overrides,
  };
  let tree;
  const render = () => { cursor = 0; tree = Sidebar(props); return tree; };
  const nodes = () => {
    const result = [];
    function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      result.push(node);
      walk(node.props?.children);
    }
    walk(tree);
    return result;
  };
  const input = () => nodes().find(n => n.type === 'input' && n.props['aria-label'] === 'Filter sessions');
  render();
  return { calls, props, nodes, input, render, health,
    query(value) { input().props.onChange({ target: { value } }); render(); },
    rows: () => nodes().filter(n => n.props?.className === 'session-row'),
    count: () => nodes().find(n => n.props?.className === 'section-label' &&
      n.props.children[0]?.props.children === 'SESSIONS').props.children[1].props.children,
  };
}

test('Sidebar input filters actual rows and count by pod, then clearing restores scope without actions', () => {
  const view = sidebar();
  assert.equal(view.count(), 2);
  view.query('  bUiLdErS  ');
  assert.deepEqual(view.rows().map(row => row.key), ['a']);
  assert.equal(view.count(), 1);
  assert.equal(view.input().props.value, '  bUiLdErS  ');
  assert.equal(view.input().props.placeholder, 'Find a session…');
  view.query('');
  assert.deepEqual(view.rows().map(row => row.key), ['a', 'b']);
  assert.equal(view.count(), 2);
  assert.deepEqual(view.calls, []);
});

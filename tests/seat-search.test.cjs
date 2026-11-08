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

const filter = (...args) => load('../src/seat-search.ts').filterSeats(...args);
const ids = (result) => Array.from(result.seats, item => item.id);

for (const field of ['name', 'rigName', 'runtime', 'pod', 'model', 'session']) {
  test(`matches ${field} independently with literal case-insensitive trimmed text`, () => {
    const input = Object.freeze([seat('match', { [field]: 'Unique[.*]Value' }), seat('other')]);
    const result = filter(input, 'r1', '  uNiQuE[.*]vAlUe  ');
    assert.deepEqual(ids(result), ['match']);
    assert.equal(result.seats[0], input[0]);
    assert.equal(result.scopedCount, 2);
    assert.equal(result.hasQuery, true);
    assert.equal(result.noMatches, false);
  });
}

test('scopes to selected rig before matching and permits all rigs when unselected', () => {
  assert.deepEqual(ids(filter(seats, 'r1', 'Other')), []);
  assert.equal(filter(seats, 'r1', 'Other').noMatches, true);
  assert.deepEqual(ids(filter(seats, '', 'Other')), ['c']);
  const emptyScope = filter(seats, 'missing', 'Alice');
  assert.equal(emptyScope.scopedCount, 0);
  assert.equal(emptyScope.noMatches, false);
});

test('empty and whitespace queries restore frozen scoped objects in original equal-value order', () => {
  const input = Object.freeze([seat('z'), seat('a'), seat('other', { rigId: 'r2' })]);
  for (const query of ['', '  \t\n', 'Alice']) {
    const result = filter(input, 'r1', query);
    assert.deepEqual(ids(result), ['z', 'a']);
    assert.equal(result.seats[0], input[0]);
    assert.equal(result.seats[1], input[1]);
    assert.equal(result.hasQuery, query === 'Alice');
    assert.equal(result.noMatches, false);
  }
  assert.deepEqual(input.map(item => item.id), ['z', 'a', 'other']);
});

test('empty and single inventories and absent metadata are safe without invented text', () => {
  const partial = Object.freeze([seat('partial', {
    name: undefined, rigName: undefined, runtime: undefined,
    pod: undefined, model: undefined, session: null,
  })]);
  for (const query of ['', 'anything']) {
    const result = filter(Object.freeze([]), '', query);
    assert.deepEqual(ids(result), []);
    assert.equal(result.scopedCount, 0);
    assert.equal(result.noMatches, false);
  }
  assert.equal(filter(partial, '', '').seats[0], partial[0]);
  for (const query of ['null', 'undefined', 'anything']) {
    assert.deepEqual(ids(filter(partial, '', query)), []);
  }
});

test('does not join metadata fields or interpret query as regular expression', () => {
  const input = Object.freeze([seat('a', { name: 'alpha', rigName: 'beta' })]);
  for (const query of ['alpha beta', '.*', '[']) {
    assert.deepEqual(ids(filter(input, '', query)), []);
  }
});

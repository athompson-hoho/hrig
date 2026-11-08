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
    './seat-status': load('../src/seat-status.ts'),
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
  const statusSelect = () => nodes().find(n => n.type === 'select' &&
    n.props['aria-label'] === 'Filter session status');
  render();
  return { calls, props, nodes, input, statusSelect, render, health,
    query(value) { input().props.onChange({ target: { value } }); render(); },
    status(value) {
      assert.ok(statusSelect(), 'Sidebar exposes the native Filter session status select');
      statusSelect().props.onChange({ target: { value } });
      render();
    },
    rows: () => nodes().filter(n => n.props?.className === 'session-row'),
    count: () => nodes().find(n => n.props?.className === 'section-label' &&
      n.props.children[0]?.props.children === 'SESSIONS').props.children[1].props.children,
  };
}

test('Sidebar status select offers five ordered choices and reversibly filters actual rows', () => {
  const inventorySeats = Object.freeze([
    seat('working', { status: 'working' }),
    seat('idle', { status: 'idle' }),
    seat('attention', { status: 'attention' }),
    seat('stopped', { status: 'stopped' }),
    seat('exited', { status: 'exited' }),
    seat('failed', { status: 'failed' }),
    seat('running', { status: 'running' }),
    seat('unknown', { status: 'unknown' }),
    seat('missing', { status: undefined, session: null, activity: 'working' }),
  ]);
  const view = sidebar({ inventory: { rigs: [], seats: inventorySeats, sampledAt: new Date().toISOString() } });
  const select = view.statusSelect();
  assert.ok(select, 'Sidebar exposes the native Filter session status select');
  assert.equal(select.props.value, 'all');
  assert.equal(select.props.className, 'sidebar-status-filter');
  assert.deepEqual(Array.from(select.props.children, option => [option.props.value, option.props.children]), [
    ['all', 'All statuses'], ['working', 'Working'], ['idle', 'Idle'],
    ['attention', 'Needs input'], ['stopped', 'Stopped'],
  ]);
  for (const [value, expected] of [
    ['working', ['working']], ['idle', ['idle']], ['attention', ['attention']],
    ['stopped', ['stopped', 'exited', 'failed']], ['all', inventorySeats.map(item => item.id)],
  ]) {
    view.status(value);
    assert.deepEqual(view.rows().map(row => row.key), expected);
    assert.equal(view.count(), expected.length);
    assert.equal(view.statusSelect().props.value, value);
  }
  assert.deepEqual(view.calls, []);
});

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

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'object') return textOf(node.props?.children);
  return String(node);
}

test('Sidebar populated scope with no matches renders static status copy and clearing restores rows', () => {
  const view = sidebar();
  const query = 'unmatched'.repeat(1000);
  view.query(query);
  assert.equal(view.count(), 0);
  assert.equal(view.rows().length, 0);
  const status = view.nodes().find(n => n.props?.role === 'status' &&
    textOf(n).includes('No matching sessions'));
  assert.ok(status, 'filtered populated scope must show No matching sessions status');
  assert.equal(status.props.className, 'sidebar-empty');
  assert.equal(textOf(status), 'No matching sessionsTry another search or clear the filters.');
  assert.equal(textOf(status).includes(query), false);
  assert.equal(view.input().type, 'input');
  assert.equal(view.input().props.multiline, undefined);
  assert.equal(view.nodes().some(n => textOf(n) === 'No seats yet'), false);
  view.query(' \t ');
  assert.deepEqual(view.rows().map(row => row.key), ['a', 'b']);
  assert.equal(view.count(), 2);
  assert.deepEqual(view.calls, []);
});

test('Sidebar genuinely empty inventory and empty selected rig retain connection guidance', () => {
  for (const overrides of [
    { inventory: { rigs: [], seats: [], sampledAt: new Date().toISOString() } },
    { selectedRig: 'missing' },
    { busy: true, selectedRig: 'missing' },
  ]) {
    const view = sidebar(overrides);
    for (const query of ['', 'Alice', '  ']) {
      view.query(query);
      assert.equal(view.rows().length, 0);
      const empty = view.nodes().find(n => n.props?.className === 'connection-empty');
      assert.ok(empty);
      assert.ok(textOf(empty).includes(overrides.busy ? 'Discovering seats…' : 'No seats yet'));
      assert.ok(textOf(empty).includes('Running OpenRig seats will appear here.'));
      assert.equal(view.nodes().some(n => textOf(n).includes('No matching sessions')), false);
    }
    assert.deepEqual(view.calls, []);
  }
});

test('Sidebar unavailable inventory error takes precedence over search result guidance', () => {
  const view = sidebar({ inventory: null, inventoryError: 'SSH unavailable' });
  view.query('Alice');
  const empty = view.nodes().find(n => n.props?.className === 'connection-empty');
  assert.ok(textOf(empty).includes('Rig unavailable'));
  assert.ok(textOf(empty).includes('SSH unavailable'));
  assert.ok(textOf(empty).includes('Connection settings'));
  assert.equal(view.nodes().some(n => textOf(n).includes('No matching sessions')), false);
  assert.deepEqual(view.calls, []);
});

test('Sidebar stale and checking snapshots retain notices and disabled actions after filter and clear', () => {
  for (const checking of [false, true]) {
    const view = sidebar();
    view.props.inventoryError = checking ? view.health.CHECKING_SNAPSHOT : 'SSH disconnected';
    for (const query of ['Builders', 'unmatched', '']) {
      view.query(query);
      const notice = view.nodes().find(n => n.props?.role === 'status' && textOf(n).includes(
        checking ? 'Refreshing · showing the last known snapshot…' : 'Stale inventory · last updated'));
      assert.ok(notice);
      if (!checking) assert.ok(textOf(notice).includes('Retry connection'));
      for (const row of view.rows()) {
        const open = row.props.children[0];
        assert.equal(open.props.disabled, true);
        assert.equal(open.props.draggable, false);
        assert.equal(row.props.children[1].props.disabled, true);
        assert.equal(row.props.children[2].props.disabled, true);
      }
      assert.equal(view.props.selectedRig, 'r1');
    }
    assert.deepEqual(view.rows().map(row => row.key), ['a', 'b']);
    assert.deepEqual(view.calls, []);
  }
});

test('Sidebar partial seat without session retains beside and relaunch guards', () => {
  const partial = seat('partial', { session: null, runtime: undefined, pod: undefined, model: undefined });
  const view = sidebar({ inventory: { rigs: [], seats: [partial], sampledAt: new Date().toISOString() } });
  view.query('Alice');
  const row = view.rows()[0];
  assert.equal(row.props.children[0].props.disabled, false);
  assert.equal(row.props.children[0].props.draggable, true);
  assert.equal(row.props.children[1].props.disabled, true);
  assert.equal(row.props.children[2].props.disabled, true);
  view.query('');
  assert.deepEqual(view.rows().map(row => row.key), ['partial']);
  assert.deepEqual(view.calls, []);
});

test('Sidebar intersects rig/query/status and preserves independent controls through snapshots', () => {
  const items = Object.freeze([seat('z', { status: 'idle' }), seat('a', { status: 'idle' }),
    seat('working', { status: 'working' }), seat('other', { status: 'idle', rigId: 'r2' })]);
  const view = sidebar({ inventory: { rigs: [], seats: items } });
  view.query('  aLiCe ');
  view.status('idle');
  assert.deepEqual(view.rows().map(row => row.key), ['z', 'a']);
  view.status('all');
  assert.equal(view.input().props.value, '  aLiCe ');
  assert.equal(view.props.selectedRig, 'r1');
  assert.equal(view.count(), 3);
  view.status('idle');
  for (const query of ['', ' \t ']) {
    view.query(query);
    assert.equal(view.statusSelect().props.value, 'idle');
    assert.deepEqual(view.rows().map(row => row.key), ['z', 'a']);
  }
  view.props.selectedRig = 'r2';
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['other']);
  view.props.inventory = { rigs: [], seats: [seat('replacement', { rigId: 'r2', status: 'idle' })] };
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['replacement']);
  assert.equal(view.count(), 1);
  view.status('invalid');
  assert.equal(view.statusSelect().props.value, 'idle');
  assert.deepEqual(view.calls, []);
});

test('Sidebar status-only and combined empty results retain unavailable and true-empty precedence', () => {
  const view = sidebar();
  for (const query of ['', 'unmatched']) {
    view.query(query);
    view.status('idle');
    assert.equal(view.count(), 0);
    assert.ok(view.nodes().some(n => n.props?.role === 'status' &&
      textOf(n) === 'No matching sessionsTry another search or clear the filters.'));
  }
  view.props.selectedRig = 'missing';
  view.render();
  assert.ok(view.nodes().some(n => n.props?.className === 'connection-empty' && textOf(n).includes('No seats yet')));
  view.props.inventory = null;
  view.props.inventoryError = 'SSH unavailable';
  view.render();
  assert.ok(view.nodes().some(n => n.props?.className === 'connection-empty' && textOf(n).includes('Rig unavailable')));
  assert.equal(view.nodes().some(n => textOf(n).includes('No matching sessions')), false);
  assert.deepEqual(view.calls, []);
});

test('Sidebar status filtering preserves stale/checking guards and notices even when empty', () => {
  for (const checking of [false, true]) {
    const view = sidebar({ inventory: { rigs: [], seats: [seat('a', { status: 'idle' })] } });
    view.props.inventoryError = checking ? view.health.CHECKING_SNAPSHOT : 'SSH disconnected';
    for (const [status, query] of [['idle', ''], ['working', ''], ['idle', 'unmatched'], ['all', '']]) {
      view.status(status);
      view.query(query);
      assert.ok(view.nodes().some(n => n.props?.role === 'status' && textOf(n).includes(
        checking ? 'Refreshing · showing the last known snapshot…' : 'Stale inventory · last updated')));
      for (const row of view.rows()) {
        assert.equal(row.props.children[0].props.disabled, true);
        assert.equal(row.props.children[0].props.draggable, false);
        assert.equal(row.props.children[1].props.disabled, true);
        assert.equal(row.props.children[2].props.disabled, true);
      }
    }
    assert.deepEqual(view.calls, []);
  }
});

test('Sidebar filtered explicit actions receive original seats while missing-session guards remain', () => {
  const original = seat('original', { status: 'idle' });
  const partial = seat('partial', { status: 'idle', session: null });
  const view = sidebar({ inventory: { rigs: [], seats: Object.freeze([original, partial]) } });
  view.status('idle');
  view.query('Alice');
  assert.deepEqual(view.calls, []);
  const [row, partialRow] = view.rows();
  assert.equal(row.props.children[0].props.disabled, false);
  assert.equal(row.props.children[0].props.draggable, true);
  assert.equal(row.props.children[1].props.disabled, false);
  assert.equal(row.props.children[2].props.disabled, false);
  row.props.children[0].props.onClick();
  const event = {};
  row.props.children[0].props.onDragStart(event);
  row.props.children[1].props.onClick();
  row.props.children[2].props.onClick();
  assert.deepEqual(view.calls, [[original], [event, original], [original], [original]]);
  for (const args of view.calls) assert.equal(args[args.length - 1], original);
  assert.equal(partialRow.props.children[0].props.disabled, false);
  assert.equal(partialRow.props.children[0].props.draggable, true);
  assert.equal(partialRow.props.children[1].props.disabled, true);
  assert.equal(partialRow.props.children[2].props.disabled, true);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

// Real validation/resolution, bundled only in memory as in settings.test.cjs.
const settingsModule = new Module(__filename, module);
settingsModule._compile(buildSync({ entryPoints: ['src/settings.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, __filename);
const settings = settingsModule.exports;

function preferences(user = {}, project = {}) {
  const calls = [];
  const context = {
    user: settings.safeOverrides(user), project: settings.safeOverrides(project), calls,
    get effective() { return settings.resolveSettings(context.user, context.project); },
    update(scope, key, value) {
      const validated = settings.validateOverrides({ [key]: value });
      calls.push([scope, key, value]);
      context[scope] = { ...context[scope], ...validated };
    },
    replace(scope, value) { context[scope] = settings.validateOverrides(value); },
    reset(scope, key) {
      const next = { ...context[scope] };
      if (key) delete next[key];
      context[scope] = key ? next : {};
    },
  };
  return context;
}

function load(file, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(require.resolve(file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
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
let sidebarInstance = 0;
function sidebar(overrides = {}, context = preferences()) {
  const state = [];
  const instance = ++sidebarInstance;
  const refs = [];
  let refCursor = 0;
  let cursor = 0;
  const calls = [];
  const action = (...args) => calls.push(args);
  const health = load('../src/inventory-health.ts');
  const Sidebar = load('../src/Sidebar.tsx', {
    react: { useEffect() {}, useId() { return `sidebar-${instance}`; },
      useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; }, useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    } },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    './components': { ErrorBox: 'ErrorBox', IconButton: 'IconButton', StatusDot: 'StatusDot' },
    './inventory-health': health,
    './seat-pods': load('../src/seat-pods.ts', { './seat-pins': load('../src/seat-pins.ts') }),
    './seat-status': load('../src/seat-status.ts'),
    './SettingsContext': { useSettings: () => context },
    // Baseline Sidebar does not import this module yet. Never manufacture a
    // missing-module RED: the actual absent control must fail its assertion.
    './seat-sort': fs.existsSync(path.join(__dirname, '../src/seat-sort.ts'))
      ? load('../src/seat-sort.ts') : {},
    // Optional only for the baseline RED: absence must fail the actual control
    // assertion rather than module setup. GREEN injects the real pin helper.
    './seat-pins': fs.existsSync(path.join(__dirname, '../src/seat-pins.ts'))
      ? load('../src/seat-pins.ts') : {},
    './seat-search': fs.existsSync(require('node:path').join(__dirname, '../src/seat-search.ts'))
      ? load('../src/seat-search.ts') : {},
  }).default;
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: 'r1', fileRevision: 0,
    collapsedPods: [], podsAvailable: true, onTogglePod() {},
    pinnedSeats: [], pinsAvailable: true, onToggleSeatPin() {},
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(key => [key, action])),
    ...overrides,
  };
  let tree;
  const render = () => { cursor = 0; refCursor = 0; tree = Sidebar(props); return tree; };
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
  const sortSelect = () => nodes().find(n => n.type === 'select' &&
    n.props['aria-label'] === 'Sort sessions');
  render();
  return { calls, props, nodes, input, statusSelect, sortSelect, render, health, context,
    sort(value) {
      assert.ok(sortSelect(), 'Sidebar exposes the native Sort sessions select');
      sortSelect().props.onChange({ target: { value } });
      render();
    },
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

test('collapsed pod attention is derived only from current filtered unpinned rows', () => {
  const pins = load('../src/seat-pins.ts');
  const pods = load('../src/seat-pods.ts', { './seat-pins': pins });
  const a = seat('a', { name: 'Alpha', status: 'attention' });
  const b = seat('b', { name: 'Beta', status: 'attention' });
  const idle = seat('idle', { status: 'idle' });
  const other = seat('other', { rigId: 'r2', status: 'attention' });
  const view = sidebar({ inventory: { rigs: [], seats: [a, b, idle, other] } });
  const cues = () => view.nodes().filter(n => n.props?.className === 'pod-attention');
  assert.equal(cues().length, 0, 'expanded rows carry their own statuses');
  view.props.collapsedPods = [pods.podIdentity(view.props.connection, a)]; view.render();
  assert.equal(textOf(cues()[0]), '2 need input');
  const disclosure = view.nodes().find(n => n.props?.className === 'pod-disclosure');
  assert.match(textOf(view.nodes().find(n => n.props?.id === disclosure.props['aria-describedby'])), /2 need input/);
  view.query('Alpha'); assert.equal(textOf(cues()[0]), '1 need input');
  view.query(''); view.props.pinnedSeats = [pins.seatPinIdentity(view.props.connection, a.id)]; view.render();
  assert.equal(textOf(cues()[0]), '1 need input');
  view.status('working'); assert.equal(cues().length, 0);
  view.status('all'); view.props.inventory = { rigs: [], seats: [idle, other] }; view.render();
  assert.equal(cues().length, 0, 'rerender removes attention no longer represented');
  assert.deepEqual(view.calls, []);
});

test('pod disclosure toggles actual owner state without hiding favorites', () => {
  const pins = load('../src/seat-pins.ts');
  const connection = { id: 'host', kind: 'ssh', name: 'Host' };
  const favorite = seat('favorite', { name: 'Favorite' });
  const ordinary = seat('ordinary', { name: 'Ordinary' });
  let workspace = { connections: [connection], activeConnection: 'host',
    pinnedSeats: [pins.seatPinIdentity(connection, favorite.id)], collapsedPods: [],
    sidebarWidth: 321 };
  let actualOnTogglePod;
  const toggled = [];
  const view = sidebar({ connection, inventory: { rigs: [], seats: [ordinary, favorite] },
    pinnedSeats: workspace.pinnedSeats, collapsedPods: workspace.collapsedPods,
    podsAvailable: true, onTogglePod(original) {
      toggled.push(original);
      actualOnTogglePod(original);
      view.props.collapsedPods = workspace.collapsedPods;
    } });
  assert.deepEqual(view.rows().map(row => row.key), ['favorite', 'ordinary']);
  assert.equal(view.count(), 2);
  const disclosure = action => view.nodes().find(node => node.type === 'button' &&
    node.props['aria-label'] === `${action} pod Builders in rig RigNorth`);
  const collapse = disclosure('Collapse');
  assert.ok(collapse, 'Sidebar renders native Collapse pod Builders in rig RigNorth disclosure');

  // Resolve future owner/helper seams only after the baseline behavior assertion:
  // missing imports or callback setup must never masquerade as the intended RED.
  const pods = load('../src/seat-pods.ts', { './seat-pins': pins });
  const app = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'onTogglePod') {
      callbacks.push(node.initializer.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.equal(callbacks.length, 1, 'actual App pod callback exists uniquely');
  const scope = { ...pins, ...pods, podsAvailable: true,
    pinOwner: pins.pinConnectionIdentity(connection), local: connection,
    setState(update) { workspace = update(workspace); } };
  vm.runInNewContext(ts.transpileModule(`callback = (${callbacks[0].getText(app)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  actualOnTogglePod = scope.callback;
  const identity = pods.podIdentity(connection, ordinary);
  const controlledId = collapse.props['aria-controls'];
  const region = () => view.nodes().find(node => node.props?.id === controlledId);
  assert.equal(collapse.props.type, 'button');
  assert.equal(collapse.props.title, 'Collapse pod Builders in rig RigNorth');
  assert.equal(collapse.props['aria-expanded'], true);
  assert.equal(collapse.props.disabled, false);
  assert.equal(typeof controlledId, 'string');
  assert.ok(region(), 'expanded disclosure controls a mounted container');
  assert.ok(textOf(region()).includes('Ordinary'));
  assert.equal(textOf(region()).includes('Favorite'), false, 'favorite is outside controlled rows');
  collapse.props.onClick();
  view.render();
  assert.deepEqual(Array.from(workspace.collapsedPods), [identity]);
  assert.equal(workspace.sidebarWidth, 321);
  assert.equal(disclosure('Expand').props['aria-expanded'], false);
  assert.equal(disclosure('Expand').props['aria-controls'], controlledId);
  assert.ok(region(), 'collapsed disclosure keeps its controlled container mounted');
  assert.equal(textOf(region()), '', 'collapsed row actions are not rendered');
  assert.deepEqual(view.rows().map(row => row.key), ['favorite']);
  assert.equal(view.count(), 2, 'matched count includes collapsed rows');
  disclosure('Expand').props.onClick();
  view.render();
  assert.deepEqual(Array.from(workspace.collapsedPods), []);
  assert.equal(disclosure('Collapse').props['aria-expanded'], true);
  assert.equal(disclosure('Collapse').props['aria-controls'], controlledId);
  assert.deepEqual(view.rows().map(row => row.key), ['favorite', 'ordinary']);
  assert.equal(view.count(), 2);
  assert.deepEqual(toggled, [ordinary, ordinary]);
  assert.deepEqual(view.calls, [], 'pod disclosure never invokes existing host actions');
});

test('pod controls keep unique opaque IDs across instances toggle filter disappearance and reorder', () => {
  const first = seat('first', { name: 'A', pod: 'One' });
  const second = seat('second', { name: 'B', pod: 'Two' });
  const view = sidebar({ inventory: { rigs: [], seats: [first, second] } });
  const controls = v => v.nodes().filter(n => n.props?.className === 'pod-disclosure');
  const before = controls(view).map(n => n.props['aria-controls']);
  assert.equal(new Set(before).size, 2);
  const other = sidebar({ inventory: { rigs: [], seats: [first, second] } });
  assert.ok(controls(other).every(n => !before.includes(n.props['aria-controls'])));
  for (const id of before) {
    assert.equal(id.includes('host'), false);
    assert.equal(id.includes('One'), false);
    assert.equal(id.includes('r1'), false);
    assert.ok(view.nodes().some(n => n.props?.id === id));
  }
  const pods = load('../src/seat-pods.ts', { './seat-pins': load('../src/seat-pins.ts') });
  view.props.collapsedPods = [pods.podIdentity(view.props.connection, first)];
  view.render();
  assert.deepEqual(controls(view).map(n => n.props['aria-controls']), before);
  assert.deepEqual(view.rows().map(n => n.key), ['second']);
  view.query('B');
  assert.deepEqual(controls(view).map(n => n.props['aria-controls']), [before[1]]);
  view.query('');
  view.props.inventory = { rigs: [], seats: [seat('first', { name: 'Z', pod: 'One' }), second] };
  view.render();
  assert.deepEqual(controls(view).map(n => n.props['aria-controls']), [before[1], before[0]]);
  assert.equal(controls(view)[1].props['aria-expanded'], false);
});

test('pod native disclosure counts hidden matches and withholds foreign membership without weakening host guards', () => {
  const long = 'Long:[] '.repeat(100);
  const ordinary = seat('one', { rigName: long, pod: long });
  const pods = load('../src/seat-pods.ts', { './seat-pins': load('../src/seat-pins.ts') });
  const calls = [];
  const view = sidebar({ inventory: { rigs: [], seats: [ordinary] }, onTogglePod: s => calls.push(s) });
  const control = () => view.nodes().find(n => n.props?.className === 'pod-disclosure');
  const label = `Collapse pod ${long} in rig ${long}`;
  assert.equal(control().props['aria-label'], label);
  assert.equal(control().props.title, label);
  assert.equal(control().props.onKeyDown, undefined, 'native button owns keyboard activation');
  assert.ok(textOf(view.nodes().find(n => n.props?.id === control().props['aria-describedby']))
    .includes('1 matching unpinned session.'));
  for (const error of [view.health.CHECKING_SNAPSHOT, 'Disconnected']) {
    view.props.inventoryError = error; view.render();
    assert.equal(control().props.disabled, false);
    control().props.onClick();
    assert.equal(view.rows()[0].props.children[0].props.disabled, true);
    assert.equal(view.rows()[0].props.children[0].props.draggable, false);
    assert.equal(beside(view.rows()[0]).props.disabled, true);
    assert.equal(relaunch(view.rows()[0]).props.disabled, true);
  }
  assert.deepEqual(calls, [ordinary, ordinary]);
  view.props.collapsedPods = [pods.podIdentity(view.props.connection, ordinary)];
  view.render();
  assert.equal(view.rows().length, 0);
  assert.equal(view.count(), 1);
  assert.equal(control().props['aria-expanded'], false);
  view.props.podsAvailable = false; view.render();
  assert.equal(control().props['aria-expanded'], true);
  assert.equal(control().props.disabled, true);
  assert.equal(view.rows().length, 1);
  control().props.onClick();
  assert.equal(calls.length, 2);
  assert.ok(textOf(view.nodes().find(n => n.props?.id === control().props['aria-describedby']))
    .includes('Pod controls unavailable while this snapshot belongs to another connection.'));
  assert.deepEqual(view.calls, []);
});

test('pod groups preserve selected-sort ties original actions and stable adjacency in every mode', () => {
  const a = seat('a', { name: 'Same', pod: 'One', status: 'idle' });
  const b = seat('b', { name: 'Same', pod: 'Two', status: 'idle' });
  const c = seat('c', { name: 'Same', pod: 'One', status: 'idle' });
  const view = sidebar({ inventory: { rigs: [], seats: Object.freeze([a, b, c]) } });
  for (const mode of ['name', 'activity', 'attention-first']) {
    view.sort(mode);
    assert.deepEqual(view.rows().map(n => n.key), ['a', 'c', 'b']);
    assert.equal(view.count(), 3);
    const groups = view.nodes().filter(n => n.props?.className === 'pod-group');
    assert.equal(groups.length, 2);
    for (const group of groups) {
      const children = group.props.children;
      const button = children[0], content = children[2];
      assert.equal(button.type, 'button');
      assert.equal(button.props.type, 'button');
      assert.equal(button.props['aria-controls'], content.props.id);
      assert.equal(content.props.className, 'pod-content');
    }
    view.rows().forEach((row, i) => {
      row.props.children[0].props.onClick();
      assert.equal(view.calls.pop()[0], [a, c, b][i]);
    });
  }
  assert.deepEqual(view.calls, []);
});

test('all collapsed and pin transitions retain counts choices and mounted empty regions across filtering', () => {
  const pins = load('../src/seat-pins.ts');
  const pods = load('../src/seat-pods.ts', { './seat-pins': pins });
  const a = seat('a', { name: 'Alpha', pod: 'One', status: 'working' });
  const b = seat('b', { name: 'Beta', pod: 'Two', status: 'idle' });
  const view = sidebar({ inventory: { rigs: [], seats: [a, b] } });
  const saved = Object.freeze([pods.podIdentity(view.props.connection, a),
    pods.podIdentity(view.props.connection, b)]);
  const controls = () => view.nodes().filter(n => n.props?.className === 'pod-disclosure');
  view.props.collapsedPods = saved; view.render();
  const ids = controls().map(n => n.props['aria-controls']);
  assert.equal(view.count(), 2);
  assert.equal(view.rows().length, 0);
  assert.equal(controls().length, 2);
  assert.ok(controls().every(n => n.props['aria-expanded'] === false));
  for (const id of ids) assert.equal(view.nodes().find(n => n.props?.id === id).props.children, false);
  assert.ok(!view.nodes().some(n => textOf(n) === 'No matching sessions'));
  view.props.pinnedSeats = [pins.seatPinIdentity(view.props.connection, a.id)]; view.render();
  assert.deepEqual(view.rows().map(n => n.key), ['a']);
  assert.equal(controls().length, 1);
  view.props.pinnedSeats = [a, b].map(s => pins.seatPinIdentity(view.props.connection, s.id)); view.render();
  assert.deepEqual(view.rows().map(n => n.key), ['a', 'b']);
  assert.equal(controls().length, 0);
  view.query('Alpha'); view.status('idle');
  assert.equal(view.count(), 0);
  assert.equal(view.rows().length, 0, 'filtered-out favorites stay absent');
  assert.ok(view.nodes().some(n => n.props?.role === 'status' && textOf(n).includes('No matching sessions')));
  view.query(''); view.status('all'); view.props.pinnedSeats = []; view.render();
  assert.equal(view.rows().length, 0);
  assert.deepEqual(controls().map(n => n.props['aria-controls']), ids);
  assert.equal(view.props.collapsedPods, saved);
  view.props.inventory = { rigs: [], seats: [] }; view.props.busy = true; view.render();
  assert.equal(controls().length, 0);
  assert.ok(view.nodes().some(n => textOf(n) === 'Discovering seats…'));
  view.props.busy = false; view.render();
  assert.ok(view.nodes().some(n => textOf(n) === 'No seats yet'));
  view.props.inventory = { rigs: [], seats: [a, b] }; view.render();
  assert.deepEqual(controls().map(n => n.props['aria-controls']), ids);
  assert.equal(view.count(), 2);
  assert.deepEqual(view.calls, []);
});

test('partial pod labels separate empty literal and tagged rig fallback with truthful plural counts', () => {
  const input = [seat('empty', { rigId: '', rigName: '', pod: '' }),
    seat('literal', { rigId: '', rigName: '', pod: 'Ungrouped' }),
    seat('id', { rigId: 'x', rigName: '', pod: '' }),
    seat('name', { rigId: '', rigName: 'x', pod: '' }),
    seat('name2', { rigId: '', rigName: 'x', pod: '' })];
  const view = sidebar({ selectedRig: '', inventory: { rigs: [], seats: input } });
  const controls = view.nodes().filter(n => n.props?.className === 'pod-disclosure');
  assert.equal(controls.length, 4);
  assert.equal(new Set(controls.map(n => n.props['aria-controls'])).size, 4);
  assert.equal(controls.filter(n => n.props['aria-label'] === 'Collapse pod Ungrouped in rig Unknown rig').length, 2);
  assert.equal(view.count(), 5);
  const descriptions = controls.map(n => textOf(view.nodes().find(d => d.props?.id === n.props['aria-describedby'])));
  assert.equal(descriptions.filter(t => t.includes('1 matching unpinned session.')).length, 3);
  assert.equal(descriptions.filter(t => t.includes('2 matching unpinned sessions.')).length, 1);
  assert.deepEqual(view.rows().map(n => n.key).sort(), input.map(s => s.id).sort());
});

test('Sidebar native pin control reversibly orders rows through its local callback without host actions', () => {
  const toggled = [];
  const pins = load('../src/seat-pins.ts');
  const connection = { id: 'host', kind: 'ssh', name: 'Host' };
  let workspace = { connections: [connection], activeConnection: 'host', pinnedSeats: [] };
  const app = ts.createSourceFile('App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let actualCallback;
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'onToggleSeatPin') {
      actualCallback = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.ok(actualCallback, 'actual App Sidebar callback exists');
  const scope = { ...pins, pinsAvailable: true, pinOwner: pins.pinConnectionIdentity(connection),
    local: connection, setState(update) { workspace = update(workspace); } };
  vm.runInNewContext(ts.transpileModule(`callback = (${actualCallback.getText(app)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  const view = sidebar({ onToggleSeatPin(original) {
    toggled.push(original);
    scope.callback(original);
    view.props.pinnedSeats = workspace.pinnedSeats;
  } });
  assert.deepEqual(view.rows().map(row => row.key), ['a', 'b']);
  assert.equal(view.count(), 2);
  const findPin = name => view.nodes().find(node => node.type === 'button' &&
    node.props['aria-label'] === name);
  const pin = findPin('Pin session Bob in RigNorth');
  assert.ok(pin, 'Sidebar renders native Pin session Bob in RigNorth control');
  assert.equal(pin.props.type, 'button');
  assert.equal(pin.props.title, 'Pin session Bob in RigNorth');
  assert.equal(pin.props['aria-pressed'], false);
  assert.equal(pin.props.disabled, false);
  const bobRow = view.rows().find(row => row.key === 'b');
  assert.equal(bobRow.props.children[1], pin, 'pin is the sibling immediately after seat-open');
  pin.props.onClick();
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['b', 'a']);
  assert.equal(view.count(), 2);
  assert.equal(toggled[0], seats[1], 'local callback receives the original represented seat');
  const unpin = findPin('Unpin session Bob in RigNorth');
  assert.ok(unpin);
  assert.equal(unpin.props.title, 'Unpin session Bob in RigNorth');
  assert.equal(unpin.props['aria-pressed'], true);
  unpin.props.onClick();
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['a', 'b']);
  assert.equal(view.count(), 2);
  assert.equal(findPin('Pin session Bob in RigNorth').props['aria-pressed'], false);
  assert.deepEqual(toggled, [seats[1], seats[1]]);
  assert.deepEqual(view.calls, [], 'pinning never invokes existing host actions');
});

test('Sidebar pins owned stale partial rows but withholds foreign ownership interpretation and mutation', () => {
  const partial = seat('partial', { name: 'Long'.repeat(200), rigName: 'Rig'.repeat(200),
    session: null, status: 'future', runtime: undefined });
  const pins = load('../src/seat-pins.ts');
  const toggled = [];
  const view = sidebar({ inventory: { rigs: [], seats: [partial] },
    onToggleSeatPin: value => toggled.push(value) });
  view.props.pinnedSeats = [pins.seatPinIdentity(view.props.connection, partial.id)];
  for (const error of [view.health.CHECKING_SNAPSHOT, 'Disconnected']) {
    view.props.inventoryError = error;
    view.render();
    const row = view.rows()[0];
    const pin = row.props.children[1];
    assert.equal(pin.props.disabled, false);
    assert.equal(pin.props['aria-pressed'], true);
    assert.equal(pin.props.title, `Unpin session ${partial.name} in ${partial.rigName}`);
    assert.equal(pin.props.children.props.size, 13);
    assert.equal(pin.props.children.props['aria-hidden'], 'true');
    assert.equal(pin.props.children.props.fill, 'currentColor');
    assert.equal(row.props.children[0].props.disabled, true);
    assert.equal(row.props.children[0].props.draggable, false);
    assert.equal(beside(row).props.disabled, true);
    assert.equal(relaunch(row).props.disabled, true);
    pin.props.onClick();
  }
  assert.deepEqual(toggled, [partial, partial]);
  view.props.pinsAvailable = false;
  view.render();
  const unavailable = view.rows()[0].props.children[1];
  assert.equal(unavailable.props.disabled, true);
  assert.equal(unavailable.props['aria-pressed'], false);
  assert.equal(unavailable.props.title, `Pin session ${partial.name} in ${partial.rigName}`);
  unavailable.props.onClick();
  assert.equal(toggled.length, 2);
  assert.deepEqual(view.calls, []);
});

test('Sidebar partitions sorted matches without bypassing filters or inventing absent pinned rows', () => {
  const alice = seat('alice', { name: 'Alice', status: 'working' });
  const bob = seat('bob', { name: 'Bob', status: 'idle' });
  const elsewhere = seat('elsewhere', { rigId: 'r2', name: 'Elsewhere', status: 'working' });
  const view = sidebar({ inventory: { rigs: [], seats: [bob, elsewhere, alice] } });
  const { seatPinIdentity } = load('../src/seat-pins.ts');
  view.props.pinnedSeats = [seatPinIdentity(view.props.connection, bob.id),
    seatPinIdentity(view.props.connection, elsewhere.id), seatPinIdentity(view.props.connection, 'absent')];
  for (const mode of ['name', 'activity', 'attention-first']) {
    view.sort(mode);
    assert.deepEqual(view.rows().map(row => row.key), ['bob', 'alice']);
    assert.equal(view.count(), 2);
    view.status('working');
    assert.deepEqual(view.rows().map(row => row.key), ['alice']);
    view.status('all');
    view.query('Alice');
    assert.deepEqual(view.rows().map(row => row.key), ['alice']);
    view.query('absent');
    assert.equal(view.count(), 0);
    assert.ok(view.nodes().some(n => n.props?.role === 'status' && textOf(n).includes('No matching sessions')));
    view.query('');
    assert.equal(view.sortSelect().props.value, mode);
  }
  view.props.inventory = { rigs: [], seats: [alice] };
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['alice']);
  const replacement = seat('bob', { name: 'Bob', status: 'future', runtime: undefined, session: null });
  view.props.inventory = { rigs: [], seats: [alice, replacement] };
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['bob', 'alice']);
  assert.equal(view.rows()[0].props.children[1].props['aria-pressed'], true);
  view.rows()[0].props.children[0].props.onClick();
  assert.equal(view.calls[0][0], replacement);
  view.calls.length = 0;
  assert.deepEqual(view.calls, []);
});

test('Sidebar pin partition preserves equal names across rigs and each sort/filter intersection', () => {
  const first = seat('r1:same', { name: 'Same', status: 'idle' });
  const second = seat('r2:same', { name: 'Same', rigId: 'r2', rigName: 'RigSouth', status: 'working' });
  const attention = seat('r1:attention', { name: 'Zed', status: 'attention' });
  const input = Object.freeze([first, second, attention]);
  const { seatPinIdentity } = load('../src/seat-pins.ts');
  const view = sidebar({ selectedRig: '', inventory: { rigs: [], seats: input } });
  view.props.pinnedSeats = [seatPinIdentity(view.props.connection, second.id)];
  const expected = { name: [second, first, attention],
    activity: [second, attention, first], 'attention-first': [second, attention, first] };
  const check = values => {
    assert.deepEqual(view.rows().map(row => row.key), values.map(value => value.id));
    assert.equal(view.count(), values.length);
    view.rows().forEach((row, index) => {
      row.props.children[0].props.onClick();
      assert.equal(view.calls.pop()[0], values[index]);
    });
  };
  for (const mode of ['name', 'activity', 'attention-first']) {
    view.sort(mode);
    check(expected[mode]);
    view.query('Same');
    check([second, first]);
    view.status('working');
    check([second]);
    view.props.selectedRig = 'r1'; view.render();
    check([]);
    view.props.selectedRig = 'r2'; view.render();
    check([second]);
    view.props.selectedRig = ''; view.query(''); view.status('all');
    check(expected[mode]);
    view.props.pinnedSeats = [];
    view.render();
    check(mode === 'name' ? [first, attention, second] :
      mode === 'activity' ? [second, attention, first] : [attention, first, second]);
    view.props.pinnedSeats = [seatPinIdentity(view.props.connection, second.id)];
    view.render();
    view.props.connection = { ...view.props.connection, host: 'other' }; view.render();
    check(mode === 'name' ? [first, attention, second] :
      mode === 'activity' ? [second, attention, first] : [attention, first, second]);
    assert.ok(view.rows().every(row => row.props.children[1].props['aria-pressed'] === false));
    view.props.connection = { id: 'host', kind: 'ssh', name: 'Renamed', root: '/new' };
    view.render();
    check(expected[mode]);
  }
  assert.deepEqual(view.calls, []);
  assert.deepEqual(input, [first, second, attention]);
});

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
    ['working', ['working', 'running']], ['idle', ['idle']], ['attention', ['attention']],
    ['stopped', ['stopped', 'exited', 'failed']], ['all', inventorySeats.map(item => item.id)],
  ]) {
    view.status(value);
    assert.deepEqual(view.rows().map(row => row.key), expected);
    assert.equal(view.count(), expected.length);
    assert.equal(view.statusSelect().props.value, value);
  }
  assert.deepEqual(view.calls, []);
});

const sortInventory = Object.freeze([
  seat('idle', { name: 'seat10', status: 'idle' }),
  seat('attention', { name: 'seat2', status: 'attention' }),
  seat('working', { name: 'seat20', status: 'working' }),
  seat('running', { name: 'seat1', status: 'running' }),
  seat('other-rig', { rigId: 'r2', name: 'seat0', status: 'working' }),
  seat('other-query', { name: 'Elsewhere', pod: 'Other', status: 'working' }),
]);
const sortRows = {
  name: ['other-query', 'running', 'attention', 'idle', 'working'],
  activity: ['other-query', 'working', 'running', 'attention', 'idle'],
  'attention-first': ['attention', 'running', 'idle', 'working', 'other-query'],
};

test('Sidebar sort select offers three effective choices and orders actual rows without actions', () => {
  const view = sidebar({ inventory: { rigs: [], seats: sortInventory } });
  const select = view.sortSelect();
  assert.ok(select, 'Sidebar exposes the native Sort sessions select');
  assert.equal(select.props.value, 'name');
  assert.equal(select.props.className, 'sidebar-status-filter');
  assert.deepEqual(Array.from(select.props.children, option => [option.props.value, option.props.children]), [
    ['name', 'Name'], ['activity', 'Activity (working first)'], ['attention-first', 'Attention first'],
  ]);
  const nodes = view.nodes();
  assert.ok(nodes.indexOf(select) > nodes.indexOf(view.statusSelect()));
  assert.ok(nodes.indexOf(select) < nodes.findIndex(n => n.props?.className === 'rig-list'));
  for (const mode of ['name', 'activity', 'attention-first']) {
    view.sort(mode);
    assert.equal(view.sortSelect().props.value, mode);
    assert.deepEqual(view.rows().map(row => row.key), sortRows[mode]);
    assert.equal(view.count(), 5);
    view.sort(mode);
    assert.deepEqual(view.rows().map(row => row.key), sortRows[mode]);
  }
  assert.ok(view.context.calls.every(([scope, key]) => scope === 'user' && key === 'rig.seatSort'));
  const writes = view.context.calls.length;
  view.sort('ACTIVITY');
  assert.equal(view.context.calls.length, writes);
  assert.equal(view.sortSelect().props.value, 'attention-first');
  assert.deepEqual(view.calls, []);
});

test('Sidebar sorting composes rig query and status and preserves controls through refresh', () => {
  const view = sidebar({ inventory: { rigs: [], seats: sortInventory } });
  view.query('Builders');
  for (const [mode, expected] of [
    ['name', ['running', 'attention', 'idle', 'working']],
    ['activity', ['working', 'running', 'attention', 'idle']],
    ['attention-first', ['attention', 'running', 'idle', 'working']],
  ]) {
    view.sort(mode);
    assert.deepEqual(view.rows().map(row => row.key), expected);
    assert.equal(view.input().props.value, 'Builders');
    assert.equal(view.props.selectedRig, 'r1');
    assert.equal(view.statusSelect().props.value, 'all');
    view.status('working');
    assert.deepEqual(view.rows().map(row => row.key), mode === 'activity' ? ['working', 'running'] : ['running', 'working']);
    assert.equal(view.count(), 2);
    view.status('all');
  }
  view.status('working');
  view.props.inventory = { rigs: [], seats: [seat('new', { name: 'New', status: 'working' })] };
  view.render();
  assert.deepEqual(view.rows().map(row => row.key), ['new']);
  assert.equal(view.sortSelect().props.value, 'attention-first');
  assert.equal(view.statusSelect().props.value, 'working');
  assert.equal(view.input().props.value, 'Builders');
  assert.deepEqual(view.calls, []);
});

test('Sidebar sort writes owned project defaults and follows external changes reset and inheritance', () => {
  const context = preferences();
  const view = sidebar({ inventory: { rigs: [], seats: sortInventory } }, context);
  view.sort('activity');
  assert.deepEqual(context.calls, [['user', 'rig.seatSort', 'activity']]);
  context.replace('project', { 'rig.seatSort': 'name' });
  view.render();
  assert.equal(view.sortSelect().props.value, 'name');
  assert.deepEqual(view.rows().map(row => row.key), sortRows.name);
  view.sort('attention-first');
  assert.deepEqual(context.calls[1], ['project', 'rig.seatSort', 'attention-first']);
  assert.equal(context.user['rig.seatSort'], 'activity');
  context.reset('project', 'rig.seatSort');
  view.render();
  assert.equal(view.sortSelect().props.value, 'activity');
  assert.deepEqual(view.rows().map(row => row.key), sortRows.activity);
  context.reset('user');
  view.render();
  assert.equal(view.sortSelect().props.value, 'name');
  assert.deepEqual(view.rows().map(row => row.key), sortRows.name);
  assert.deepEqual(view.calls, []);
});

test('Sidebar reconstructs validated serialized user and project sort preferences without claiming app restart', () => {
  for (const projectOwned of [false, true]) {
    const context = preferences({ 'editor.fontSize': 17 }, projectOwned ? { 'rig.seatSort': 'name' } : {});
    const view = sidebar({ inventory: { rigs: [], seats: sortInventory } }, context);
    for (const mode of ['activity', 'attention-first', 'name']) {
      view.sort(mode);
      const saved = JSON.parse(JSON.stringify({ preferences: context.user,
        projectPreferences: { 'host::~': context.project } }));
      const restored = preferences(saved.preferences, saved.projectPreferences['host::~']);
      const reconstructed = sidebar({ inventory: { rigs: [], seats: sortInventory } }, restored);
      assert.equal(reconstructed.sortSelect().props.value, mode);
      assert.deepEqual(reconstructed.rows().map(row => row.key), sortRows[mode]);
      assert.equal(reconstructed.count(), 5);
      assert.equal(restored.user['editor.fontSize'], 17);
      assert.equal(Object.hasOwn(restored.project, 'rig.seatSort'), projectOwned);
      assert.equal(context.calls.at(-1)[0], projectOwned ? 'project' : 'user');
      assert.deepEqual(restored.calls, []);
      assert.deepEqual(reconstructed.calls, []);
    }
    assert.deepEqual(view.calls, []);
  }
});

test('Sidebar sorting preserves original callback objects stale guards empty states and long titles', () => {
  const original = seat('long', { name: 'Z'.repeat(1000), status: 'working' });
  const partial = seat('partial', { name: 'A', status: 'attention', session: null });
  const view = sidebar({ inventory: { rigs: [], seats: Object.freeze([original, partial]) } });
  view.sort('activity');
  assert.deepEqual(view.rows().map(row => row.key), ['long', 'partial']);
  assert.ok(view.rows()[0].props.children[0].props.title.startsWith(original.name));
  assert.equal(beside(view.rows()[1]).props.disabled, true);
  assert.deepEqual(view.calls, []);
  const row = view.rows()[0];
  row.props.children[0].props.onClick();
  beside(row).props.onClick();
  relaunch(row).props.onClick();
  assert.deepEqual(view.calls, [[original], [original], [original]]);
  view.calls.length = 0;
  for (const error of [view.health.CHECKING_SNAPSHOT, 'Disconnected']) {
    view.props.inventoryError = error;
    view.sort('attention-first');
    assert.ok(view.nodes().some(n => n.props?.role === 'status' && textOf(n).includes(
      error === view.health.CHECKING_SNAPSHOT ? 'Refreshing' : 'Stale inventory')));
    for (const item of view.rows()) {
      assert.equal(item.props.children[0].props.disabled, true);
      assert.equal(item.props.children[0].props.draggable, false);
    }
  }
  view.props.inventoryError = '';
  view.query('unmatched');
  view.sort('name');
  assert.equal(view.count(), 0);
  assert.ok(view.nodes().some(n => n.props?.role === 'status' && textOf(n).startsWith('No matching sessions')));
  view.props.inventory = { rigs: [], seats: [] };
  view.sort('activity');
  assert.ok(view.nodes().some(n => n.props?.className === 'connection-empty' && textOf(n).includes('No seats yet')));
  view.props.inventory = null;
  view.props.inventoryError = 'Unavailable';
  view.sort('attention-first');
  assert.ok(view.nodes().some(n => n.props?.className === 'connection-empty' && textOf(n).includes('Rig unavailable')));
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

function beside(row) { return row.props.children.find(n => n?.props?.title?.startsWith("Open ")); }
function relaunch(row) { return row.props.children.find(n => n?.props?.title?.startsWith("Relaunch session ")); }

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
        assert.equal(beside(row).props.disabled, true);
        assert.equal(relaunch(row).props.disabled, true);
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
  assert.equal(beside(row).props.disabled, true);
  assert.equal(relaunch(row).props.disabled, true);
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
        assert.equal(beside(row).props.disabled, true);
        assert.equal(relaunch(row).props.disabled, true);
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
  assert.equal(beside(row).props.disabled, false);
  assert.equal(relaunch(row).props.disabled, false);
  row.props.children[0].props.onClick();
  const event = {};
  row.props.children[0].props.onDragStart(event);
  beside(row).props.onClick();
  relaunch(row).props.onClick();
  assert.deepEqual(view.calls, [[original], [event, original], [original], [original]]);
  for (const args of view.calls) assert.equal(args[args.length - 1], original);
  assert.equal(partialRow.props.children[0].props.disabled, false);
  assert.equal(partialRow.props.children[0].props.draggable, true);
  assert.equal(beside(partialRow).props.disabled, true);
  assert.equal(relaunch(partialRow).props.disabled, true);
});

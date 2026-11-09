const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exp = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/pod-grid.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exp, require });
const { planPodGrid, describePodGrid, POD_GRID_LIMIT } = exp;
const seat = (n, session = `${n}@r`) => ({ id: 'r:' + n, name: n, session });

test('opens only seats with a session, in order, and reports skipped ones', () => {
  const p = planPodGrid([seat('a'), seat('b', null), seat('c')], true);
  assert.deepEqual(p.seats.map(s => s.name), ['a', 'c']); assert.equal(p.noSession, 1); assert.equal(p.blocked, '');
  assert.match(describePodGrid(p), /Opened 2 sessions as a grid; 1 without a terminal skipped\. Undo/);
});

test('caps the grid and says how many were not opened', () => {
  const many = Array.from({ length: POD_GRID_LIMIT + 3 }, (_, i) => seat('s' + i));
  const p = planPodGrid(many, true);
  assert.equal(p.seats.length, POD_GRID_LIMIT); assert.equal(p.overLimit, 3);
  assert.match(describePodGrid(p), /3 over the 12-session limit not opened/);
});

test('stale inventory and sessionless pods are blocked, never partially opened', () => {
  const stale = planPodGrid([seat('a')], false);
  assert.equal(stale.seats.length, 0); assert.match(stale.blocked, /stale/); assert.equal(describePodGrid(stale), stale.blocked);
  const none = planPodGrid([seat('a', null)], true);
  assert.equal(none.seats.length, 0); assert.match(none.blocked, /No session/);
  assert.equal(planPodGrid([], true).seats.length, 0);
});

test('singular wording', () => {
  assert.match(describePodGrid(planPodGrid([seat('a')], true)), /^Opened 1 session as a grid/);
});

test('App wiring: pod grid reuses the undoable Team arrangement and never sends input', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const fn = app.slice(app.indexOf('const openPodGrid'), app.indexOf('const closeTab'));
  assert.match(fn, /remember\(\)/); assert.match(fn, /arrangement\(existing, "Team"\)/);
  assert.doesNotMatch(fn, /sendMessage|rigAction|\.send\(|writeTerminal/);
  assert.match(fn, /planPodGrid\(podSeats, !inventoryError && sameConnection\(connection\)\)/);
  assert.match(fn, /if \(!plan\.blocked\) \{\s*remember\(\)/, 'a blocked plan changes nothing, not even undo history');
  assert.match(app, /onPodGrid=\{\(podSeats\) => openPodGrid\(podSeats\)\}/);
});

test('actual Sidebar renders one grid control per pod header, disabled when stale', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mkSeat = (id, pod) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod, runtime: 'codex', model: '',
    session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0 });
  const seats = [mkSeat('a', 'p1'), mkSeat('b', 'p1'), mkSeat('c', 'p2')];
  const noop = () => {}; const opened = [];
  const props = { section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '', busy: false,
    selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true, pinnedSeats: [], pinsAvailable: true,
    onTogglePod: noop, onToggleSeatPin: noop, onPodGrid: list => opened.push(list.map(s => s.id)),
    ...Object.fromEntries(['onRig','onRefresh','onProject','onConnect','onManageRigs','onSeat','onSeatBeside','onRelaunch','onDrag','onFile','onDiff'].map(k => [k, noop])) };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, { actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop }, height: 600, rowHeight: 55 });
  view.update(props);
  const btns = () => view.nodes().filter(n => /^Open the \d+ matching sessions? of pod /.test(n.props?.title || ''));
  assert.equal(btns().length, 2);
  assert.match(btns()[0].props.title, /Open the 2 matching sessions of pod/);
  btns()[0].props.onClick(); assert.equal(JSON.stringify(opened), '[["a","b"]]');
  props.inventoryError = 'down'; view.update(props);
  assert.ok(btns().every(b => b.props.disabled));
});

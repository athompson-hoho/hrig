const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeInventory } = require('../electron/core.cjs');
const exp = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/seat-work.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exp, require });
const { seatWorkSummary } = exp;

test('normalizeInventory keeps missing distinct from zero and rejects bad counts', () => {
  const n = (extra, id) => ({ rigId: 'r', rigName: 'r', logicalId: id, ...extra });
  const s = normalizeInventory([], [
    n({ assignedWorkCount: 0, pendingWorkCount: 0 }, 'zero'), n({}, 'missing'),
    n({ assignedWorkCount: 3, pendingWorkCount: 1 }, 'three'),
    n({ assignedWorkCount: -1, pendingWorkCount: 1.5 }, 'bad'), n({ assignedWorkCount: '2' }, 'str'),
  ]).seats;
  const by = Object.fromEntries(s.map(x => [x.name, x]));
  assert.deepEqual([by.zero.assignedWork, by.zero.pendingWork], [0, 0]);
  assert.deepEqual([by.missing.assignedWork, by.missing.pendingWork], [null, null]);
  assert.deepEqual([by.three.assignedWork, by.three.pendingWork], [3, 1]);
  assert.deepEqual([by.bad.assignedWork, by.bad.pendingWork], [null, null]);
  assert.equal(by.str.assignedWork, null);
  assert.equal(by.missing.workCount, 0, 'legacy field unchanged');
});

test('confirmed zero, positive, missing and stale are four distinct states', () => {
  const zero = seatWorkSummary(0, 0, true), pos = seatWorkSummary(3, 1, true);
  const missing = seatWorkSummary(null, null, true), stale = seatWorkSummary(3, 1, false);
  assert.equal(zero.available, true); assert.equal(zero.count, 0); assert.equal(zero.badge, '');
  assert.match(zero.label, /No owed work reported/);
  assert.equal(pos.badge, '3'); assert.match(pos.tooltip, /3 assigned \(1 pending, 2 in progress or blocked\)/);
  for (const u of [missing, stale]) { assert.equal(u.available, false); assert.equal(u.count, null); assert.equal(u.badge, ''); assert.match(u.label, /unavailable/); }
  assert.match(missing.label, /not reported/); assert.match(stale.label, /stale/);
  assert.notEqual(zero.label, missing.label);
});

test('pending is only mentioned when consistent; never implies working', () => {
  assert.doesNotMatch(seatWorkSummary(2, undefined, true).tooltip.split('.')[0], /pending/);
  assert.doesNotMatch(seatWorkSummary(2, 5, true).label, /pending/);
  assert.match(seatWorkSummary(2, 0, true).tooltip, /says nothing about whether the session is working/);
});

test('actual Sidebar shows badge only for current positive counts and explains in the title', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mk = (id, extra) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod: 'p', runtime: 'codex', model: '',
    session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0, ...extra });
  const seats = [mk('busy', { assignedWork: 4, pendingWork: 1 }), mk('zero', { assignedWork: 0 }), mk('old', {})];
  const noop = () => {};
  const props = { section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '', busy: false,
    selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true, pinnedSeats: [], pinsAvailable: true,
    onTogglePod: noop, onToggleSeatPin: noop,
    ...Object.fromEntries(['onRig','onRefresh','onProject','onConnect','onManageRigs','onSeat','onSeatBeside','onRelaunch','onDrag','onFile','onDiff'].map(k => [k, noop])) };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, { actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop }, height: 400, rowHeight: 55 });
  view.update(props);
  const badges = () => view.nodes().filter(n => n.props?.className === 'seat-work');
  const titles = () => view.nodes().filter(n => n.props?.className === 'seat-row').map(n => n.props.title);
  assert.equal(badges().length, 1); assert.match(badges()[0].props['aria-label'], /4 assigned \(1 pending/);
  const t = titles();
  assert.equal(t.filter(x => /No owed work reported/.test(x)).length, 1);
  assert.equal(t.filter(x => /Owed work unavailable: not reported/.test(x)).length, 1);
  props.inventoryError = 'down'; view.update(props);
  assert.equal(badges().length, 0);
  assert.ok(titles().every(x => /Owed work unavailable: inventory is stale/.test(x)));
});

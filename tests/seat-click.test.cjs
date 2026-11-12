const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const built = buildSync({ entryPoints: ['src/settings.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = new Module('src/settings.ts', module);
mod._compile(built.outputFiles[0].text, 'src/settings.ts');
const settings = mod.exports;

test('rig.seatClick defaults to open, validates open/select only, and is documented', () => {
  assert.equal(settings.resolveSettings()['rig.seatClick'], 'open');
  const row = settings.schema.find(r => r.key === 'rig.seatClick');
  assert.ok(row); assert.equal(row.category, 'Connections & rigs');
  assert.deepEqual(row.options.map(o => o.value), ['open', 'select']);
  assert.equal(settings.validateOverrides({ 'rig.seatClick': 'select' })['rig.seatClick'], 'select');
  for (const bad of ['double', '', 'Select', true, 1]) assert.throws(() => settings.validateOverrides({ 'rig.seatClick': bad }));
  assert.deepEqual(settings.safeOverrides({ 'rig.seatClick': 'double' }), {});
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`rig\.seatClick` \| `open`/);
});

function mount(seatClick, over = {}) {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mk = (id, extra) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod: 'p', runtime: 'codex', model: '',
    session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0, ...extra });
  const seats = [mk('a'), mk('b', { session: null })];
  const noop = () => {}; const opened = [];
  const props = { section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '', busy: false,
    selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true, pinnedSeats: [], pinsAvailable: true,
    onTogglePod: noop, onToggleSeatPin: noop, onSeat: seat => opened.push(seat.id),
    ...Object.fromEntries(['onRig','onRefresh','onProject','onConnect','onManageRigs','onSeatBeside','onRelaunch','onDrag','onFile','onDiff'].map(k => [k, noop])), ...over };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, { actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact', 'rig.seatClick': seatClick }, project: {}, update: noop }, height: 400, rowHeight: 55 });
  view.update(props);
  const rows = () => view.nodes().filter(n => n.type === 'button' && /^seat-row/.test(n.props?.className || ''));
  const openBtns = () => view.nodes().filter(n => /^Open terminal for /.test(n.props?.title || ''));
  return { view, props, opened, rows, openBtns };
}

test('default: clicking a session opens it and shows no extra Open control', () => {
  const m = mount('open');
  assert.equal(m.openBtns().length, 0);
  m.rows()[0].props.onClick();
  assert.deepEqual(m.opened, ['a']);
  assert.equal(m.rows()[0].props['aria-pressed'], undefined);
});

test('select only: click selects without opening; explicit Open control opens', () => {
  const m = mount('select');
  m.rows()[0].props.onClick(); m.view.update(m.props);
  assert.deepEqual(m.opened, [], 'click never opens');
  assert.equal(m.rows()[0].props['aria-pressed'], true);
  assert.match(m.rows()[0].props.className, /selected/);
  assert.equal(m.rows()[1].props['aria-pressed'], false);
  assert.deepEqual(m.openBtns().map(b => [b.props.title, !!b.props.disabled]), [['Open terminal for a', false], ['Open terminal for b', true]]);
  m.openBtns()[0].props.onClick();
  assert.deepEqual(m.opened, ['a']);
});

test('select only: stale inventory disables the Open control; unknown setting value behaves as open', () => {
  const m = mount('select', { inventoryError: 'down' });
  assert.ok(m.openBtns().every(b => b.props.disabled));
  const u = mount(undefined);
  u.rows()[0].props.onClick(); assert.deepEqual(u.opened, ['a']);
});

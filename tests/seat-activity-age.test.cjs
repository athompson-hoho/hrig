const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeInventory } = require('../electron/core.cjs');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/seat-activity-age.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require });
const { seatActivityAge } = exportsObject;
const NOW = Date.parse('2026-01-01T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();

test('normalizeInventory carries only a valid raw lastActivityAt, else null', () => {
  const node = extra => ({ rigId: 'r', rigName: 'r', logicalId: 'a', ...extra });
  const seats = normalizeInventory([], [
    node({ lastActivityAt: '2026-01-01T11:59:00.000Z' }),
    node({ logicalId: 'b', lastActivityAt: null }),
    node({ logicalId: 'c' }),
    node({ logicalId: 'd', lastActivityAt: 'garbage' }),
    node({ logicalId: 'e', lastActivityAt: 12345 }),
    node({ logicalId: 'f', agentActivity: { sampledAt: '2026-01-01T11:00:00.000Z' } }),
  ]).seats;
  assert.deepEqual(seats.map(s => s.lastActivityAt),
    ['2026-01-01T11:59:00.000Z', null, null, null, null, null]);
});

test('floors to bounded units and never rounds up', () => {
  const cases = [[0, '0 s'], [9999, '9 s'], [59999, '59 s'], [60000, '1 min'], [3599999, '59 min'],
    [3600000, '1 h'], [86399999, '23 h'], [86400000, '1 day'], [5 * 86400000, '5 days']];
  for (const [ms, text] of cases) {
    const r = seatActivityAge(ago(ms), NOW, true);
    assert.equal(r.available, true);
    assert.equal(r.text, text);
    assert.match(r.label, /^Last terminal activity /);
  }
});

test('invalid, missing, future, and old-host values are explicitly unavailable', () => {
  for (const v of [undefined, null, '', 'nope', 42, {}, ago(-1000)]) {
    const r = seatActivityAge(v, NOW, true);
    assert.equal(r.available, false);
    assert.equal(r.text, '');
    assert.match(r.label, /unavailable/i);
    assert.doesNotMatch(r.label, /just now|0 s/);
  }
  assert.equal(seatActivityAge(ago(0), NaN, true).available, false);
});

test('only current verified inventory claims an age; stale context is marked, not shown', () => {
  const r = seatActivityAge(ago(120000), NOW, false);
  assert.equal(r.available, false);
  assert.match(r.label, /stale|not current/i);
  assert.equal(r.text, '');
});

test('wording is terminal activity, never working/status duration', () => {
  const r = seatActivityAge(ago(240000), NOW, true);
  assert.doesNotMatch(r.label + r.tooltip, /working \d|status duration/i);
  assert.match(r.tooltip, /terminal/i);
});

test('Sidebar consumer: no new timer, current-owner gating, raw field only', () => {
  const src = fs.readFileSync('src/Sidebar.tsx', 'utf8');
  assert.equal((src.match(/setInterval/g) || []).length, 1, 'only the pre-existing InventoryAge timer');
  assert.match(src, /ageCurrent = !inventoryError && pinsAvailable/);
  assert.match(src, /seatActivityAge\(s\.lastActivityAt, activityClock, ageCurrent\)/);
  assert.doesNotMatch(src, /seatActivityAge\([^)]*sampledAt/);
  assert.match(src, /age\.tooltip/);
});

test('actual Sidebar renders age only for current inventory, with explanatory tooltip', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mk = (id, extra) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod: 'p', runtime: 'claude-code',
    model: '', session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0, ...extra });
  const seats = [
    mk('fresh', { lastActivityAt: new Date(Date.now() - 4 * 60000 - 500).toISOString() }),
    mk('nullish', { lastActivityAt: null }),
    mk('oldhost', {}),
    mk('future', { lastActivityAt: new Date(Date.now() + 3600000).toISOString() }),
  ];
  const noop = () => {};
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true,
    pinnedSeats: [], pinsAvailable: true, onTogglePod: noop, onToggleSeatPin: noop,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(k => [k, noop])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop },
    height: 400, rowHeight: 55,
  });
  view.update(props);
  const ages = () => view.nodes().filter(n => n.props?.className === 'seat-age');
  const titles = () => view.nodes().filter(n => n.type === 'button' && n.props.className === 'seat-row').map(n => n.props.title);
  assert.equal(ages().length, 1);
  assert.match(ages()[0].props['aria-label'], /^Last terminal activity 4 min ago$/);
  const t = titles();
  assert.equal(t.length, 4);
  assert.equal(t.filter(x => /activity unavailable/.test(x)).length, 3);
  assert.equal(t.filter(x => /4 min ago/.test(x)).length, 1);
  props.inventoryError = 'connection lost';
  view.update(props);
  assert.equal(ages().length, 0, 'stale inventory suppresses age');
  assert.ok(titles().every(x => /stale or not current/.test(x)));
  props.inventoryError = ''; props.pinsAvailable = false;
  view.update(props);
  assert.equal(ages().length, 0, 'non-current raw owner suppresses age');
});

test('real rig 0.7.7 shapes: compact `lastActivity` (a sample time) is ignored; --full lastActivityAt is used', async () => {
  const { nodeList } = require('../electron/core.cjs');
  // Shapes observed from `rig ps --nodes --all-rigs --json [--full]` on rig 0.7.7.
  const compact = { rigId: 'r', rigName: 'r', logicalId: 'a', sessionStatus: 'running', lastActivity: '2026-01-01T11:59:59.000Z', agentActivity: { state: 'idle' } };
  const full = { rigId: 'r', rigName: 'r', logicalId: 'a', sessionStatus: 'running', lastActivityAt: '2026-01-01T11:50:00.000Z', terminalActive: false, agentActivity: { state: 'idle' } };
  assert.equal(normalizeInventory([], [compact]).seats[0].lastActivityAt, null, 'sampledAt-like field never counts');
  assert.equal(normalizeInventory([], [full]).seats[0].lastActivityAt, '2026-01-01T11:50:00.000Z');
  const calls = [];
  const ok = async (c, args) => { calls.push(args); return '[]'; };
  await nodeList({}, ok);
  assert.deepEqual(calls, [['ps', '--nodes', '--all-rigs', '--json', '--full']]);
});

test('nodeList falls back to the compact list only when --full is rejected', async () => {
  const { nodeList } = require('../electron/core.cjs');
  const calls = [];
  const old = async (c, args) => { calls.push(args); if (args.includes('--full')) throw new Error("error: unknown option '--full'"); return 'compact'; };
  assert.equal(await nodeList({}, old), 'compact');
  assert.equal(calls.length, 2); assert.ok(!calls[1].includes('--full'));
  calls.length = 0;
  const down = async (c, args) => { calls.push(args); throw new Error('connection refused'); };
  await assert.rejects(nodeList({}, down), /connection refused/);
  assert.equal(calls.length, 1, 'real failures are not doubled');
});

test('nodeList does not retry on errors that merely mention --full', async () => {
  const { nodeList } = require('../electron/core.cjs');
  for (const msg of ['timed out running rig ps --full', 'ssh: connection closed (--full)', 'invalid JSON near --full']) {
    let n = 0;
    await assert.rejects(nodeList({}, async () => { n++; throw new Error(msg); }), new RegExp(msg.split(' ')[0]));
    assert.equal(n, 1, msg);
  }
  for (const msg of ["error: unknown option '--full'", "error: unrecognized option --full", "--full is not supported"]) {
    let n = 0;
    await nodeList({}, async (c, a) => { n++; if (a.includes('--full')) throw new Error(msg); return '[]'; });
    assert.equal(n, 2, msg);
  }
});

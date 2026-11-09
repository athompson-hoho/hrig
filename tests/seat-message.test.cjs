const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createSeatMessage, MAX_MESSAGE, TTL_MS } = require('../electron/seat-message.cjs');
const conn = { id: 'h', kind: 'ssh', host: 'srv' };
function fixture(opts = {}) {
  let clock = 1000, n = 0, session = 'a@r';
  const calls = [];
  const api = createSeatMessage({
    now: () => clock, uuid: () => 'tok' + ++n,
    inventory: async () => ({ seats: opts.gone ? [] : [{ id: 'r:a', name: 'a', rigName: 'r', session }] }),
    runRig: async (c, args) => { calls.push(args); if (opts.fail) throw Error('boom'); return 'ok'; },
  });
  return { api, calls, tick: ms => { clock += ms; }, repoint: s => { session = s; } };
}
const prep = (f, m = 'hello\nworld') => f.api.operation(conn, { op: 'prepare', id: 'r:a', message: m });

test('prepare sends nothing and returns the exact recipient and payload for review', async () => {
  const f = fixture();
  const r = await prep(f, '  keep  spaces\n');
  assert.deepEqual(f.calls, []);
  assert.equal(r.session, 'a@r'); assert.equal(r.payload, '  keep  spaces\n'); assert.equal(r.length, 15);
});

test('send delivers exactly the reviewed payload to the reviewed session, once', async () => {
  const f = fixture();
  const r = await prep(f, '-rm -rf nothing');
  const out = await f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token });
  assert.deepEqual(f.calls, [['send', 'a@r', '--', '-rm -rf nothing']]);
  assert.equal(out.delivered, true);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token }), /expired/);
  assert.equal(f.calls.length, 1);
});

test('failed send is not retried and consumes the token', async () => {
  const f = fixture({ fail: true });
  const r = await prep(f);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token }), /boom/);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token }), /expired/);
  assert.equal(f.calls.length, 1);
});

test('token is bound to connection, seat, ttl, and the recipient staying the same', async () => {
  let f = fixture(); let r = await prep(f);
  await assert.rejects(f.api.operation({ ...conn, host: 'other' }, { op: 'send', id: 'r:a', token: r.token }), /expired/);
  f = fixture(); r = await prep(f);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:b', token: r.token }), /expired/);
  f = fixture(); r = await prep(f); f.tick(TTL_MS + 1);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token }), /expired/);
  f = fixture(); r = await prep(f); f.repoint('other@r');
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: r.token }), /recipient changed/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.api.operation(conn, { op: 'send', id: 'r:a', token: 'forged' }), /expired/);
});

test('rejects empty, oversized, NUL, missing and unsafe recipients before any token', async () => {
  const f = fixture();
  for (const m of ['', '   \n', undefined, 5]) await assert.rejects(f.api.operation(conn, { op: 'prepare', id: 'r:a', message: m }), /Enter a message/);
  await assert.rejects(prep(f, 'x'.repeat(MAX_MESSAGE + 1)), /under/);
  await assert.rejects(prep(f, 'a\0b'), /unsupported/);
  await assert.rejects(prep(fixture({ gone: true })), /no longer available/);
  await assert.rejects(f.api.operation(conn, { op: 'nope' }), /Unsupported/);
});

test('wiring: IPC and preload exist; main-process module is the only sender; no auto paths', () => {
  assert.match(fs.readFileSync('electron/main.cjs', 'utf8'), /handle\("seat:message"/);
  assert.match(fs.readFileSync('electron/preload.cjs', 'utf8'), /seatMessage: invoke\("seat:message"\)/);
  const ui = fs.readFileSync('src/SeatMessage.tsx', 'utf8');
  assert.doesNotMatch(ui, /sendMessage|rigAction|localStorage|drafts/);
  assert.match(ui, /op: "prepare"/); assert.match(ui, /op: "send"/);
  assert.doesNotMatch(ui, /useEffect\([^]*op: "send"/);
});

test('actual Sidebar offers the message control on every session row, disabled when stale or sessionless', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mkSeat = (id, extra) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod: 'p', runtime: 'codex',
    model: '', session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0, ...extra });
  const seats = [mkSeat('a'), mkSeat('b', { session: null })];
  const noop = () => {}; const opened = [];
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true,
    pinnedSeats: [], pinsAvailable: true, onTogglePod: noop, onToggleSeatPin: noop,
    onSeatMessage: seat => opened.push(seat.id),
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(k => [k, noop])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop },
    height: 400, rowHeight: 55,
  });
  view.update(props);
  const btns = () => view.nodes().filter(n => /^Message .* \(reviewed before sending\)$/.test(n.props?.title || ''));
  assert.deepEqual(btns().map(b => [b.props.title, !!b.props.disabled]),
    [['Message a (reviewed before sending)', false], ['Message b (reviewed before sending)', true]]);
  btns()[0].props.onClick();
  assert.deepEqual(opened, ['a']);
  props.inventoryError = 'down'; view.update(props);
  assert.ok(btns().every(b => b.props.disabled));
});

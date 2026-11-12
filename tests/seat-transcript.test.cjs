const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createSeatTranscript, TAIL_LINES, MAX_CHARS } = require('../electron/seat-transcript.cjs');
const { cleanPromptText } = require('../electron/seat-prompt.cjs');

const mk = (extra = {}) => ({ id: 'r:a', name: 'a', session: 'a@r', status: 'idle', ...extra });
function fixture(seat, output = 'line1\nline2') {
  const calls = [];
  const api = createSeatTranscript({
    now: () => Date.UTC(2026, 0, 1),
    inventory: async () => ({ seats: seat ? [seat] : [] }),
    runRig: async (c, args) => { calls.push(args); if (output instanceof Error) throw output; return output; },
  });
  return { api, calls };
}

test('reads any seat with a session via rig transcript --tail only', async () => {
  for (const status of ['idle', 'working', 'attention', 'stopped']) {
    const { api, calls } = fixture(mk({ status }));
    const r = await api.read({}, 'r:a');
    assert.deepEqual(calls, [['transcript', 'a@r', '--tail', String(TAIL_LINES)]]);
    assert.equal(r.text, 'line1\nline2'); assert.equal(r.seatName, 'a');
    assert.equal(r.capturedAt, '2026-01-01T00:00:00.000Z');
  }
});

test('refuses missing, sessionless, option-like and whitespace session names', async () => {
  await assert.rejects(fixture(null).api.read({}, 'r:a'), /no longer available/);
  for (const session of [null, '-x', 'a b', 'a\nb']) await assert.rejects(fixture(mk({ session })).api.read({}, 'r:a'), /no longer available/);
  await assert.rejects(fixture(mk()).api.read({}, ''), /Choose a session/);
  await assert.rejects(fixture(mk(), new Error('no transcript')).api.read({}, 'r:a'), /no transcript/);
});

test('cleans escapes/bidi and keeps only the most recent bounded text', async () => {
  const many = Array.from({ length: 500 }, (_, i) => `row ${i}`).join('\n');
  const r = await fixture(mk(), many).api.read({}, 'r:a');
  assert.equal(r.text.split('\n').length, 200); assert.ok(r.text.endsWith('row 499')); assert.equal(r.truncated, true);
  const big = await fixture(mk(), '\u001b[1m' + 'x'.repeat(MAX_CHARS + 10) + 'END‮').api.read({}, 'r:a');
  assert.equal(big.text.length, MAX_CHARS); assert.ok(big.text.endsWith('END'));
  assert.equal((await fixture(mk(), '').api.read({}, 'r:a')).text, '');
});

test('R10 prompt cleaner behavior is unchanged by the shared helper', () => {
  assert.equal(cleanPromptText('\u001b[31mhi\u001b[0m\n\n').text, 'hi');
  const r = cleanPromptText(Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n'));
  assert.equal(r.text.split('\n').length, 40); assert.equal(r.truncated, true);
});

test('wiring is read-only: IPC + preload exist; module/dialog have no send path', () => {
  assert.match(fs.readFileSync('electron/main.cjs', 'utf8'), /handle\("seat:transcript"/);
  assert.match(fs.readFileSync('electron/preload.cjs', 'utf8'), /seatTranscript: invoke\("seat:transcript"\)/);
  assert.doesNotMatch(fs.readFileSync('electron/seat-transcript.cjs', 'utf8'), /send-keys|"send"|sendMessage|runAction/);
  const ui = fs.readFileSync('src/SeatTranscript.tsx', 'utf8');
  assert.doesNotMatch(ui, /rigAction|rigControl|sendMessage|seatMessage|<input|<textarea/);
  assert.match(ui, /seatTranscript\(connection, seatId\)/);
});

test('actual Sidebar offers the transcript control on every row with a session, disabled when stale', () => {
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
    onSeatTranscript: seat => opened.push(seat.id),
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(k => [k, noop])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop },
    height: 400, rowHeight: 55,
  });
  view.update(props);
  const btns = () => view.nodes().filter(n => /^View recent transcript for .* \(read-only\)$/.test(n.props?.title || ''));
  assert.deepEqual(btns().map(b => [b.props.title, !!b.props.disabled]),
    [['View recent transcript for a (read-only)', false], ['View recent transcript for b (read-only)', true]]);
  btns()[0].props.onClick();
  assert.deepEqual(opened, ['a']);
  props.inventoryError = 'down'; view.update(props);
  assert.ok(btns().every(b => b.props.disabled));
  props.inventoryError = ''; props.onSeatTranscript = undefined; view.update(props);
  assert.equal(btns().length, 0);
});

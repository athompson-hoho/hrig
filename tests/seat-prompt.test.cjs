const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPromptText, createSeatPrompt, MAX_LINES, MAX_CHARS } = require('../electron/seat-prompt.cjs');

const mk = (extra = {}) => ({ id: 'r:a', name: 'a', session: 'a@r', status: 'attention', ...extra });
function fixture(seat, output = 'Proceed? (y/n)') {
  const calls = [];
  const api = createSeatPrompt({
    now: () => Date.UTC(2026, 0, 1),
    inventory: async () => ({ seats: seat ? [seat] : [] }),
    runRig: async (c, args) => { calls.push(args); if (output instanceof Error) throw output; return output; },
  });
  return { api, calls };
}

test('reads only via rig capture with a bounded line count; never sends', async () => {
  const { api, calls } = fixture(mk());
  const r = await api.read({}, 'r:a');
  assert.deepEqual(calls, [['capture', 'a@r', '--lines', String(MAX_LINES)]]);
  assert.equal(r.text, 'Proceed? (y/n)');
  assert.equal(r.capturedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(r.truncated, false);
});

test('refuses seats that are not currently needing input, missing, or unsafe', async () => {
  await assert.rejects(fixture(mk({ status: 'idle' })).api.read({}, 'r:a'), /not waiting for input/);
  await assert.rejects(fixture(null).api.read({}, 'r:a'), /no longer available/);
  await assert.rejects(fixture(mk({ session: '-x' })).api.read({}, 'r:a'), /no longer available/);
  await assert.rejects(fixture(mk({ session: 'a\nb' })).api.read({}, 'r:a'), /no longer available/);
  await assert.rejects(fixture(mk({ session: null })).api.read({}, 'r:a'), /no longer available/);
  await assert.rejects(fixture(mk()).api.read({}, ''), /Choose a session/);
});

test('capture failures propagate; nothing is cached', async () => {
  await assert.rejects(fixture(mk(), new Error('host down')).api.read({}, 'r:a'), /host down/);
});

test('cleanPromptText strips escapes/control chars and trims blank edges', () => {
  const raw = '\n\n\u001b[31mDelete?\u001b[0m \u001b]0;title\u0007 \r\n  [y/n]   \u0000\u0007\n\n';
  assert.equal(cleanPromptText(raw).text, 'Delete?\n  [y/n]');
  assert.equal(cleanPromptText(null).text, '');
  assert.equal(cleanPromptText('a\tb').text, 'a\tb');
});

test('cleanPromptText keeps the LAST lines and chars and flags truncation', () => {
  const many = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
  const r = cleanPromptText(many);
  assert.equal(r.text.split('\n').length, MAX_LINES);
  assert.ok(r.text.endsWith('l99'));
  assert.equal(r.truncated, true);
  const big = cleanPromptText('x'.repeat(MAX_CHARS + 50) + 'END');
  assert.equal(big.text.length, MAX_CHARS);
  assert.ok(big.text.endsWith('END'));
  assert.equal(big.truncated, true);
});

const fs = require('node:fs');
test('actual Sidebar offers the prompt view only on needs-input rows with current inventory', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const mkSeat = (id, extra) => ({ id, rigId: 'r1', rigName: 'Rig', name: id, pod: 'p', runtime: 'codex',
    model: '', session: `${id}@Rig`, status: 'idle', activity: '', error: '', workCount: 0, ...extra });
  const seats = [mkSeat('wait', { status: 'attention' }), mkSeat('calm'), mkSeat('nosession', { status: 'attention', session: null })];
  const noop = () => {};
  const opened = [];
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs: [], seats, sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: 'r1', fileRevision: 0, collapsedPods: [], podsAvailable: true,
    pinnedSeats: [], pinsAvailable: true, onTogglePod: noop, onToggleSeatPin: noop,
    onSeatPrompt: seat => opened.push(seat.id),
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(k => [k, noop])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop },
    height: 400, rowHeight: 55,
  });
  view.update(props);
  const buttons = () => view.nodes().filter(n => /^View pending prompt for /.test(n.props?.title || ''));
  assert.deepEqual(buttons().map(b => [b.props.title, !!b.props.disabled]),
    [['View pending prompt for nosession (read-only)', true], ['View pending prompt for wait (read-only)', false]]);
  buttons().find(b => /wait/.test(b.props.title)).props.onClick();
  assert.deepEqual(opened, ['wait']);
  props.inventoryError = 'down'; view.update(props);
  assert.ok(buttons().every(b => b.props.disabled), 'stale inventory disables the view');
  props.inventoryError = ''; props.onSeatPrompt = undefined; view.update(props);
  assert.equal(buttons().length, 0, 'absent consumer renders no control');
});

test('wiring is capture-only: IPC, preload, and dialog expose no send path', () => {
  const main = fs.readFileSync('electron/main.cjs', 'utf8');
  assert.match(main, /handle\("seat:prompt"/);
  assert.match(fs.readFileSync('electron/preload.cjs', 'utf8'), /seatPrompt: invoke\("seat:prompt"\)/);
  const mod = fs.readFileSync('electron/seat-prompt.cjs', 'utf8');
  assert.doesNotMatch(mod, /send-keys|"send"|sendMessage|runAction/);
  const ui = fs.readFileSync('src/SeatPrompt.tsx', 'utf8');
  assert.doesNotMatch(ui, /rigAction|rigControl|\.send|sendMessage|<input|<textarea/);
  assert.match(ui, /seatPrompt\(connection, seat\.id\)/);
});

test('cleanPromptText strips bidi override/isolate controls but keeps ordinary text', () => {
  assert.equal(cleanPromptText('ok \u202Eevil\u202C \u2066x\u2069 \u200F日本 😀').text, 'ok evil x 日本 😀');
});

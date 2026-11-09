const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('rq', module);
m._compile(buildSync({ entryPoints: ['src/rig-quick-actions.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'rq.js');
const { QUICK_ACTIONS, quickAction, initialCommand, safeRigId, isFreshRequest, FRESH_MS } = m.exports;
const J = v => JSON.parse(JSON.stringify(v));

test('exactly two read-only actions, both real commands in the shipped index, frozen', () => {
  assert.deepEqual(J(QUICK_ACTIONS.map(a => a.path)), [['ps'], ['snapshot', 'list']]);
  const index = JSON.parse(fs.readFileSync('src/openrig-command-index.json', 'utf8')).entries.map(e => e.path.join(' '));
  for (const a of QUICK_ACTIONS) assert.ok(index.includes(a.path.join(' ')), a.path.join(' '));
  for (const verb of ['start', 'stop', 'down', 'archive', 'restore', 'remove', 'delete', 'launch', 'create'])
    assert.ok(!QUICK_ACTIONS.some(a => a.path.includes(verb)), verb);
  assert.ok(Object.isFrozen(QUICK_ACTIONS) && Object.isFrozen(QUICK_ACTIONS[0]) && Object.isFrozen(QUICK_ACTIONS[0].path));
  assert.equal(quickAction('ps').id, 'ps'); assert.equal(quickAction('rm'), null); assert.equal(quickAction(undefined), null); assert.equal(quickAction({ id: 'ps' }), null);
});
test('rig id is prefilled only when plain; hostile ids are refused, not cleaned', () => {
  assert.equal(safeRigId('rig-abc123'), 'rig-abc123');
  for (const bad of ['', ' x', 'x ', 'a\nb', 'a\u0007', 'a‮b', 'a​b', 'a﻿b', 'x'.repeat(201), null, undefined, 5, {}]) assert.equal(safeRigId(bad), undefined, JSON.stringify(bad));
  const a = QUICK_ACTIONS[1];
  assert.deepEqual(J(initialCommand(a, { id: 'r1' }, 5)), { path: ['snapshot', 'list'], rigId: 'r1', nonce: 5 });
  assert.deepEqual(J(initialCommand(a, { id: 'r\n1' }, 5)), { path: ['snapshot', 'list'], nonce: 5 });
  const cmd = initialCommand(a, { id: 'r1' }, 1); cmd.path.push('x'); assert.deepEqual(J(a.path), ['snapshot', 'list'], 'result does not alias the allowlist');
});
test('stale requests (restored layouts) are ignored', () => {
  const now = 1_000_000;
  assert.equal(isFreshRequest(now - 50, now), true); assert.equal(isFreshRequest(now - FRESH_MS, now), false);
  assert.equal(isFreshRequest(now - 3600000, now), false); assert.equal(isFreshRequest(now + 500, now), true); assert.equal(isFreshRequest(now + 5000, now), false);
  for (const bad of ['1', null, undefined, NaN, Infinity]) assert.equal(isFreshRequest(bad, now), false);
});
test('safety pins: no bridge, prepare or execute from the menu code path', () => {
  const mod = fs.readFileSync('src/rig-quick-actions.ts', 'utf8');
  assert.doesNotMatch(mod, /window\.hrig|rigControl\(|execute|prepare/);
  const sb = fs.readFileSync('src/Sidebar.tsx', 'utf8');
  const menu = sb.slice(sb.indexOf('rig-actions-menu'), sb.indexOf('rig-actions-menu') + 1400);
  assert.doesNotMatch(menu, /window\.hrig|rigControl|execute|prepare|rigAction/);
  assert.match(sb, /aria-label=\{`Rig actions for \$\{r\.name\}`\}/);
  const rc = fs.readFileSync('src/RigControl.tsx', 'utf8');
  const eff = rc.slice(rc.indexOf('useEffect(() => {\n    if (!initial'), rc.indexOf('const choose = '));
  assert.ok(eff.length > 100); assert.doesNotMatch(eff, /prepare\(|execute\(|window\.hrig/);
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const open = app.slice(app.indexOf('const openRigAction'), app.indexOf('const addPanel = ('));
  assert.match(open, /quickAction\(actionId\)/); assert.doesNotMatch(open, /window\.hrig|prepare|execute/);
  assert.match(app, /initial=\{config\.initialCommand\}/);
});
test('actual Sidebar: menu lists exactly the two actions, calls onRigAction only on choice, closes after', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const chosen = [];
  const noop = () => {};
  const rigs = [{ id: 'r1', name: 'Alpha', status: 'running', nodeCount: 3 }];
  const props = {
    section: 'sessions', connection: { id: 'host', kind: 'ssh', name: 'Host' }, root: '~',
    inventory: { rigs, seats: [], sampledAt: new Date().toISOString() }, inventoryError: '',
    busy: false, selectedRig: '', fileRevision: 0, collapsedPods: [], podsAvailable: true,
    pinnedSeats: [], pinsAvailable: true, onTogglePod: noop, onToggleSeatPin: noop,
    onRigAction: (r, a) => chosen.push([r, a]),
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff'].map(k => [k, noop])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, resolvedChildren: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update: noop },
    height: 400, rowHeight: 55,
  });
  view.update(props);
  const toggle = () => view.nodes().find(n => n.type === 'button' && n.props['aria-label'] === 'Rig actions for Alpha');
  assert.ok(toggle(), 'toggle button is rendered for each rig');
  assert.deepEqual(chosen, []);
  toggle().props.onClick({ stopPropagation() {} }); view.update(props);
  const items = view.nodes().filter(n => n.props?.role === 'menuitem');
  assert.deepEqual(items.slice(0, 2).map(n => view.text(n)), ['View status (ps)', 'List snapshots']);
  items[1].props.onClick(); view.update(props);
  assert.deepEqual(J(chosen), [['r1', 'snapshot-list']]);
});

test('actual RigControl: a fresh request opens the command and prefills the rig; nothing is prepared or run; stale requests do nothing', async () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const calls = [];
  const schemaFor = path => ({ name: path.join(' ') || 'rig', description: '', arguments: path.join(' ') === 'snapshot list' ? [{ name: 'rig', required: true, variadic: false }] : [], options: [], commands: [] });
  const api = { rigControl: async (c, req) => { calls.push(req.op + ':' + (req.path || []).join(' ')); return { schema: schemaFor(req.path || []) }; } };
  const connection = { id: 'h', kind: 'ssh', name: 'H', host: 'h', root: '~' };
  const mk = initial => ({ connection, root: '~', inventory: { rigs: [{ id: 'r1', name: 'Alpha' }], seats: [] }, onFile() {}, initial });
  let props = mk(undefined);
  const view = mountComponent('src/RigControl.tsx', 'default', props, { actualComponents: true, resolvedChildren: true, api, height: 600, rowHeight: 30,
    dependencies: { './TerminalPanel': { default: 'terminal-panel' }, './RigCommandResult': { default: 'rig-command-result' }, './openrig-command-index.json': { default: { entries: [] }, entries: [] } } });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); view.update(props); } };
  await settle();
  const base = calls.length;
  props = mk({ path: ['snapshot', 'list'], rigId: 'r1', nonce: Date.now() }); view.update(props); await settle();
  assert.ok(calls.slice(base).includes('describe:snapshot list'), 'opened the requested command: ' + calls.join(','));
  assert.ok(!calls.some(c => /^(prepare|execute)/.test(c)), 'nothing prepared or executed: ' + calls.join(','));
  const filled = view.nodes().some(n => n.type === 'input' && n.props.value === 'r1');
  assert.ok(filled, 'rig id prefilled in the form');
  const before = calls.length;
  props = mk({ path: ['ps'], rigId: 'r1', nonce: Date.now() - 3600000 }); view.update(props); await settle();
  assert.equal(calls.length, before, 'a stale request does nothing');
});

test('a prefill request belongs to its command: choosing another command first discards it (review LOW)', async () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const schemaFor = path => ({ name: path.join(' '), description: '', arguments: [{ name: 'rig', required: true, variadic: false }], options: [], commands: [] });
  const api = { rigControl: async (c, req) => ({ schema: schemaFor(req.path || []) }) };
  const connection = { id: 'h', kind: 'ssh', name: 'H', host: 'h', root: '~' };
  const mk = initial => ({ connection, root: '~', inventory: { rigs: [], seats: [] }, onFile() {}, initial });
  let props = mk(undefined);
  const view = mountComponent('src/RigControl.tsx', 'default', props, { actualComponents: true, resolvedChildren: true, api, height: 600, rowHeight: 30,
    dependencies: { './TerminalPanel': { default: 'terminal-panel' }, './RigCommandResult': { default: 'rig-command-result' }, './openrig-command-index.json': { default: { entries: [] }, entries: [] } } });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); view.update(props); } };
  await settle();
  const src = fs.readFileSync('src/RigControl.tsx', 'utf8');
  assert.match(src, /wanted\.pathKey === pathKey/);
  assert.match(src, /const choose = \(next: string\[\]\) => \{\s*pendingRig\.current = undefined;/);
  props = mk({ path: ['snapshot', 'list'], rigId: 'r1', nonce: Date.now() }); view.update(props); await settle();
  assert.ok(view.nodes().some(n => n.type === 'input' && n.props.value === 'r1'), 'still prefilled for the requested command');
});
test('compare dialog: both panes use live status; Copy both waits for the second snapshot', () => {
  const ui = fs.readFileSync('src/SeatTranscript.tsx', 'utf8');
  assert.match(ui, /const liveSeat = others\.find\(\(o\) => o\.id === seat\.id\) \|\| seat/);
  assert.match(ui, /seat=\{other \? liveSeat : undefined\}/);
  assert.match(ui, /\(!!other && !second\.snapshot\)/);
});

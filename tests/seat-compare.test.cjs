const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('sc', module);
m._compile(buildSync({ entryPoints: ['src/seat-compare.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'sc.js');
const { compareCandidates, compareLabel, snapshotStats } = m.exports;
const mk = (id, name, rig = 'R', session = id + '@' + rig, pod) => ({ id, name, rigName: rig, session, pod });

test('candidates exclude the current seat and sessionless seats, sorted by rig then name', () => {
  const cur = mk('a', 'alpha');
  const list = [cur, mk('c', 'zed'), mk('b', 'beta', 'Q'), mk('d', 'delta', 'R', ''), mk('e', 'echo', 'R', null), mk('f', 'able')];
  assert.deepEqual(compareCandidates(list, cur).map(s => s.id), ['b', 'f', 'c']);
  assert.deepEqual(compareCandidates([], cur), []);
  assert.deepEqual(list.map(s => s.id), ['a', 'c', 'b', 'd', 'e', 'f'], 'input not mutated');
});
test('labels disambiguate rigs and pods; stats count lines and words', () => {
  assert.equal(compareLabel(mk('a', 'x', 'Rig', 's', 'Pod')), 'x (Rig · Pod)');
  assert.equal(compareLabel(mk('a', 'x', 'Rig')), 'x (Rig)');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshotStats('a b\nc\n\n'))), { lines: 2, words: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(snapshotStats('  \n '))), { lines: 0, words: 0 });
});
test('comparison stays read-only and reuses the reviewed transcript call for both seats', () => {
  const ui = fs.readFileSync('src/SeatTranscript.tsx', 'utf8');
  assert.equal((ui.match(/window\.hrig\b/g) || []).length, 1, 'one bridge call site');
  assert.match(ui, /window\.hrig\s*\.seatTranscript\(connection, seatId\)/);
  assert.doesNotMatch(ui, /rigAction|rigControl|sendMessage|seatMessage|<input|<textarea|seatPrompt\(/);
  assert.match(ui, /useSnapshot\(connection, other \? other\.id : null, revision\)/);
  assert.match(ui, /aria-label="Compare with another session"/);
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /others=\{freshSeats\(transcriptView\.connection\)\}/);
});
test('actual dialog: picker lists others, choosing one loads a second snapshot through the same IPC, nothing else is called', async () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const calls = [];
  const api = { seatTranscript: async (c, id) => { calls.push(id); return { text: `text of ${id}`, truncated: false, capturedAt: '2026-11-09T10:00:00Z' }; } };
  const cur = { ...mk('a', 'alpha'), status: 'working', activity: 'building', workCount: 2 };
  const others = [cur, mk('b', 'beta'), mk('c', 'gamma')];
  const props = { connection: { id: 'k', kind: 'local', name: 'L', root: '~' }, seat: cur, others, onClose() {} };
  const view = mountComponent('src/SeatTranscript.tsx', 'default', props, { actualComponents: true, resolvedChildren: true, api, height: 600, rowHeight: 20 });
  await Promise.resolve(); await Promise.resolve(); view.update(props);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['a']);
  const select = () => view.nodes().find(n => n.type === 'select' && n.props['aria-label'] === 'Compare with another session');
  assert.deepEqual(JSON.parse(JSON.stringify(select().props.children.flat().filter(Boolean).map(o => o.props.value))), ['', 'b', 'c']);
  select().props.onChange({ target: { value: 'b' } }); view.update(props);
  for (let i = 0; i < 6; i++) { await Promise.resolve(); view.update(props); }
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['a', 'b']);
  const text = view.nodes().filter(n => n.type === 'pre' || n.type === 'p').map(n => view.text(n)).join(' | ');
  assert.match(text, /text of a/); assert.match(text, /text of b/); assert.match(text, /Now: working/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('tv', module);
m._compile(buildSync({ entryPoints: ['src/task-view.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'tv.js');
const { searchTasks, groupTasks } = m.exports;
const T = [
  { id: 'q1', title: 'Fix login bug', destination: 'dev-a@hrig', status: 'pending' },
  { id: 'q2', title: 'Write docs', destination: 'dev-b@hrig', status: 'in-progress' },
  { id: 'q3', title: 'Release', destination: 'dev-a@hrig', status: 'failed' },
  { id: 'q4', title: 'Orphan', destination: '', status: 'blocked' },
  { id: 'q5', title: 'Odd', status: undefined },
];
const ids = l => l.map(x => x.id);

test('search matches title, owner, state and id; all terms must match; blank returns a copy', () => {
  assert.deepEqual(ids(searchTasks(T, 'LOGIN')), ['q1']);
  assert.deepEqual(ids(searchTasks(T, 'dev-a')), ['q1', 'q3']);
  assert.deepEqual(ids(searchTasks(T, 'dev-a failed')), ['q3']);
  assert.deepEqual(ids(searchTasks(T, 'in-progress')), ['q2']);
  assert.deepEqual(ids(searchTasks(T, 'q4')), ['q4']);
  assert.deepEqual(ids(searchTasks(T, 'nothing')), []);
  const all = searchTasks(T, '   '); assert.equal(all.length, 5); assert.notEqual(all, T);
  assert.doesNotThrow(() => searchTasks([{ title: { x: 1 } }], 'x'));
});
test('group by state keeps the fixed columns and sends unknown states to other', () => {
  const g = groupTasks(T, 'state');
  assert.deepEqual(g.map(x => x.key), ['pending', 'in-progress', 'blocked', 'other']);
  assert.deepEqual(ids(g[3].items), ['q3', 'q5']); assert.equal(g[3].label, 'Other states');
});
test('group by seat sorts names, puts Unassigned last, drops no tasks', () => {
  const g = groupTasks(T, 'seat');
  assert.deepEqual(g.map(x => x.label), ['dev-a@hrig', 'dev-b@hrig', 'Unassigned']);
  assert.equal(g.flatMap(x => x.items).length, T.length);
  assert.deepEqual(groupTasks([], 'seat'), []);
});
test('TaskBoard wiring: group select, search placeholder, existing filter label kept', () => {
  const s = fs.readFileSync('src/TaskBoard.tsx', 'utf8');
  assert.match(s, /aria-label="Group tasks by"/);
  assert.match(s, /aria-label="Filter tasks"/);
  assert.match(s, /searchTasks\(items \|\| \[\], filter\)/);
  assert.match(s, /groupTasks\(visible, groupBy\)/);
  assert.match(s, /stateFilter, groupBy\]/);
});

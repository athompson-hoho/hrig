const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const m = new Module('al', module);
m._compile(buildSync({ entryPoints: ['src/activity-log.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'al.js');
const { filterLog, formatLog, MAX_COPY_CHARS } = m.exports;
const e = (id, kind, text, time = '10:00:0' + id) => ({ id: String(id), kind, text, time });
const entries = [e(3, 'error', 'boom\nstack'), e(2, 'success', 'ok'), e(1, 'info', 'start \u001b[31mred')]; // newest first

test('filter keeps order and returns copies', () => {
  assert.deepEqual(filterLog(entries, 'all').map(x => x.id), ['3', '2', '1']);
  assert.notEqual(filterLog(entries, 'all'), entries);
  assert.deepEqual(filterLog(entries, 'error').map(x => x.id), ['3']);
  assert.deepEqual(filterLog(entries, 'info').map(x => x.id), ['1']);
  assert.deepEqual(filterLog([], 'error'), []);
});

test('copy text is oldest first, labelled, single-line per entry, control chars removed', () => {
  const r = formatLog(entries);
  assert.equal(r.count, 3); assert.equal(r.truncated, false);
  assert.deepEqual(r.text.split('\n'), ['[10:00:01] INFO start  [31mred', '[10:00:02] OK ok', '[10:00:03] ERROR boom ⏎ stack']);
  assert.ok(!/\u001b/.test(r.text));
  assert.deepEqual(formatLog([]), { text: '', count: 0, truncated: false });
});

test('very long logs keep the newest lines whole and say so', () => {
  const many = Array.from({ length: 6000 }, (_, i) => e(6000 - i, 'info', 'x'.repeat(60), 't' + (6000 - i))).map((x, i) => ({ ...x, id: String(6000 - i) }));
  const r = formatLog(many);
  assert.equal(r.truncated, true); assert.ok(r.text.length <= MAX_COPY_CHARS);
  assert.ok(r.text.endsWith('x'.repeat(60))); assert.match(r.text.split('\n')[0], /^\[t\d+\] INFO x{60}$/);
  assert.match(r.text.split('\n').at(-1), /^\[t6000\] INFO/, 'newest entry is last');
});

test('actual ActivityPanel: filter, counts, explicit copy of the shown entries only', async () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const written = [];
  const navigator = { clipboard: { writeText: async t => { written.push(t); } } };
  const view = mountComponent('src/RigPanels.tsx', 'ActivityPanel', { entries }, { actualComponents: true, resolvedChildren: true, height: 400, rowHeight: 20, globals: { navigator } });
  view.update({ entries });
  const select = () => view.nodes().find(n => n.type === 'select' && n.props['aria-label'] === 'Filter log entries');
  const copyBtn = () => view.nodes().find(n => n.type === 'button' && /Copy the shown entries/.test(n.props.title || ''));
  assert.equal(written.length, 0, 'nothing is copied automatically');
  assert.ok(view.nodes().some(n => n.props?.role === 'status' && /3 of 3 entries/.test(view.text(n))));
  select().props.onChange({ target: { value: 'error' } }); view.update({ entries });
  assert.ok(view.nodes().some(n => /1 of 3 entries/.test(view.text(n))));
  await copyBtn().props.onClick();
  assert.equal(written.length, 1); assert.equal(written[0], '[10:00:03] ERROR boom ⏎ stack');
});

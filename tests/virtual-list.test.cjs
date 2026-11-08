const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic', name: 'Synthetic', kind: 'ssh', host: 'fake.invalid' });
const matches = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({
  path: `/synthetic/結果-${i}.ts`, line: i + 1, text: `Synthetic match ${i} — λ`,
})));

function project(results = matches) {
  const calls = [], opened = [];
  const h = mountComponent('src/WorkbenchPanels.tsx', 'ProjectTools', {
    connection, root: '/synthetic', onFile: (...args) => opened.push(args),
    onChanged: () => calls.push(['changed']),
  }, { height: 330, rowHeight: 55, api: {
    edit: async (owner, request) => { calls.push(['edit', owner, request]); return results; },
  } });
  const rows = () => h.nodes().filter(n => n.type === 'button' &&
    n.children.some(child => child?.type === 'strong' && h.text(child).startsWith('/synthetic/')));
  const search = async () => {
    const input = h.nodes().find(n => n.props['aria-label'] === 'Project text search');
    h.event(input, 'onChange', { target: { value: 'Synthetic' } });
    const button = h.nodes().find(n => n.type === 'button' && h.text(n) === 'Search text');
    h.event(button, 'onClick'); await h.settle();
  };
  return { ...h, calls, opened, rows, search };
}

test('actual ProjectTools search and result activation preserve explicit original path and line', async () => {
  const h = project(Object.freeze([matches[0]]));
  assert.equal(h.rows().length, 0);
  assert.deepEqual(h.calls, []);
  await h.search();
  assert.equal(h.calls.length, 1, 'only explicit search performs edit');
  assert.equal(h.calls[0][2].op, 'searchText');
  assert.equal(h.calls[0][2].root, '/synthetic');
  assert.deepEqual(h.opened, []);
  assert.equal(h.rows().length, 1);
  h.event(h.rows()[0], 'onClick');
  assert.deepEqual(h.opened, [[matches[0].path, matches[0].line]], 'positive native callback control');
  h.unmount();
});

test('actual ProjectTools bounds 200 mounted results in a 330px viewport and opens first middle end identities', async () => {
  const h = project();
  await h.search();
  // With controlled 55px natural row heights, six intersecting rows plus four
  // overscan on either side is at most fourteen. Count mounted native buttons.
  assert.ok(h.rows().length > 0 && h.rows().length <= 14,
    `bounded mounted search rows: expected 1..14, got ${h.rows().length}`);
  h.event(h.rows()[0], 'onClick');
  assert.deepEqual(h.opened, [[matches[0].path, matches[0].line]]);
  const viewport = h.nodes().find(n => n.props['aria-label'] === 'Project search results');
  assert.ok(viewport, 'actual labelled viewport exists');
  for (const index of [100, 199]) {
    viewport.scrollTop = index * 55;
    h.event(viewport, 'onScroll');
    assert.ok(h.rows().length > 0 && h.rows().length <= 14);
    const row = h.rows().find(n => h.text(n).includes(`${matches[index].path}:${matches[index].line}`));
    assert.ok(row, `actual result ${index} is reachable`);
    assert.equal(h.calls.length, 1, 'scroll never searches or edits');
    assert.equal(h.opened.length, index === 100 ? 1 : 2, 'scroll never opens a result');
    h.event(row, 'onClick');
    assert.deepEqual(h.opened.at(-1), [matches[index].path, matches[index].line]);
  }
  assert.equal(matches.length, 200);
  assert.ok(Object.isFrozen(matches) && matches.every(Object.isFrozen));
  h.unmount();
});

test('actual ProjectTools completed zero search gives no-match guidance without a result action', async () => {
  const h = project(Object.freeze([]));
  await h.search();
  assert.equal(h.rows().length, 0);
  assert.deepEqual(h.opened, []);
  assert.ok(h.nodes().some(n => h.text(n).includes('No matching text found. Try another search.')),
    'completed empty search has the approved no-match guidance');
  assert.equal(h.calls.length, 1);
  h.unmount();
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic', name: 'Synthetic', kind: 'ssh', host: 'fake.invalid' });
const matches = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({
  path: `/synthetic/結果-${i}.ts`, line: i + 1, text: `Synthetic match ${i} — λ`,
})));

function project(results = matches, geometry = {}) {
  const calls = [], opened = [];
  const h = mountComponent('src/WorkbenchPanels.tsx', 'ProjectTools', {
    connection, root: '/synthetic', onFile: (...args) => opened.push(args),
    onChanged: () => calls.push(['changed']),
  }, { height: 330, rowHeight: 55, ...geometry, api: {
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
  return { ...h, calls, opened, rows, search, nextResults(value) { results = value; } };
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

test('actual ProjectTools duplicate occurrences keep distinct roots and current callbacks after requery and owner replacement', async () => {
  const duplicate = Object.freeze({ ...matches[0], text: 'Second occurrence' });
  const h = project(Object.freeze([matches[0], duplicate, ...matches.slice(2)]));
  await h.search();
  const oldRoots = h.rows().slice(0, 2);
  assert.notEqual(oldRoots[0], oldRoots[1], 'equal path/line occurrences have separate native roots');
  assert.ok(h.text(oldRoots[1]).includes('Second occurrence'));
  h.event(oldRoots[1], 'onClick');
  assert.deepEqual(h.opened, [[duplicate.path, duplicate.line]]);
  const viewport = h.nodes().find(n => n.props['aria-label'] === 'Project search results');
  viewport.scrollTop = 100 * 55; h.event(viewport, 'onScroll');
  h.nextResults(Object.freeze([matches[199], matches[100]]));
  await h.search();
  assert.equal(h.rows().length, 2);
  assert.ok(h.rows().every(n => !oldRoots.includes(n)), 'result generation replaces native identities');
  assert.equal(h.nodes().find(n => n.props['aria-label'] === 'Project search results').scrollTop, 0);
  h.event(h.rows()[0], 'onClick');
  assert.deepEqual(h.opened.at(-1), [matches[199].path, matches[199].line]);
  h.update({ root: '/other-synthetic-owner' });
  assert.equal(h.rows().length, 0, 'foreign-owner results are not presented as current');
  assert.equal(h.calls.length, 2, 'owner replacement does not search');
  h.nextResults(Object.freeze([matches[50]])); await h.search();
  assert.equal(h.calls.at(-1)[2].root, '/other-synthetic-owner');
  h.event(h.rows()[0], 'onClick');
  assert.deepEqual(h.opened.at(-1), [matches[50].path, matches[50].line]);
  h.unmount();
});

test('actual ProjectTools hidden viewport recovers and changed natural row heights update the bounded window', async () => {
  const h = project(matches, { height: 0 }); await h.search();
  assert.ok(h.rows().length > 0 && h.rows().length <= 5, 'hidden panel has a small initial range');
  const viewport = h.nodes().find(n => n.props['aria-label'] === 'Project search results');
  h.resize(viewport, 330);
  assert.equal(h.rows().length, 10, 'six intersecting rows plus four trailing overscan');
  const first = h.rows()[0];
  h.resize(first, 165);
  assert.equal(h.rows().length, 8, 'natural larger row reduces intersection instead of clipping its content');
  assert.equal(h.rows()[0], first, 'measurement retains keyed native root');
  assert.equal(first.props.style?.height, undefined, 'no guessed fixed content height');
  viewport.scrollTop = Number.MAX_SAFE_INTEGER; h.event(viewport, 'onScroll');
  const last = h.rows().find(n => h.text(n).includes(`${matches[199].path}:200`));
  assert.ok(last, 'last current result remains reachable after measurement');
  assert.ok(h.rows().length <= 14);
  assert.equal(h.calls.length, 1); assert.deepEqual(h.opened, []);
  h.event(last, 'onClick');
  assert.deepEqual(h.opened, [[matches[199].path, 200]]);
  h.unmount();
  assert.equal(h.observers.size, 0, 'actual row and viewport observers disconnect');
});

test('real pure geometry exports normalize empty one and nonfinite inputs without changing source', () => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/virtual-range.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  const { prefixOffsets, viewportRange, sparseRetainedIndices } = exports;
  const empty = viewportRange(prefixOffsets(Object.freeze([])), Infinity, NaN);
  assert.equal(empty.start, 0); assert.equal(empty.end, 0);
  const sizes = Object.freeze([NaN, 0, -5, Infinity, 12.5]);
  const offsets = prefixOffsets(sizes, 10);
  assert.deepEqual(Array.from(offsets), [0, 10, 20, 30, 40, 52.5]);
  const one = viewportRange(prefixOffsets(Object.freeze([12.5])), 900, 330);
  assert.equal(one.start, 0); assert.equal(one.end, 1); assert.equal(one.scrollTop, 0);
  assert.deepEqual(Array.from(sparseRetainedIndices(one)), [0]);
  assert.ok(Number.isNaN(sizes[0]) && sizes[3] === Infinity);
});

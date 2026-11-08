const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic', name: 'Synthetic', kind: 'ssh', host: 'fake.invalid' });
const matches = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({
  path: `/synthetic/結果-${i}.ts`, line: i + 1, text: `Synthetic match ${i} — λ`,
})));

test('actual named search viewport exposes a semantic region with reachable help', async () => {
  const h = project(Object.freeze([matches[0]]));
  await h.search();
  const list = h.nodes().find(n => n.props['aria-label'] === 'Project search results');
  assert.equal(list.props.role, 'region', 'the named viewport permits an accessible name');
  assert.equal(list.props.tabIndex, 0);
  const help = h.nodes().find(n => n.props.id === list.props['aria-describedby']);
  assert.ok(help && h.text(help).includes('Page'), 'viewport help resolves to actual navigation guidance');
  assert.equal(h.rows().length, 1);
  assert.deepEqual(h.opened, []);
  h.unmount();
});

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

// Task 2 uses the same real nested component renderer and controlled DOM. Events
// explicitly supply bubbling targets; the helper does not invent browser Tab.
function nativeList() {
  const calls = [];
  const rows = Object.freeze(Array.from({ length: 200 }, (_, id) => Object.freeze({ id })));
  const element = (type, props) => ({ type, props });
  const h = mountComponent('src/VirtualList.tsx', 'VirtualList', {
    rows, itemKey: row => `native-${row.id}`, label: 'Synthetic native actions', scopeKey: 'owner-a',
    estimateHeight: 55,
    renderRow: row => element('div', {
      'data-row-id': row.id,
      children: [0, 1].map(action => element('button', {
        disabled: row.id === 10 || (row.id === 9 && action === 1),
        'data-action': action, onClick: () => calls.push([row.id, action]),
        draggable: true, onDragStart: event => event.dataTransfer.setData('text/plain', `synthetic:${row.id}`),
        children: `Action ${row.id}/${action}`,
      })),
    }),
  }, { height: 330, rowHeight: 55 });
  const viewport = () => h.nodes().find(n => n.props['aria-label'] === 'Synthetic native actions');
  const mounted = () => h.nodes().filter(n => n.props['data-row-id'] != null);
  const row = id => mounted().find(n => n.props['data-row-id'] === id);
  const controls = id => row(id)?.children.filter(n => n.type === 'button') || [];
  const key = (value, target = viewport(), shiftKey = false) =>
    h.event(viewport(), 'onKeyDown', { key: value, target, shiftKey });
  const scroll = top => { viewport().scrollTop = top; h.event(viewport(), 'onScroll'); };
  const focus = node => { node.focus(); h.event(viewport(), 'onFocusCapture', { target: node }); };
  return { ...h, calls, rows, viewport, mounted, row, controls, key, scroll, focus };
}

test('actual viewport End Home Page and Arrow navigation mounts and focuses native controls without activation', () => {
  const h = nativeList();
  h.focus(h.viewport());
  assert.equal(h.key('End').defaultPrevented, true, 'viewport End handles local navigation');
  assert.equal(h.document.activeElement, h.controls(199)[0], 'End reaches last actual native action');
  for (const [key, id] of [['Home', 0], ['ArrowDown', 1], ['ArrowUp', 0], ['PageDown', 6], ['PageUp', 0]]) {
    h.focus(h.viewport());
    h.key(key);
    assert.equal(h.document.activeElement, h.controls(id)[0], `${key} reaches logical row ${id}`);
    assert.ok(h.mounted().length <= 16, 'visible + eight overscan + at most two extras');
  }
  const child = h.controls(0)[0];
  assert.equal(h.key('End', child).defaultPrevented, false, 'child native keys remain native');
  assert.equal(h.key('Enter', child).defaultPrevented, false);
  assert.equal(h.key(' ', child).defaultPrevented, false);
  assert.deepEqual(h.calls, []);
  h.event(child, 'onClick');
  assert.deepEqual(h.calls, [[0, 0]], 'positive explicit activation control');
  h.unmount();
});

test('actual viewport boundary Tab skips disabled rows and preserves within-row order and external exits', () => {
  const h = nativeList();
  const first = h.controls(0)[0], second = h.controls(0)[1];
  h.focus(first);
  assert.equal(h.key('Tab', first, true).defaultPrevented, false, 'true start leaves externally');
  assert.equal(h.key('Tab', first).defaultPrevented, false, 'native sibling order stays native');
  h.focus(second);
  assert.equal(h.key('Tab', second).defaultPrevented, false, 'mounted next native row needs no interception');
  const boundary = h.controls(9)[0];
  h.focus(boundary);
  assert.equal(h.key('Tab', boundary).defaultPrevented, true, 'window boundary reaches next enabled offscreen row');
  assert.equal(h.document.activeElement, h.controls(11)[0], 'disabled logical row is skipped');
  h.scroll(100 * 55);
  const backward = h.controls(96)[0];
  h.focus(backward);
  assert.equal(h.key('Tab', backward, true).defaultPrevented, true);
  assert.equal(h.document.activeElement, h.controls(95)[1], 'reverse boundary reaches last enabled control');
  h.focus(h.viewport()); h.key('End');
  const last = h.controls(199)[1]; h.focus(last);
  assert.equal(h.key('Tab', last).defaultPrevented, false, 'true end leaves externally');
  assert.deepEqual(h.calls, []);
  h.unmount();
});

test('actual viewport preserves top key and fractional within-row offset when preceding measurements change', () => {
  const h = nativeList();
  h.scroll(100 * 55 + 7.25);
  const preceding = h.row(96), anchor = h.row(100);
  h.resize(preceding, 110);
  assert.equal(h.viewport().scrollTop, 100 * 55 + 7.25 + 55,
    'changed preceding extent preserves key 100 and its 7.25px within-row offset');
  assert.equal(h.row(100), anchor);
  const observers = [...h.observers];
  h.resize(preceding, 110);
  assert.equal(h.viewport().scrollTop, 5562.25, 'identical size produces no repeated correction');
  assert.ok([...h.observers].every((observer, index) => observer === observers[index]) &&
    h.observers.size === observers.length, 'unchanged measurement does not rebuild observers');
  h.scroll(Number.MAX_SAFE_INTEGER);
  assert.ok(h.row(199), 'measured end remains reachable');
  assert.deepEqual(h.calls, []);
  h.unmount();
});

test('actual viewport retains distant focused and dragged native roots sparsely then releases both', () => {
  const h = nativeList();
  const focusedRoot = h.row(0), focused = h.controls(0)[1];
  const draggedRoot = h.row(1), dragged = h.controls(1)[0];
  h.focus(focused);
  const payload = [];
  const dataTransfer = { setData: (...args) => payload.push(args) };
  h.event(dragged, 'onDragStart', { dataTransfer });
  h.event(h.viewport(), 'onDragStartCapture', { target: dragged, dataTransfer });
  h.scroll(150 * 55);
  assert.ok(h.row(0) === focusedRoot, 'focused distant native root is retained');
  assert.ok(h.row(1) === draggedRoot, 'dragged distant native root is retained');
  assert.equal(h.document.activeElement, focused);
  assert.ok(h.mounted().length <= 16, 'retention adds at most two isolated rows');
  assert.deepEqual(payload, [['text/plain', 'synthetic:1']], 'consumer drag payload is preserved');
  const external = { type: 'button', focus() { h.document.activeElement = this; } };
  external.focus();
  h.event(h.viewport(), 'onBlurCapture', { target: focused, relatedTarget: external });
  assert.equal(h.row(0), undefined, 'blur releases old focused row');
  h.event(h.viewport(), 'onDragEndCapture', { target: dragged });
  assert.equal(h.row(1), undefined, 'drag end releases old dragged row');
  assert.ok(h.mounted().length <= 14);
  assert.deepEqual(h.calls, []);
  h.unmount();
});

test('actual viewport restores removed-row focus locally and does not steal modal focus', () => {
  const h = nativeList();
  const focused = h.controls(0)[0]; h.focus(focused);
  h.update({ rows: h.rows.slice(1) });
  assert.ok(h.document.activeElement === h.viewport(), 'removed focused row returns to labelled viewport');
  const next = h.controls(1)[0]; h.focus(next);
  const modalInput = { type: 'input' };
  h.document.activeElement = modalInput;
  h.update({ rows: h.rows.slice(2) });
  assert.equal(h.document.activeElement, modalInput, 'external modal retains current focus');
  assert.equal(h.key('End', modalInput).defaultPrevented, false);
  assert.deepEqual(h.calls, []);
  h.unmount();
});

test('actual viewport ignores obsolete observers after scope replacement and disconnects on unmount', () => {
  const h = nativeList();
  const old = h.row(0), previous = [...h.observers];
  h.update({ scopeKey: 'owner-b', rows: h.rows.slice(100) });
  assert.ok(!h.mounted().includes(old));
  for (const observer of previous) observer.callback([{ target: old, contentRect: { height: 900 } }]);
  h.flush();
  assert.equal(h.viewport().scrollTop, 0);
  assert.equal(h.mounted().length, 10);
  assert.ok(previous.every(observer => observer.targets.size === 0));
  h.unmount();
  assert.equal(h.observers.size, 0);
  assert.deepEqual(h.calls, []);
});

test('actual search native root is keyboard reachable without opening a result', async () => {
  const h = project(); await h.search();
  const viewport = h.nodes().find(n => n.props['aria-label'] === 'Project search results');
  viewport.focus();
  h.event(viewport, 'onKeyDown', { key: 'End' });
  assert.equal(h.document.activeElement, h.rows().find(n => h.text(n).includes(`${matches[199].path}:200`)));
  assert.deepEqual(h.opened, []);
  assert.equal(h.calls.length, 1);
  h.unmount();
});

test('actual viewport remeasures width and content extents and releases drag on drop without intercepting editing', () => {
  const h = nativeList();
  h.scroll(5507.25);
  const anchor = h.row(100), preceding = h.row(96);
  h.resize(preceding, 82.5, 300);
  assert.equal(h.viewport().scrollTop, 5534.75);
  h.resize(h.viewport(), 220, 300);
  assert.equal(h.row(100), anchor);
  h.resize(anchor, 110, 300);
  assert.equal(h.viewport().scrollTop, 5534.75, 'anchor content growth preserves within-row offset');
  assert.ok(h.mounted().length <= 16);
  const dragged = h.controls(100)[0];
  h.event(h.viewport(), 'onDragStartCapture', { target: dragged });
  h.scroll(8000);
  assert.equal(h.row(100), anchor);
  h.event(h.viewport(), 'onDropCapture', { target: h.viewport() });
  assert.equal(h.row(100), undefined);
  for (const type of ['input', 'textarea', 'select']) {
    const external = { type };
    assert.equal(h.key('End', external).defaultPrevented, false);
    assert.equal(h.key('Tab', external).defaultPrevented, false);
  }
  assert.deepEqual(h.calls, []);
  h.unmount();
});

test('actual scope replacement restores only focus still owned by the replaced viewport', () => {
  const h = nativeList();
  h.focus(h.controls(0)[0]);
  h.update({ scopeKey: 'replacement-owner' });
  assert.equal(h.document.activeElement, h.viewport());
  h.focus(h.controls(0)[0]);
  const modal = { type: 'input' };
  h.document.activeElement = modal;
  h.update({ scopeKey: 'third-owner' });
  assert.equal(h.document.activeElement, modal);
  assert.deepEqual(h.calls, []);
  h.unmount();
  assert.equal(h.observers.size, 0);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic-host', kind: 'ssh', name: 'Synthetic' });
const seat = (i, extra = {}) => Object.freeze({
  id: `seat-${i}`, name: `Seat ${String(i).padStart(4, '0')}`,
  rigId: 'rig-0', rigName: 'Rig 0', pod: 'Builders', runtime: 'codex',
  session: `synthetic-session-${i}`, status: 'running', ...extra,
});
function sidebar(items, rigs = [], overrides = {}, options = {}) {
  const calls = [];
  const props = {
    section: 'sessions', connection, root: '~',
    inventory: { rigs, seats: items, sampledAt: '2026-01-01T00:00:00Z' },
    inventoryError: '', busy: false, selectedRig: '', fileRevision: 0,
    pinnedSeats: [], pinsAvailable: true, collapsedPods: [], podsAvailable: true,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff',
      'onTogglePod', 'onToggleSeatPin'].map(name => [name, (...args) => calls.push([name, ...args])])),
    ...overrides,
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    height: 330, rowHeight: 55, actualComponents: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() {} },
    ...options,
  });
  return Object.assign(view, { calls });
}
const classNodes = (view, name) => view.nodes().filter(n => n.props.className?.split(' ').includes(name));
const seatRows = view => classNodes(view, 'session-row');
const disclosureRows = view => classNodes(view, 'pod-disclosure');
function sessionCount(view) {
  const heading = classNodes(view, 'section-label').find(n => view.text(n).startsWith('SESSIONS'));
  return Number(view.text(heading.children.find(n => n.props?.className === 'count')));
}
function assertDisclosureTargets(view) {
  const ids = view.nodes().map(n => n.props.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'mounted IDs remain unique');
  for (const disclosure of disclosureRows(view)) {
    for (const attr of ['aria-controls', 'aria-describedby']) {
      assert.equal(ids.filter(id => id === disclosure.props[attr]).length, 1, `${attr} resolves uniquely`);
    }
  }
}
function viewport(view, label) {
  return view.nodes().find(n => n.props.className?.split(' ').includes('virtual-list') && n.props['aria-label'] === label);
}
function scroll(view, node, top) {
  assert.ok(node, 'real labelled viewport is mounted');
  node.scrollTop = top;
  view.event(node, 'onScroll');
}

test('Sidebar huge pod mounts bounded rows with full count and exact middle/end actions', () => {
  const items = Object.freeze(Array.from({ length: 2000 }, (_, i) => seat(i)));
  const view = sidebar(items);
  assert.equal(sessionCount(view), 2000);
  assert.ok(seatRows(view).length <= 14, `mounted ${seatRows(view).length} seats; expected at most 14`);
  const list = viewport(view, 'Sessions');
  assert.ok(list);
  assert.ok(view.observers.size > 0, 'actual nested viewport observes geometry');
  assert.deepEqual(view.calls, []);
  for (const [top, original] of [[0, items[0]], [55055, items[1000]], [1e9, items[1999]]]) {
    scroll(view, list, top);
    assert.ok(seatRows(view).length <= 14);
    assertDisclosureTargets(view);
    const open = classNodes(view, 'seat-row').find(n => n.props.title.startsWith(`${original.name}@`));
    assert.ok(open, `source seat ${original.id} reachable`);
    const before = view.calls.length;
    view.event(open, 'onClick');
    assert.equal(view.calls.length, before + 1);
    assert.equal(view.calls.at(-1)[1], original);
    const dragEvent = { dataTransfer: { synthetic: true } };
    view.event(open, 'onDragStart', dragEvent);
    assert.equal(view.calls.at(-1)[0], 'onDrag');
    assert.equal(view.calls.at(-1)[2], original);
  }
  view.unmount();
  assert.equal(view.observers.size, 0);
});

test('Sidebar many tiny pods keep group shells and disclosures globally bounded', () => {
  const items = Object.freeze(Array.from({ length: 2000 }, (_, i) => seat(i, { pod: `Pod ${i}` })));
  const view = sidebar(items);
  assert.equal(sessionCount(view), 2000);
  assert.ok(disclosureRows(view).length <= 14,
    `mounted ${disclosureRows(view).length} disclosures; expected at most 14 globally`);
  for (const top of [0, 110000, 1e9]) {
    scroll(view, viewport(view, 'Sessions'), top);
    assert.ok(seatRows(view).length + disclosureRows(view).length <= 16);
    assert.ok(classNodes(view, 'pod-group').length <= 16);
    assertDisclosureTargets(view);
  }
  assert.deepEqual(view.calls, []);
  view.unmount();
});

test('Sidebar large rig list bounds actual rigs while keeping management and total outside', () => {
  const rigs = Object.freeze(Array.from({ length: 2000 }, (_, i) => Object.freeze({
    id: `rig-${i}`, name: `Rig ${i}`, status: 'running', nodeCount: i,
  })));
  const view = sidebar([], rigs, {}, { height: 136 });
  assert.ok(classNodes(view, 'rig-row').length <= 14,
    `mounted ${classNodes(view, 'rig-row').length} rig controls; expected at most 14`);
  const list = viewport(view, 'Rig list');
  assert.ok(list);
  for (const label of ['Manage rigs', 'All rigs']) {
    const control = classNodes(view, 'rig-row').find(n => view.text(n).startsWith(label));
    assert.ok(control);
    assert.equal(list.contains(control), false);
  }
  assert.ok(view.text(classNodes(view, 'rig-row').find(n => view.text(n).startsWith('All rigs'))).endsWith('2000'));
  scroll(view, list, 1e9);
  const last = classNodes(view, 'rig-row').find(n => view.text(n).startsWith('Rig 1999'));
  assert.ok(last);
  assert.deepEqual(view.calls, []);
  view.event(last, 'onClick');
  assert.deepEqual(view.calls, [['onRig', rigs[1999].id]]);
  view.unmount();
});

test('Sidebar positive native sibling actions and drag capture exact original seats', () => {
  const original = seat(0);
  const view = sidebar([original]);
  assert.equal(sessionCount(view), 1);
  assertDisclosureTargets(view);
  assert.deepEqual(view.calls, []);
  const open = classNodes(view, 'seat-row')[0];
  view.event(open, 'onClick');
  const pin = view.nodes().find(n => n.props['aria-label'] === `Pin session ${original.name} in ${original.rigName}`);
  view.event(pin, 'onClick');
  for (const title of [`Open ${original.name} beside current`, `Relaunch session ${original.name}`]) {
    const control = view.nodes().find(n => n.type === 'button' && n.props.title === title);
    assert.ok(control, 'actual native sibling action is mounted');
    assert.equal(control.props.disabled, false);
    view.event(control, 'onClick');
  }
  view.event(open, 'onDragStart', { dataTransfer: { synthetic: true } });
  assert.deepEqual(view.calls.slice(0, 4).map(c => c[0]), ['onSeat', 'onToggleSeatPin', 'onSeatBeside', 'onRelaunch']);
  for (const call of view.calls.slice(0, 4)) assert.equal(call[1], original);
  assert.equal(view.calls[4][2], original);
  view.unmount();
});

test('Sidebar real nested consumer keeps stale foreign guards and partial-session controls', () => {
  const original = seat(0, { session: null });
  const view = sidebar([original], [], { inventoryError: 'Synthetic disconnected', pinsAvailable: false, podsAvailable: false });
  assert.equal(sessionCount(view), 1);
  assert.ok(view.nodes().some(n => n.props.role === 'status' && view.text(n).includes('Stale inventory')));
  const open = classNodes(view, 'seat-row')[0];
  assert.equal(open.props.disabled, true);
  assert.equal(open.props.draggable, false);
  assert.equal(disclosureRows(view)[0].props.disabled, true);
  for (const control of view.nodes().filter(n => n.type === 'button' && /^(Pin session|Open Seat|Relaunch session)/.test(n.props['aria-label'] || ''))) {
    assert.equal(control.props.disabled, true);
  }
  assertDisclosureTargets(view);
  assert.deepEqual(view.calls, []);
  view.unmount();
});

test('Sidebar filter intersects running alias and retains truthful zero/empty guidance', () => {
  const view = sidebar([seat(0), seat(1, { status: 'working' }), seat(2, { status: 'idle' })]);
  const status = view.nodes().find(n => n.props['aria-label'] === 'Filter session status');
  view.event(status, 'onChange', { target: { value: 'working' } });
  assert.equal(sessionCount(view), 2);
  const query = view.nodes().find(n => n.props['aria-label'] === 'Filter sessions');
  view.event(query, 'onChange', { target: { value: 'unmatched synthetic query' } });
  assert.equal(sessionCount(view), 0);
  assert.equal(seatRows(view).length, 0);
  assert.ok(view.nodes().some(n => n.props.role === 'status' && view.text(n).includes('No matching sessions')));
  view.update({ inventory: { rigs: [], seats: [] }, busy: true });
  assert.ok(view.nodes().some(n => view.text(n) === 'Discovering seats…'));
  assert.deepEqual(view.calls, []);
  view.unmount();
});

test('Sidebar middle native siblings, keyboard boundaries and sparse retention preserve authority', () => {
  const items = Object.freeze(Array.from({ length: 2000 }, (_, i) => seat(i)));
  const view = sidebar(items);
  const list = viewport(view, 'Sessions');
  scroll(view, list, 55055);
  const original = items[1000];
  const open = classNodes(view, 'seat-row').find(n => n.props.title.startsWith(`${original.name}@`));
  assert.ok(open);
  for (const label of [`Pin session ${original.name} in ${original.rigName}`,
    `Open ${original.name} beside current`, `Relaunch session ${original.name}`]) {
    const button = view.nodes().find(n => n.type === 'button' && n.props['aria-label'] === label);
    assert.ok(button);
    view.event(button, 'onClick');
    assert.equal(view.calls.at(-1)[1], original);
  }
  const baseline = view.calls.length;
  open.focus();
  view.event(list, 'onFocusCapture', { target: open });
  view.event(list, 'onDragStartCapture', { target: open });
  scroll(view, list, 1e9);
  assert.ok(view.nodes().includes(open), 'same focused/dragged native root is retained');
  assert.ok(seatRows(view).length <= 16, 'sparse extras do not fill the intervening range');
  list.focus();
  view.event(list, 'onBlurCapture');
  view.event(list, 'onDragEndCapture');
  assert.ok(!view.nodes().includes(open));
  view.event(list, 'onKeyDown', { key: 'Home' });
  assert.equal(view.document.activeElement.props.className, 'pod-disclosure');
  list.focus();
  view.event(list, 'onKeyDown', { key: 'ArrowDown' });
  assert.ok(view.document.activeElement.props.title.startsWith(`${items[0].name}@`));
  list.focus();
  view.event(list, 'onKeyDown', { key: 'End' });
  assert.ok(view.document.activeElement.props.title.startsWith(`${items.at(-1).name}@`));
  const lastRow = seatRows(view).find(n => n.contains(view.document.activeElement));
  const lastAction = lastRow.children.at(-1);
  const tab = view.event(list, 'onKeyDown', { key: 'Tab', target: lastAction });
  assert.equal(tab.defaultPrevented, false, 'native Tab leaves the final row');
  assert.equal(view.calls.length, baseline, 'navigation adds no consumer action');
  view.unmount();
});

test('Sidebar resized hidden and replaced owner windows retain full counts and current callbacks', () => {
  const items = Object.freeze(Array.from({ length: 2000 }, (_, i) => seat(i, { pod: `Pod ${i}` })));
  const view = sidebar(items);
  let list = viewport(view, 'Sessions');
  view.resize(list, 0);
  assert.ok(seatRows(view).length + disclosureRows(view).length <= 5);
  view.resize(list, 165, 320);
  scroll(view, list, 1e9);
  assert.ok(seatRows(view).length + disclosureRows(view).length <= 12);
  assert.equal(sessionCount(view), 2000);
  assertDisclosureTargets(view);
  const replacement = seat(1999, { name: 'Current owner seat', pod: '' });
  view.update({ connection: { ...connection, host: 'synthetic-replacement' },
    inventory: { rigs: [], seats: [replacement] } });
  list = viewport(view, 'Sessions');
  assert.equal(sessionCount(view), 1);
  assert.equal(seatRows(view).length, 1);
  assert.equal(list.scrollTop, 0);
  assert.deepEqual(view.calls, []);
  view.event(classNodes(view, 'seat-row')[0], 'onClick');
  assert.equal(view.calls[0][1], replacement);
  view.unmount();
  assert.equal(view.observers.size, 0);
});

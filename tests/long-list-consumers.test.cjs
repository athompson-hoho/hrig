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

const rig = i => Object.freeze({ id: `rig-${i}`, name: `Rig ${i}`, status: 'running', nodeCount: 1 });
const task = (i, status = 'pending') => Object.freeze({ id: `task-${i}`, title: `Synthetic task ${i} — 長い題名`,
  destination: i % 2 ? 'Other@Rig 0' : 'Seat 0000@Rig 0', status });
const taskLabels = ['Pending tasks', 'In-progress tasks', 'Blocked tasks', 'Other-state tasks'];
function topology(rigs, seats) {
  const calls = [];
  const view = mountComponent('src/WorkbenchPanels.tsx', 'RigManager', {
    connection, root: '~', inventory: { rigs, seats },
    onSeat: s => calls.push(['onSeat', s]), onChanged: () => calls.push(['onChanged']),
    onDeleted: id => calls.push(['onDeleted', id]),
  }, { actualComponents: true, height: 360, rowHeight: 55,
    api: { rigAction: async (c, action) => { calls.push(['rigAction', c, { ...action }]); return []; } } });
  return Object.assign(view, { calls });
}
function board(initialItems, options = {}) {
  const calls = [], originalSeat = seat(0);
  let items = initialItems;
  const view = mountComponent('src/TaskBoard.tsx', 'default', {
    connection, rigName: 'Rig 0', seats: [originalSeat], onSeat: s => calls.push(['onSeat', s]),
  }, { actualComponents: true, height: 360, rowHeight: 55,
    api: {
      queue: async (c, scope) => { calls.push(['queue', c, scope]); if (options.error) throw new Error(options.error); return items; },
      rigAction: async (c, action) => { calls.push(['rigAction', c, { ...action }]); return { id: action.id, synthetic: true }; },
      sendMessage: async (...args) => { calls.push(['sendMessage', ...args]); },
    } });
  return Object.assign(view, { calls, originalSeat, replaceItems(next) { items = next; } });
}
function columnCounts(view) {
  return classNodes(view, 'task-column').map(column => {
    const heading = column.children.find(n => n.type === 'h4');
    return Number(view.text(heading.children.find(n => n.type === 'span')));
  });
}
function buttonText(view, text) { return view.nodes().find(n => n.type === 'button' && view.text(n) === text); }
function topologySeatButtons(view) {
  return view.nodes().filter(n => n.type === 'button' && n.parentElement?.props.className?.split(' ').includes('topology-seats'));
}
function navigateOnly(view, list) {
  assert.ok(list, 'real labelled production viewport exists');
  view.resize(list, 0);
  view.resize(list, 165, 320);
  scroll(view, list, 1e9);
  list.focus();
  view.event(list, 'onKeyDown', { key: 'Home' });
  list.focus();
  view.event(list, 'onKeyDown', { key: 'End' });
  view.event(list, 'onFocusCapture', { target: view.document.activeElement });
}

test('RigManager huge rig globally bounds seats and preserves first middle end originals', async () => {
  const items = Object.freeze(Array.from({ length: 2000 }, (_, i) => seat(i)));
  const view = topology([rig(0)], items);
  await view.settle();
  assert.deepEqual(view.calls, [['rigAction', connection, { op: 'specs' }]]);
  assert.ok(topologySeatButtons(view).length <= 15,
    `mounted ${topologySeatButtons(view).length} topology seats; expected at most 15`);
  const list = viewport(view, 'Rig topology');
  for (const [top, original] of [[0, items[0]], [55110, items[1000]], [1e9, items.at(-1)]]) {
    scroll(view, list, top);
    const button = topologySeatButtons(view).find(n => view.text(n).includes(original.name));
    assert.ok(button, `${original.id} reachable`);
    const before = view.calls.length;
    view.event(button, 'onClick');
    assert.equal(view.calls.length, before + 1);
    assert.equal(view.calls.at(-1)[1], original);
    assert.ok(topologySeatButtons(view).length <= 15);
  }
  const baseline = view.calls.slice();
  navigateOnly(view, list);
  assert.ok(topologySeatButtons(view).length <= 13);
  assert.deepEqual(view.calls, baseline, 'navigation adds no collection or action effect');
  view.unmount();
  assert.equal(view.observers.size, 0);
});

test('RigManager many rigs globally bounds headings actions and seats with exact review identity', async () => {
  const rigs = Object.freeze(Array.from({ length: 1000 }, (_, i) => rig(i)));
  const items = Object.freeze(rigs.map((r, i) => seat(i, { rigId: r.id, rigName: r.name })));
  const view = topology(rigs, items);
  await view.settle();
  const actions = () => {
    const seats = new Set(topologySeatButtons(view));
    return view.nodes().filter(n => n.type === 'button' &&
      (n.props.className === 'rig-topology-heading' || view.text(n).startsWith('Delete Rig ') || seats.has(n)));
  };
  assert.ok(actions().length <= 30, `mounted ${actions().length} topology actions; expected at most 30 globally`);
  const list = viewport(view, 'Rig topology');
  for (const i of [0, 500, 999]) {
    // End then Home/End exercises actual focus navigation independently of estimates.
    scroll(view, list, i === 999 ? 1e9 : i * 3 * 55);
    const heading = classNodes(view, 'rig-topology-heading').find(n => view.text(n).startsWith(rigs[i].name + 'running'));
    assert.ok(heading, `rig ${i} heading reachable`);
    view.event(heading, 'onClick');
    assert.equal(view.nodes().find(n => n.props['aria-label'] === 'Rig name').props.value, rigs[i].name);
    assert.equal(view.nodes().find(n => n.props.type === 'checkbox').props.checked, true);
    const seatButton = topologySeatButtons(view).find(n => view.text(n).includes(items[i].name));
    assert.ok(seatButton);
    view.event(seatButton, 'onClick');
    assert.equal(view.calls.at(-1)[1], items[i]);
    assert.ok(actions().length <= 30);
  }
  const baseline = view.calls.slice();
  view.event(buttonText(view, 'Delete Rig 999'), 'onClick');
  const review = view.nodes().find(n => n.type === 'delete-rig');
  assert.ok(review, 'existing review entry is selected, lifecycle not executed');
  assert.equal(review.props.rig, rigs[999]);
  assert.equal(review.props.seats.length, 1);
  assert.equal(review.props.seats[0], items[999]);
  assert.deepEqual(view.calls, baseline);
  assert.ok(view.nodes().filter(n => n.type === 'button' && view.text(n).startsWith('Delete Rig ')).every(n => n.props.disabled));
  view.event(review, 'onCancel');
  navigateOnly(view, list);
  assert.deepEqual(view.calls, baseline);
  view.unmount();
  assert.equal(view.observers.size, 0);
});

test('TaskBoard concentrated 1000 tasks bounds cards and inspects exact first middle end IDs only on click', async () => {
  const items = Object.freeze(Array.from({ length: 1000 }, (_, i) => task(i)));
  const view = board(items);
  await view.settle();
  assert.deepEqual(columnCounts(view), [1000, 0, 0, 0]);
  assert.deepEqual(view.calls, [['queue', connection, 'Rig 0']]);
  assert.deepEqual([...view.intervals.values()].map(t => t.delay), [15000]);
  assert.ok(classNodes(view, 'task-card').length <= 15,
    `mounted ${classNodes(view, 'task-card').length} task cards; expected at most 15`);
  const list = viewport(view, taskLabels[0]);
  for (const [top, original] of [[0, items[0]], [27500, items[500]], [1e9, items[999]]]) {
    scroll(view, list, top);
    const card = buttonText(view, original.title + original.destination + original.status);
    assert.ok(card, `${original.id} reachable`);
    const before = view.calls.length;
    view.event(card, 'onClick');
    await view.settle();
    assert.equal(view.calls.length, before + 1);
    assert.deepEqual(view.calls.at(-1), ['rigAction', connection, { op: 'taskShow', id: original.id }]);
    assert.ok(view.text(classNodes(view, 'modal-heading')[0]).endsWith(original.id));
    view.event(view.nodes().find(n => n.props['aria-label'] === 'Close dialog'), 'onClick');
    assert.ok(classNodes(view, 'task-card').length <= 15);
  }
  const baseline = view.calls.slice();
  navigateOnly(view, list);
  assert.deepEqual(view.calls, baseline);
  assert.deepEqual(columnCounts(view), [1000, 0, 0, 0]);
  view.unmount();
  assert.equal(view.intervals.size, 0);
  assert.equal(view.observers.size, 0);
  assert.ok([...view.listeners.values()].every(set => !set.size));
});

test('TaskBoard spread columns keep complete filtered counts and exact current row callbacks', async () => {
  const states = ['pending', 'in-progress', 'blocked', 'failed'];
  const items = Object.freeze(Array.from({ length: 1000 }, (_, i) => task(i, states[i % 4])));
  const view = board(items);
  await view.settle();
  assert.deepEqual(columnCounts(view), [250, 250, 250, 250]);
  assert.ok(classNodes(view, 'task-card').length <= 60,
    `mounted ${classNodes(view, 'task-card').length} spread task cards; expected at most 60`);
  for (const [index, label] of taskLabels.entries()) {
    const list = viewport(view, label);
    scroll(view, list, 1e9);
    const original = items[996 + index];
    view.event(buttonText(view, original.title + original.destination + original.status), 'onClick');
    await view.settle();
    assert.deepEqual(view.calls.at(-1), ['rigAction', connection, { op: 'taskShow', id: original.id }]);
    view.event(view.nodes().find(n => n.props['aria-label'] === 'Close dialog'), 'onClick');
  }
  const baseline = view.calls.slice();
  view.event(view.nodes().find(n => n.props['aria-label'] === 'Filter task owner'), 'onChange', { target: { value: 'Seat 0000@Rig 0' } });
  assert.deepEqual(columnCounts(view), [250, 0, 250, 0]);
  view.event(view.nodes().find(n => n.props['aria-label'] === 'Filter tasks'), 'onChange', { target: { value: 'TASK 99' } });
  assert.deepEqual(columnCounts(view), [2, 0, 3, 0]);
  view.event(view.nodes().find(n => n.props['aria-label'] === 'Filter task state'), 'onChange', { target: { value: 'blocked' } });
  assert.deepEqual(columnCounts(view), [0, 0, 3, 0]);
  assert.deepEqual(view.calls, baseline);
  view.event(view.nodes().find(n => n.props['aria-label'] === 'Filter tasks'), 'onChange', { target: { value: 'not present' } });
  assert.deepEqual(columnCounts(view), [0, 0, 0, 0]);
  assert.ok(view.nodes().some(n => n.props.role === 'status' && view.text(n).includes('No tasks match these filters')));
  view.event(buttonText(view, 'Clear filters'), 'onClick');
  assert.deepEqual(columnCounts(view), [250, 250, 250, 250]);
  view.unmount();
});

test('TaskBoard selected original survives background reorder refresh and navigation without activation', async () => {
  const items = Object.freeze(Array.from({ length: 1000 }, (_, i) => task(i)));
  const view = board(items);
  await view.settle();
  const original = items[0];
  view.event(buttonText(view, original.title + original.destination + original.status), 'onClick');
  await view.settle();
  const modalFocus = view.document.activeElement;
  view.replaceItems(Object.freeze([...items].reverse().map(i => Object.freeze({ ...i, title: `Replacement ${i.id}` }))));
  view.tickIntervals();
  await view.settle();
  const baseline = view.calls.slice();
  const list = viewport(view, taskLabels[0]);
  assert.ok(list, 'task background uses real viewport');
  scroll(view, list, 1e9);
  view.resize(list, 165, 320);
  assert.equal(view.document.activeElement, modalFocus, 'background geometry does not steal modal focus');
  assert.ok(view.text(classNodes(view, 'modal-heading')[0]).endsWith(original.id));
  assert.equal(view.nodes().find(n => n.props['aria-label'] === 'Task destination').props.value, original.destination);
  assert.deepEqual(view.calls, baseline);
  view.event(buttonText(view, 'Open owning seat '), 'onClick');
  assert.equal(view.calls.at(-1)[1], view.originalSeat);
  assert.equal(classNodes(view, 'modal').length, 0);
  view.unmount();
});

test('TaskBoard original explicit inspection and owner action remain connected on short lists', async () => {
  const original = task(0);
  const view = board([original]);
  assert.ok(view.nodes().some(n => view.text(n) === 'Loading…'));
  await view.settle();
  assert.deepEqual(columnCounts(view), [1, 0, 0, 0]);
  assert.equal(classNodes(view, 'task-card').length, 1);
  assert.equal(view.calls.length, 1);
  view.event(buttonText(view, original.title + original.destination + original.status), 'onClick');
  await view.settle();
  assert.deepEqual(view.calls.at(-1), ['rigAction', connection, { op: 'taskShow', id: original.id }]);
  view.event(buttonText(view, 'Open owning seat '), 'onClick');
  assert.equal(view.calls.at(-1)[1], view.originalSeat);
  view.unmount();
});

test('RigManager original heading seat and Delete review controls retain exact short-list identities', async () => {
  const originalRig = rig(0), originalSeat = seat(0);
  const view = topology([originalRig], [originalSeat]);
  await view.settle();
  assert.deepEqual(view.calls, [['rigAction', connection, { op: 'specs' }]]);
  view.event(classNodes(view, 'rig-topology-heading')[0], 'onClick');
  assert.equal(view.nodes().find(n => n.props['aria-label'] === 'Rig name').props.value, originalRig.name);
  assert.equal(view.nodes().find(n => n.props.type === 'checkbox').props.checked, true);
  view.event(topologySeatButtons(view)[0], 'onClick');
  assert.equal(view.calls.at(-1)[1], originalSeat);
  const baseline = view.calls.slice();
  view.event(buttonText(view, 'Delete Rig 0'), 'onClick');
  const review = view.nodes().find(n => n.type === 'delete-rig');
  assert.equal(review.props.rig, originalRig);
  assert.equal(review.props.seats[0], originalSeat);
  assert.deepEqual(view.calls, baseline, 'Delete enters existing review without lifecycle execution');
  view.event(review, 'onCancel');
  assert.equal(view.nodes().some(n => n.type === 'delete-rig'), false);
  view.unmount();
});

test('TaskBoard empty and failed queue preserve source messages and add no actions', async () => {
  const empty = board([]);
  await empty.settle();
  assert.ok(empty.nodes().some(n => empty.text(n) === 'Room for your next idea'));
  assert.equal(classNodes(empty, 'task-card').length, 0);
  assert.deepEqual(empty.calls, [['queue', connection, 'Rig 0']]);
  empty.unmount();
  const failed = board([], { error: 'Synthetic queue refusal' });
  await failed.settle();
  assert.ok(failed.nodes().some(n => failed.text(n) === 'Synthetic queue refusal'));
  assert.equal(classNodes(failed, 'task-card').length, 0);
  assert.deepEqual(failed.calls, [['queue', connection, 'Rig 0']]);
  failed.unmount();
});

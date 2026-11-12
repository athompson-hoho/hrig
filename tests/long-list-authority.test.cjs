const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic-authority', kind: 'ssh', name: 'Synthetic', host: 'fake.invalid' });
const seats = Object.freeze(Array.from({ length: 2000 }, (_, i) => Object.freeze({
  id: `seat-${i}`, name: `Seat ${String(i).padStart(4, '0')}`, rigId: 'rig-0', rigName: 'Rig 0',
  pod: 'Builders', status: 'running', runtime: 'codex', session: `synthetic-session-${i}`,
})));
const rigs = Object.freeze([Object.freeze({ id: 'rig-0', name: 'Rig 0', status: 'running', nodeCount: seats.length })]);
const matches = Object.freeze(Array.from({ length: 200 }, (_, i) => Object.freeze({
  path: `/synthetic/result-${i}.ts`, line: i + 1, text: `Synthetic match ${i}`,
})));
const tasks = Object.freeze(Array.from({ length: 1000 }, (_, i) => Object.freeze({
  id: `task-${i}`, title: `Synthetic task ${i}`, destination: 'Seat 0000@Rig 0', status: 'pending',
})));
const classNodes = (view, name) => view.nodes().filter(n => n.props.className?.split(' ').includes(name));
const button = (view, text) => view.nodes().find(n => n.type === 'button' && view.text(n) === text);

test('long-list navigation preserves explicit action authority', async () => {
  const effects = [], views = [];
  const record = (name, ...args) => effects.push([name, ...args]);
  // Unknown API access is recorded too: a new renderer operation cannot hide
  // behind an incomplete fake. No real transport, timer or host is invoked.
  const api = new Proxy({}, { get: (_, name) => async (...args) => {
    record(String(name), ...args.map(arg => arg && typeof arg === 'object' && arg !== connection ? { ...arg } : arg));
    if (name === 'edit') return matches;
    if (name === 'queue') return tasks;
    return [];
  } });
  const mount = (file, exported, props) => {
    const view = mountComponent(file, exported, props, { api, actualComponents: true, height: 330, rowHeight: 55,
      settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() {} } });
    views.push(view);
    return view;
  };
  try {
    const sidebar = mount('src/Sidebar.tsx', 'default', {
      section: 'sessions', connection, root: '/synthetic', inventory: { rigs, seats },
      inventoryError: '', busy: false, selectedRig: '', fileRevision: 0,
      pinnedSeats: [], pinsAvailable: true, collapsedPods: [], podsAvailable: true,
      ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs', 'onSeat',
        'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff', 'onTogglePod', 'onToggleSeatPin']
        .map(name => [name, (...args) => record(name, ...args)])),
    });
    const project = mount('src/WorkbenchPanels.tsx', 'ProjectTools', {
      connection, root: '/synthetic', onFile: (...args) => record('onFile', ...args), onChanged: () => record('onChanged'),
    });
    const manager = mount('src/WorkbenchPanels.tsx', 'RigManager', {
      connection, root: '/synthetic', inventory: { rigs, seats }, onSeat: s => record('onSeat', s),
      onChanged: () => record('onChanged'), onDeleted: id => record('onDeleted', id),
    });
    const board = mount('src/TaskBoard.tsx', 'default', {
      connection, rigName: 'Rig 0', seats: [seats[0]], onSeat: s => record('onSeat', s),
    });
    await Promise.all(views.map(view => view.settle()));
    assert.deepEqual(effects, [['rigAction', connection, { op: 'specs' }], ['queue', connection, 'Rig 0']],
      'only legitimate specs and queue collection occurs on mount');
    project.event(project.nodes().find(n => n.props['aria-label'] === 'Project text search'), 'onChange',
      { target: { value: 'Synthetic' } });
    project.event(button(project, 'Search text'), 'onClick');
    await project.settle();
    assert.equal(effects.length, 3);
    // Compared as plain data: the options object is made inside the App's own realm.
    assert.deepEqual(JSON.parse(JSON.stringify(effects[2])), JSON.parse(JSON.stringify(['edit', connection, { op: 'searchText', query: 'Synthetic', root: '/synthetic',
      // The search options of the build chain (regex and whole word), both off by default.
      options: { regex: false, wholeWord: false } }])));
    assert.deepEqual([...board.intervals.values()].map(timer => timer.delay), [15000], 'existing timer is inert');
    const baseline = effects.length;
    const scenarios = [
      { view: sidebar, label: 'Sessions', rows: () => classNodes(sidebar, 'session-row'), middle: 55055,
        last: () => classNodes(sidebar, 'seat-row').find(n => n.props.title.startsWith(`${seats.at(-1).name}@`)),
        expected: ['onSeat', seats.at(-1)] },
      { view: project, label: 'Project search results', rows: () => classNodes(project, 'search-results')[0].children.filter(n => n.type === 'button'), middle: 5500,
        last: () => button(project, `${matches.at(-1).path}:${matches.at(-1).line}${matches.at(-1).text}`),
        expected: ['onFile', matches.at(-1).path, matches.at(-1).line] },
      { view: manager, label: 'Rig topology', rows: () => classNodes(manager, 'topology-seats'), middle: 55110,
        last: () => manager.nodes().find(n => n.type === 'button' && n.parentElement?.props.className === 'topology-seats'
          && manager.text(n).includes(seats.at(-1).name)), expected: ['onSeat', seats.at(-1)] },
      { view: board, label: 'Pending tasks', rows: () => classNodes(board, 'task-card'), middle: 27500,
        last: () => button(board, `${tasks.at(-1).title}${tasks.at(-1).destination}${tasks.at(-1).status}`),
        expected: ['rigAction', connection, { op: 'taskShow', id: tasks.at(-1).id }] },
    ];
    const observations = [];
    const subject = { record, async navigate() {
      for (const scenario of scenarios) {
        const { view, label, rows } = scenario;
        const list = view.nodes().find(n => n.props['aria-label'] === label && classNodes(view, 'virtual-list').includes(n));
        assert.ok(list, `${label}: actual nested viewport`);
        const keys = () => rows().map(row => view.text(row));
        const first = keys();
        assert.ok(first.length > 0 && first.length <= 16, `${label}: bounded initial native rows`);
        const scroll = top => { list.scrollTop = top; view.event(list, 'onScroll'); };
        scroll(scenario.middle);
        const middle = keys();
        assert.notDeepEqual(middle, first, `${label}: real middle window changes visible identities`);
        scroll(1e9);
        assert.ok(scenario.last(), `${label}: last original is mounted`);
        assert.notDeepEqual(keys(), middle, `${label}: real end window changes visible identities`);
        view.resize(list, 0);
        view.resize(list, 165, 320);
        for (const key of ['Home', 'ArrowDown', 'PageDown', 'PageUp', 'End']) {
          list.focus(); view.event(list, 'onKeyDown', { key });
          assert.ok(list.contains(view.document.activeElement), `${label}: navigation focuses inside actual viewport`);
        }
        const retained = view.document.activeElement;
        view.event(list, 'onFocusCapture', { target: retained });
        // Capture bookkeeping alone; original native drag callback is an
        // explicit consumer action and is not falsely classified as automatic.
        view.event(list, 'onDragStartCapture', { target: retained });
        scroll(0);
        assert.ok(view.nodes().includes(retained), `${label}: sparse focus/drag retention keeps same native node`);
        assert.ok(rows().length <= 16, `${label}: sparse extras stay bounded`);
        list.focus(); view.event(list, 'onBlurCapture'); view.event(list, 'onDragEndCapture');
        assert.ok(!view.nodes().includes(retained), `${label}: retention releases`);
        scroll(1e9);
        assert.ok(scenario.last(), `${label}: last callback remains reachable after resize`);
        observations.push(label);
      }
      await Promise.all(views.map(view => view.settle()));
      return effects.slice(baseline);
    } };
    const marker = process.env.GSD_PROHIB_SUBJECT;
    const wrapped = marker ? require(path.resolve(marker))(subject) : subject;
    const added = await wrapped.navigate();
    assert.deepEqual([...added, ...effects.slice(baseline)], [], 'authority: navigation adds no consumer or host effects');
    assert.deepEqual(observations, scenarios.map(scenario => scenario.label), 'all four real consumer families executed');
    // One explicit original native click per consumer must invoke exactly its
    // intended callback, proving the absence checks do not use disconnected rows.
    for (const scenario of scenarios) {
      const before = effects.length;
      const control = scenario.last();
      assert.ok(control && !control.props.disabled);
      scenario.view.event(control, 'onClick');
      await scenario.view.settle();
      assert.equal(effects.length, before + 1, `${scenario.label}: one explicit effect`);
      assert.deepEqual(effects.at(-1), scenario.expected);
      if (scenario.expected[0] === 'onSeat') assert.equal(effects.at(-1)[1], seats.at(-1));
    }
  } finally {
    for (const view of views) {
      view.unmount();
      assert.equal(view.observers.size, 0);
      assert.equal(view.intervals.size, 0);
      assert.ok([...view.listeners.values()].every(listeners => listeners.size === 0));
    }
  }
});

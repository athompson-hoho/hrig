const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

test('actual Sidebar Files row displays its reported modified Git badge', async t => {
  const connection = Object.freeze({ id: 'synthetic-badges', name: 'Synthetic', kind: 'local', root: '/synthetic-project' });
  const directory = { name: 'src', path: 'src', directory: true };
  const leaf = { name: 'needle.ts', path: 'src/needle.ts', directory: false };
  const fileRequests = [], gitRequests = [], actions = [], forbidden = [];
  const props = {
    section: 'files', connection, root: connection.root, inventory: null, inventoryError: '',
    busy: false, selectedRig: '', fileRevision: 0, pinnedSeats: [], pinsAvailable: true,
    collapsedPods: [], podsAvailable: true,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs', 'onSeat',
      'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff', 'onTogglePod', 'onToggleSeatPin']
      .map(name => [name, (...args) => actions.push([name, ...args])])),
  };
  const api = new Proxy({ platform: 'linux',
    file(owner, request) {
      assert.equal(owner, connection);
      assert.equal(request.root, connection.root);
      assert.equal(request.op, 'list');
      assert.ok(['', 'src'].includes(request.path));
      fileRequests.push({ owner, request: { ...request } });
      return Promise.resolve(request.path ? [leaf] : [directory]);
    },
    git(owner, root) {
      assert.equal(owner, connection);
      assert.equal(root, connection.root);
      gitRequests.push({ owner, root });
      return Promise.resolve({ isRepository: true, root, projectPrefix: '', entries: [{ path: leaf.path, status: 'M' }] });
    },
  }, { get(target, name) {
    return name in target ? target[name] : (...args) => { forbidden.push([name, ...args]); return Promise.resolve(); };
  } });
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true, api,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() { forbidden.push(['settings']); } },
  });
  t.after(() => view.unmount());
  const row = path => view.nodes().find(n => n.type === 'button' && n.props.className?.split(' ').includes('file-row') &&
    (n.props.title === path || n.props.title?.startsWith(path + ' —')));
  await view.settle();
  assert.ok(row('src'), 'actual Sidebar Files renders the listed directory');
  view.event(row('src'), 'onClick');
  await view.settle();
  const actualLeaf = row(leaf.path);
  assert.ok(actualLeaf, 'actual preexisting FileExplorer renders the explicitly expanded real leaf');
  assert.ok(view.text(actualLeaf).includes('needle.ts'), 'positive actual leaf content');
  assert.equal(fileRequests.length, 2);
  assert.deepEqual(actions, []);
  assert.deepEqual(forbidden, []);
  t.diagnostic('Positive setup: actual Sidebar Files expanded src and rendered src/needle.ts using two inert directory reads; no forbidden effects.');
  assert.ok(view.nodes().some(n => n.type === 'span' && actualLeaf.contains(n) && view.text(n) === 'M'),
    'the actual listed file row must display its reported modified Git badge M');
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const base = { id: 'owner', kind: 'local', name: 'Synthetic', root: '/project', host: 'host', port: 22, distro: 'Distro', rigBinary: 'rig' };
const leaf = { name: 'needle.ts', path: 'src/needle.ts', directory: false };
const dir = { name: 'src', path: 'src', directory: true };
const response = (entries = [{ path: leaf.path, status: 'M' }], projectPrefix = '') => ({ root: '/canonical', isRepository: true, projectPrefix, entries });
function mount({ handleGit = () => response(), before } = {}) {
  const gitRequests = [], fileRequests = [], forbidden = [], actions = [];
  const api = new Proxy({ platform: 'linux', git(owner, root) {
    gitRequests.push({ owner, root }); return Promise.resolve().then(() => handleGit(owner, root, gitRequests.length));
  }, file(owner, req) {
    assert.ok(['list', 'search'].includes(req.op));
    fileRequests.push({ owner, req });
    return Promise.resolve(req.op === 'search' || req.path ? [leaf] : [dir]);
  } }, { get: (target, key) => key in target ? target[key] : (...args) => { forbidden.push([key, ...args]); return Promise.resolve(); } });
  const props = { connection: { ...base }, root: '/project', refresh: 0, activeFile: { connection: { ...base }, root: '/project', path: leaf.path }, onFile: p => actions.push(p) };
  const view = mountComponent('src/FileExplorer.tsx', 'default', props, { api,
    ...(before ? { root({ react, load }) { const Explorer = load('src/FileExplorer.tsx').default;
      return function Boundary(current) { react.useEffect(() => before(current), [current.connection, current.root, current.refresh]); return react.createElement(Explorer, current); };
    } } : {}),
  });
  return Object.assign(view, { gitRequests, fileRequests, forbidden, actions, props });
}
const row = (v, p) => v.nodes().find(n => n.type === 'button' && n.props.className?.split(' ').includes('file-row') && n.props.title?.split(' —')[0] === p);
const button = (v, name) => v.nodes().find(n => n.type === 'button' && (n.props['aria-label'] === name || v.text(n) === name));
const input = v => v.nodes().find(n => n.type === 'input');
const text = v => v.nodes().map(n => v.text(n)).join('\n');
const badge = (v, p, letter) => { const r = row(v, p); return !!r && v.nodes().some(n => r.contains(n) && n.props.className === 'git-badge' && v.text(n) === letter); };
const assertSafe = v => { assert.deepEqual(v.forbidden, []); assert.deepEqual(v.actions, []); assert.equal(v.intervals.size, 0); };
const query = async (v, value) => { v.event(input(v), 'onChange', { target: { value } }); v.advanceTime(200); await v.settle(); };

test('actual shared rows retain badges through filter Clear expansion and Reveal without Git refetch', async t => {
  const v = mount(); t.after(() => v.unmount()); await v.settle();
  assert.equal(v.gitRequests.length, 1);
  assert.match(row(v, 'src').props['aria-label'], /Reported descendant statuses: M 1/);
  v.event(row(v, 'src'), 'onClick'); await v.settle();
  assert.ok(badge(v, leaf.path, 'M'));
  await query(v, 'needle'); assert.ok(badge(v, leaf.path, 'M'));
  v.event(button(v, 'Clear file filter'), 'onClick'); await v.settle();
  assert.ok(badge(v, leaf.path, 'M'));
  v.event(button(v, 'Reveal active file'), 'onClick'); await v.settle();
  assert.ok(badge(v, leaf.path, 'M'));
  assert.match(text(v), /Revealed src\/needle.ts/);
  assert.equal(v.gitRequests.length, 1);
  assertSafe(v);
});

test('actual root disclosure preserves missing deleted and aggregate records as non-opening text', async t => {
  const v = mount({ handleGit: () => response([{ path: 'src/gone', status: 'D' }, { path: 'src/', status: '??' }, { path: 'dest', status: 'RM' }]) });
  t.after(() => v.unmount()); await v.settle();
  assert.match(text(v), /Git reported 3 status records/);
  const details = v.nodes().find(n => n.type === 'details');
  assert.equal(details.props.open, false);
  assert.equal(v.nodes().filter(n => n.type === 'li').length, 0);
  v.event(details, 'onToggle', { currentTarget: { open: true } });
  const items = v.nodes().filter(n => n.type === 'li');
  assert.equal(items.length, 3);
  assert.ok(items.every(n => !n.props.onClick));
  assert.match(text(v), /src\/gone — Deleted \(Git code: D\). Reported path; no file-open action./);
  assert.match(text(v), /Untracked directory; contents not individually reported/);
  assert.match(text(v), /Renamed; destination only; Modified/);
  v.event(row(v, 'src'), 'onClick'); await v.settle();
  assert.equal(badge(v, leaf.path, '?'), false, 'directory aggregates never infer child status');
  v.event(v.nodes().find(n => n.type === 'details'), 'onToggle', { currentTarget: { open: false } });
  assert.equal(v.nodes().filter(n => n.type === 'li').length, 0);
  assertSafe(v);
});

for (const [name, change] of Object.entries({ id: { connection: { ...base, id: 'new' } }, kind: { connection: { ...base, kind: 'ssh' } }, host: { connection: { ...base, host: 'new' } }, port: { connection: { ...base, port: 2222 } }, distro: { connection: { ...base, distro: 'new' } }, rigBinary: { connection: { ...base, rigBinary: 'new' } }, root: { root: '/new' }, refresh: { refresh: 1 } })) {
  test(`actual Git ${name} replacement hides old records and rejects reversed success/error with fresh recovery`, async t => {
    const pending = [];
    const v = mount({ handleGit: () => { const d = deferred(); pending.push(d); return d.promise; } });
    t.after(() => v.unmount()); await v.settle();
    pending[0].resolve(response()); await v.settle();
    assert.match(text(v), /Git reported 1 status records/);
    v.update(change);
    assert.match(text(v), /Checking Git status/);
    assert.doesNotMatch(text(v), /Git reported 1 status records/);
    await v.settle();
    assert.equal(v.gitRequests.length, 2);
    v.update({ refresh: 2 }); await v.settle();
    pending[2].resolve(response([{ path: leaf.path, status: 'A' }])); await v.settle();
    pending[1].resolve(response([{ path: 'obsolete', status: 'D' }])); await v.settle();
    assert.match(row(v, 'src').props['aria-label'], /A 1/);
    assert.doesNotMatch(text(v), /obsolete/);
    v.update({ refresh: 3 }); await v.settle();
    v.update({ refresh: 4 }); await v.settle();
    pending[4].resolve(response()); await v.settle();
    pending[3].reject(new Error('obsolete private error')); await v.settle();
    assert.match(text(v), /Git reported 1 status records/);
    assert.doesNotMatch(text(v), /obsolete private error|unavailable/);
    assertSafe(v);
  });
}

test('actual Git checking failures malformed nonrepository and Retry preserve navigation and recover once', async t => {
  const pending = [];
  const v = mount({ handleGit: () => { const d = deferred(); pending.push(d); return d.promise; } });
  t.after(() => v.unmount()); await v.settle();
  assert.ok(v.nodes().some(n => n.props['aria-busy'] === true && v.text(n).includes('Checking Git status')));
  await query(v, 'needle');
  pending[0].reject(new Error('private backend stack')); await v.settle();
  assert.match(text(v), /Git status is unavailable for this project. Retry Git status./);
  assert.doesNotMatch(text(v), /private backend stack/);
  const retry = () => v.event(button(v, 'Retry Git status'), 'onClick');
  retry(); assert.match(text(v), /Checking Git status/); await v.settle();
  pending[1].resolve({ ...response(), projectPrefix: undefined }); await v.settle();
  assert.match(text(v), /unavailable/);
  retry(); await v.settle(); pending[2].resolve({ isRepository: false }); await v.settle();
  assert.match(text(v), /This project is not in a Git repository./);
  retry(); await v.settle(); pending[3].resolve(response([])); await v.settle();
  assert.match(text(v), /No reported Git changes in this project./);
  assert.equal(v.nodes().filter(n => n.type === 'details').length, 0);
  assert.equal(v.gitRequests.length, 4);
  assertSafe(v);
});

test('actual Git unmount rejects both success and error without any later state update', async () => {
  for (const error of [false, true]) {
    const d = deferred(), v = mount({ handleGit: () => d.promise }); await v.settle();
    v.unmount(); const before = v.observations.stateUpdates;
    if (error) d.reject(new Error('obsolete')); else d.resolve(response());
    await v.settle(); assert.equal(v.observations.stateUpdates, before); assertSafe(v);
  }
});

test('actual Git owner replacement hides success before child effects and retained Retry refuses every raw repoint', async () => {
  for (const slot of ['id', 'kind', 'host', 'port', 'distro', 'rigBinary', 'root', 'refresh']) {
    let inspect = () => {}, calls = 0;
    const v = mount({ before: () => inspect(), handleGit: () => ++calls === 1 ? Promise.reject(new Error('synthetic')) : response() });
    await v.settle();
    const oldRetry = button(v, 'Retry Git status').props.onClick;
    const change = slot === 'root' ? { root: '/new' } : slot === 'refresh' ? { refresh: 1 } : { connection: { ...base, [slot]: slot === 'port' ? 2222 : slot === 'kind' ? 'ssh' : 'new' } };
    let checked = false;
    inspect = () => {
      checked = true;
      assert.match(text(v), /Checking Git status/);
      assert.doesNotMatch(text(v), /unavailable|Reported Git paths/);
      const updates = v.observations.stateUpdates;
      oldRetry();
      assert.equal(v.observations.stateUpdates, updates, `${slot}: retained retry refuses before cleanup`);
    };
    v.update(change); assert.equal(checked, true);
    await v.settle(); assert.match(text(v), /Git reported 1 status records/);
    assert.equal(v.gitRequests.length, 2);
    inspect = () => { assert.match(text(v), /Checking Git status/); assert.doesNotMatch(text(v), /Git reported 1|Reported Git paths/); };
    v.update({ refresh: 2 }); await v.settle(); assert.match(text(v), /Git reported 1 status records/);
    assertSafe(v); v.unmount();
  }
});

test('actual Files validates all projected records before zero and preserves exact nested and covering scope', async () => {
  const cases = [
    [response([{ path: 'outside/../bad', status: 'M' }], 'nested/'), 'unavailable'],
    [response([{ path: 'outside', status: 'UNKNOWN' }], 'nested/'), 'unavailable'],
    [response([{ path: 'x', status: 'toString' }]), 'unavailable'],
    [response([{ path: 'x', status: 'M' }, { path: 'x', status: 'A' }]), 'unavailable'],
    [response([{ path: 'nested-other/x', status: 'M' }], 'nested/'), 'No reported Git changes in this project.'],
    [response([{ path: 'parent/', status: '??' }], 'parent/nested/'), 'Git reported 1 status records'],
    [response([{ path: ' nested /src/needle.ts', status: 'AD' }, { path: ' nested /src/needle.ts', status: 'AD' }], ' nested /'), 'Git reported 1 status records'],
    [null, 'unavailable'],
  ];
  for (const [data, expected] of cases) {
    const v = mount({ handleGit: () => data }); await v.settle();
    assert.ok(text(v).includes(expected), expected);
    const details = v.nodes().find(n => n.type === 'details');
    if (details) {
      v.event(details, 'onToggle', { currentTarget: { open: true } });
      if (data.projectPrefix === 'parent/nested/') {
        assert.match(text(v), /Reported untracked ancestor directory: parent\//);
        assert.doesNotMatch(row(v, 'src').props['aria-label'], /Reported descendant/);
      } else assert.match(text(v), /src\/needle.ts — Added; Deleted \(Git code: AD\)/);
    }
    assertSafe(v); v.unmount();
  }
});

test('actual reported paths retain every source meaning and conflict description in deterministic root counts', async t => {
  const cases = [
    ['M', 'Modified'], ['A', 'Added'], ['D', 'Deleted'], ['??', 'Untracked'],
    ['R', 'Renamed; destination only'], ['C', 'Copied; destination only'], ['T', 'Type changed'],
    ['AD', 'Added; Deleted'], ['RM', 'Renamed; destination only; Modified'],
    ['DD', 'Conflict: both deleted'], ['AU', 'Conflict: added by us'], ['UD', 'Conflict: deleted by them'],
    ['UA', 'Conflict: added by them'], ['DU', 'Conflict: deleted by us'], ['AA', 'Conflict: both added'], ['UU', 'Conflict: both modified'],
  ];
  const v = mount({ handleGit: () => response(cases.map(([status], i) => ({ status, path: `src/item${i}` }))) });
  t.after(() => v.unmount()); await v.settle();
  v.event(v.nodes().find(n => n.type === 'details'), 'onToggle', { currentTarget: { open: true } });
  for (const [[status, description], i] of cases.map((c, i) => [c, i]))
    assert.ok(text(v).includes(`src/item${i} — ${description} (Git code: ${status}).`));
  assert.match(row(v, 'src').props['aria-label'], /M 12; A 1; D 2; \? 1/);
  assertSafe(v);
});

test('aggregate badge accessible cues retain conflict and combined-status meanings', async t => {
  const v = mount({ handleGit: () => response([
    { path: 'src/conflict.ts', status: 'UU' },
    { path: 'src/combined.ts', status: 'AD' },
  ]) });
  t.after(() => v.unmount());
  await v.settle();
  const folder = row(v, 'src');
  assert.ok(folder, 'actual represented directory exists');
  assert.match(folder.props['aria-label'], /M 1; D 1/);
  assert.match(folder.props['aria-label'], /Conflict: both modified/);
  assert.match(folder.props['aria-label'], /Added; Deleted/);
  const rootCounts = v.nodes().find(n => n.props['aria-label']?.startsWith('Reported descendant statuses:'));
  assert.ok(rootCounts, 'actual root aggregate exists');
  assert.equal(rootCounts.props.role, 'group', 'descriptive root aggregate is a nameable group');
  assert.match(rootCounts.props['aria-label'], /Conflict: both modified/);
  assert.match(rootCounts.props['aria-label'], /Added; Deleted/);
  assert.match(rootCounts.props['aria-label'], /Git code: AD/);
  assert.equal(v.gitRequests.length, 1);
  assertSafe(v);
});

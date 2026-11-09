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

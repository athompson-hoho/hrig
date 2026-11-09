const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic-files', name: 'Synthetic', kind: 'local', root: '/synthetic-project' });
const root = connection.root;
const directory = Object.freeze({ name: 'src', path: 'src', directory: true });
const leaf = Object.freeze({ name: 'needle.ts', path: 'src/needle.ts', directory: false });

function mountFiles() {
  const requests = [], actions = [];
  const props = {
    section: 'files', connection, root, inventory: null, inventoryError: '',
    busy: false, selectedRig: '', fileRevision: 0,
    pinnedSeats: [], pinsAvailable: true, collapsedPods: [], podsAvailable: true,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs',
      'onSeat', 'onSeatBeside', 'onRelaunch', 'onDrag', 'onFile', 'onDiff',
      'onTogglePod', 'onToggleSeatPin'].map(name => [name, (...args) => actions.push([name, ...args])])),
  };
  const view = mountComponent('src/Sidebar.tsx', 'default', props, {
    actualComponents: true,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() {} },
    api: { platform: 'linux', file(owner, request) {
      requests.push({ owner, request: { ...request } });
      assert.equal(owner, connection, 'requests retain the supplied synthetic owner');
      assert.equal(request.root, root);
      if (request.op === 'list') {
        assert.ok(['', 'src'].includes(request.path), 'only explicitly expanded directories are listed');
        return Promise.resolve(request.path === '' ? [directory] : [leaf]);
      }
      assert.equal(request.op, 'search', 'only existing read-only list/search operations are permitted');
      assert.equal(request.path, '');
      assert.equal(request.query, 'src/needle');
      return Promise.resolve([leaf]);
    } },
  });
  return Object.assign(view, { requests, actions });
}

function fileRow(view, path) {
  return view.nodes().find(node => node.type === 'button' && node.props.title === path);
}

if (require.main === module) {
  test('Sidebar files ordinary lazy listing and explicit file click retain exact path', async (t) => {
    const view = mountFiles();
    t.after(() => view.unmount());
    await view.settle();
    assert.deepEqual(view.requests.map(({ request }) => request), [{ op: 'list', root, path: '' }]);
    assert.ok(fileRow(view, 'src'), 'existing Sidebar files branch renders the directory');
    assert.equal(fileRow(view, leaf.path), undefined, 'child stays lazy until explicit expansion');
    assert.deepEqual(view.actions, []);
    view.event(fileRow(view, 'src'), 'onClick');
    await view.settle();
    assert.ok(fileRow(view, leaf.path), 'actual nested FileTree renders the returned leaf');
    assert.deepEqual(view.requests.map(({ request }) => request), [
      { op: 'list', root, path: '' }, { op: 'list', root, path: 'src' },
    ]);
    assert.deepEqual(view.actions, []);
    view.event(fileRow(view, leaf.path), 'onClick');
    assert.deepEqual(view.actions, [['onFile', leaf.path]]);
  });

  test('Sidebar files filters descendants and Clear restores mounted manual expansion', async (t) => {
    const view = mountFiles();
    t.after(() => view.unmount());
    await view.settle();
    view.event(fileRow(view, 'src'), 'onClick');
    await view.settle();
    const normalLeaf = fileRow(view, leaf.path);
    assert.ok(normalLeaf, 'ordinary directory expansion works before the filter assertion');
    assert.deepEqual(view.actions, []);
    const input = view.nodes().find(node => node.type === 'input' && node.props['aria-label'] === 'Filter project files');
    assert.ok(input, 'Files section exposes the Filter project files control');
    view.event(input, 'onChange', { target: { value: '  src/needle  ' } });
    assert.equal(view.requests.filter(({ request }) => request.op === 'search').length, 0, 'search is debounced');
    view.advanceTime(199);
    assert.equal(view.requests.filter(({ request }) => request.op === 'search').length, 0);
    view.advanceTime(1);
    await view.settle();
    assert.equal(view.requests.filter(({ request }) => request.op === 'search').length, 1);
    assert.equal(view.requests.filter(({ request }) => request.op === 'list').length, 2, 'query never recursively lists');
    const hiddenTree = view.nodes().find(node => node.props.hidden === true && node.contains(normalLeaf));
    assert.ok(hiddenTree, 'same normal tree stays mounted hidden during search');
    assert.ok(view.nodes().some(node => node.type === 'button' && node.props.title === leaf.path && !hiddenTree.contains(node)),
      'descendant match is visible outside the hidden normal subtree');
    assert.deepEqual(view.actions, [], 'filtering never opens or changes editor state');
    const clear = view.nodes().find(node => node.type === 'button' && node.props['aria-label'] === 'Clear file filter');
    assert.ok(clear);
    view.event(clear, 'onClick');
    await view.settle();
    assert.equal(fileRow(view, leaf.path), normalLeaf, 'Clear retains the same manually expanded leaf');
    assert.ok(!view.nodes().some(node => node.props.hidden === true && node.contains(normalLeaf)));
    assert.equal(view.requests.length, 3, 'Clear sends neither search nor replacement listings');
    assert.deepEqual(view.actions, []);
    view.unmount();
    assert.equal(view.timeouts.size, 0, 'component cancels its pending debounce on unmount');
  });
}

module.exports = { mountFiles, fileRow, connection, root, leaf };

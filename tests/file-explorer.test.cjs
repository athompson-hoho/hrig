const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');

const connection = Object.freeze({ id: 'synthetic-files', name: 'Synthetic', kind: 'local', root: '/synthetic-project' });
const root = connection.root;
const directory = Object.freeze({ name: 'src', path: 'src', directory: true });
const leaf = Object.freeze({ name: 'needle.ts', path: 'src/needle.ts', directory: false });

const inertGit = (_owner, root) => ({ isRepository: true, root, projectPrefix: '', entries: [] });
function mountFiles({ handleGit = inertGit } = {}) {
  const requests = [], actions = [], gitRequests = [];
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
    api: { platform: 'linux', git(owner, root) {
      gitRequests.push({ owner, root });
      return Promise.resolve().then(() => handleGit(owner, root));
    }, file(owner, request) {
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
  return Object.assign(view, { requests, actions, gitRequests });
}

function fileRow(view, path) {
  return view.nodes().find(node => node.type === 'button' && node.props.title === path);
}

const entry = (path, directory = false) => Object.freeze({ name: path.split('/').at(-1), path, directory });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const input = view => view.nodes().find(n => n.props['aria-label'] === 'Filter project files');
const button = (view, label) => view.nodes().find(n => n.type === 'button' && (n.props['aria-label'] === label || view.text(n) === label));
const hasText = (view, text) => view.nodes().some(n => view.text(n).includes(text));
const visibleRows = view => view.nodes().filter(n => n.type === 'button' && n.props.className?.split(' ').includes('file-row') &&
  !view.nodes().some(parent => parent.props.hidden && parent.contains(n)));
function typeQuery(view, query) { view.event(input(view), 'onChange', { target: { value: query } }); }
async function searchFor(view, query) { typeQuery(view, query); view.advanceTime(200); await view.settle(); }
function mountScenario({ handle = (_owner, request) => request.op === 'search' ? [leaf] : request.path ? [leaf] : [directory],
  props: overrides = {}, platform = 'linux', beforeChildEffects, handleGit = inertGit } = {}) {
  const requests = [], actions = [], forbidden = [], gitRequests = [];
  const props = {
    section: 'files', connection, root, inventory: null, inventoryError: '', busy: false,
    selectedRig: '', fileRevision: 0, pinnedSeats: [], pinsAvailable: true, collapsedPods: [], podsAvailable: true,
    ...Object.fromEntries(['onRig', 'onRefresh', 'onProject', 'onConnect', 'onManageRigs', 'onSeat', 'onSeatBeside',
      'onRelaunch', 'onDrag', 'onFile', 'onDiff', 'onTogglePod', 'onToggleSeatPin'].map(name => [name, (...args) => actions.push([name, ...args])])),
    ...overrides,
  };
  const api = new Proxy({ platform, git(owner, root) {
    gitRequests.push({ owner, root });
    return Promise.resolve().then(() => handleGit(owner, root));
  }, file(owner, request) {
    assert.ok(['list', 'search'].includes(request.op), 'only existing read-only operations');
    assert.deepEqual(Object.keys(request).sort(), request.op === 'search' ? ['op', 'path', 'query', 'root'] : ['op', 'path', 'root']);
    requests.push({ owner, request: { ...request } });
    return Promise.resolve().then(() => handle(owner, request));
  } }, { get(target, name) {
    return name in target ? target[name] : (...args) => { forbidden.push([name, ...args]); return Promise.resolve(); };
  } });
  const view = mountComponent('src/Sidebar.tsx', 'default', props, { actualComponents: true, api,
    ...(beforeChildEffects ? { root({ react, load }) {
      const Sidebar = load('src/Sidebar.tsx').default;
      return function ActualSidebarBoundary(current) {
        // The parent effect queues before the nested Explorer cleanup in this harness.
        react.useEffect(() => beforeChildEffects(current), [current.connection, current.root, current.fileRevision, current.activeFile]);
        return react.createElement(Sidebar, current);
      };
    } } : {}),
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() { forbidden.push(['settings']); } } });
  return Object.assign(view, { requests, actions, forbidden, props, gitRequests });
}

function assertNavigationOnly(view) {
  assert.deepEqual(view.actions, [], 'filter/Reveal does not open, select, save, close or invoke Sidebar actions');
  assert.deepEqual(view.forbidden, [], 'no writes, host input, lifecycle, settings or other APIs');
  assert.equal(view.intervals.size, 0, 'no polling');
}

const listedRow = (view, path) => view.nodes().find(node =>
  node.props.className?.split(' ').includes('file-row') &&
  (node.props.title === path || node.props.title?.startsWith(path + ' —')));

if (require.main === module) {
  for (const name of ['x:y.ts', 'literal\\name.ts', 'line\nname.ts']) {
    test(`odd listing actual POSIX file remains represented: ${JSON.stringify(name)}`, async t => {
      const view = mountScenario({ handle: () => [entry('ordinary.ts'), entry(name)] });
      t.after(() => view.unmount()); await view.settle();
      assert.ok(listedRow(view, 'ordinary.ts'), 'ordinary actual FileTree sibling is represented');
      assertNavigationOnly(view);
      t.diagnostic('Positive setup: actual Sidebar Files completed its inert list and represented the ordinary sibling.');
      const odd = listedRow(view, name);
      assert.ok(odd, 'a legal POSIX file name must not silently disappear');
      assert.ok(view.text(odd).includes(name), 'the exact name remains rendered as text');
      if (!name.includes('\n')) {
        view.event(odd, 'onClick');
        assert.deepEqual(view.actions, [['onFile', name]], 'safe POSIX names open their exact captured identity');
      } else if (odd.props.disabled || typeof odd.props.onClick !== 'function') {
        assert.ok(view.text(odd).includes('cannot be opened here'), 'displayed refusal is explicit');
      }
    });
  }
  for (const name of ['x:y', 'literal\\folder']) {
    test(`odd listing actual POSIX directory retains descendants: ${JSON.stringify(name)}`, async t => {
      const child = `${name}/child.ts`;
      const view = mountScenario({ handle: (_owner, request) => {
        assert.equal(request.op, 'list');
        if (request.path === '') return [entry('ordinary.ts'), entry(name, true)];
        assert.equal(request.path, name, 'directory expansion preserves the exact literal path');
        return [entry(child)];
      } });
      t.after(() => view.unmount()); await view.settle();
      assert.ok(listedRow(view, 'ordinary.ts')); assertNavigationOnly(view);
      t.diagnostic('Positive setup: actual root listing rendered the ordinary sibling without effects.');
      const folder = listedRow(view, name);
      assert.ok(folder, 'legal named directory remains visible');
      view.event(folder, 'onClick'); await view.settle();
      const file = listedRow(view, child);
      assert.ok(file, 'the directory descendants retain their literal parent identity');
      view.event(file, 'onClick'); assert.deepEqual(view.actions, [['onFile', child]]);
    });
  }
  for (const name of ['file:stream', 'dir\\escape']) {
    test(`odd listing Windows unsafe entry is visible and non-actionable: ${JSON.stringify(name)}`, async t => {
      const windows = { ...connection, root: 'C:/Synthetic' };
      const view = mountScenario({ platform: 'win32', props: { connection: windows, root: windows.root },
        handle: (_owner, request) => { assert.equal(request.path, ''); return [entry('ordinary.ts'), entry(name)]; } });
      t.after(() => view.unmount()); await view.settle();
      const ordinary = listedRow(view, 'ordinary.ts'); assert.ok(ordinary);
      view.event(ordinary, 'onClick'); assert.deepEqual(view.actions, [['onFile', 'ordinary.ts']]);
      const requests = view.requests.length;
      t.diagnostic('Positive setup: actual Windows consumer lists and explicitly opens the ordinary captured sibling.');
      const odd = listedRow(view, name);
      assert.ok(odd, 'unsafe current-platform entry must be visible instead of silently removed');
      assert.ok(odd.props.disabled || typeof odd.props.onClick !== 'function', 'no active opening authority');
      assert.ok(view.text(odd).includes('cannot be opened here'), 'the refusal reason is visible');
      if (odd.props.onClick) odd.props.onClick();
      assert.deepEqual(view.actions, [['onFile', 'ordinary.ts']], 'retained invocation cannot bypass refusal');
      assert.equal(view.requests.length, requests, 'refused entry cannot expand or issue any file read');
      assert.deepEqual(view.forbidden, []);
    });
  }
  test('odd listing actual malformed or out-of-parent entries have an exact omission notice', async t => {
    const view = mountScenario({ handle: () => [entry('ordinary.ts'), entry('../escape'), entry('other/foreign.ts')] });
    t.after(() => view.unmount()); await view.settle();
    assert.ok(listedRow(view, 'ordinary.ts')); assertNavigationOnly(view);
    t.diagnostic('Positive setup: ordinary actual root row exists before checking returned-entry omissions.');
    assert.ok(hasText(view, '2 paths not shown'), 'known refused entries must be counted without inventing backend totals');
    assert.equal(listedRow(view, '../escape'), undefined);
    assert.equal(listedRow(view, 'other/foreign.ts'), undefined);
  });
  test('odd listing actual returned cap omissions are counted without hiding the shown rows', async t => {
    const view = mountScenario({ handle: () => Array.from({ length: 601 }, (_, i) => entry(`file${i}.ts`)) });
    t.after(() => view.unmount()); await view.settle();
    assert.equal(visibleRows(view).length, 600, 'the existing represented-row cap remains bounded');
    t.diagnostic('Positive setup: actual FileTree already represents its bounded 600 ordinary rows.');
    assert.ok(hasText(view, '1 paths not shown'), 'the known returned entry beyond the cap is disclosed');
    assertNavigationOnly(view);
  });
  test('odd composition actual Files filter Clear and explicit open retain the backend literal identity', async t => {
    const { localFiles } = require('./git-badges-api.test.cjs');
    const h = localFiles(root), opened = [], reads = [], operations = [];
    const view = mountScenario({
      handle: (owner, request) => {
        const operation = h.core.fileOperation(owner, request);
        operations.push(operation);
        return operation;
      },
      props: { onFile(path) {
        opened.push(path);
        reads.push(h.core.fileOperation(connection, { op: 'read', root, path }));
      } },
    });
    t.after(() => view.unmount()); await view.settle();
    assert.equal(operations.length, 1);
    await operations[0]; await view.settle();
    assert.ok(listedRow(view, 'ordinary.ts'), 'ordinary actual Sidebar listing positive');
    const normal = listedRow(view, 'literal\\name.ts'); assert.ok(normal);
    await searchFor(view, 'literal');
    assert.equal(operations.length, 2);
    await operations[1]; await view.settle();
    const filtered = visibleRows(view).find(n => n.props.title === 'literal\\name.ts');
    assert.ok(filtered, 'actual core search result retains the literal name through actual projection');
    assert.equal(visibleRows(view).some(n => n.props.title === 'literal' || n.props.title === 'literal/name.ts'), false,
      'no phantom directory or rewritten path appears');
    view.event(filtered, 'onClick');
    assert.deepEqual(opened, ['literal\\name.ts']);
    assert.equal((await reads[0]).content, 'synthetic:literal\\name.ts');
    const before = view.requests.length;
    view.event(button(view, 'Clear file filter'), 'onClick'); await view.settle();
    assert.equal(listedRow(view, 'literal\\name.ts'), normal, 'Clear retains the same mounted normal row');
    assert.equal(view.requests.length, before, 'Clear issues no replacement listings');
    assert.equal(view.gitRequests.length, 1, 'file navigation does not refetch Git');
    assert.deepEqual(view.forbidden, []);
    assert.deepEqual(h.calls.filter(([op]) => op === 'read'), [['read', root + '/literal\\name.ts']]);
    t.diagnostic('GREEN composition evidence: actual Sidebar/filter/Clear/open callback reached the actual contained core read with unchanged identity.');
  });
}

if (require.main === module) {
  test('Sidebar files ordinary lazy listing and explicit file click retain exact path', async (t) => {
    const view = mountFiles();
    t.after(() => view.unmount());
    await view.settle();
    assert.deepEqual(view.requests.map(({ request }) => request), [{ op: 'list', root, path: '' }]);
    assert.deepEqual(view.gitRequests, [{ owner: connection, root }], 'Git capture stays separate from file request ordering');
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
    assert.equal(view.gitRequests.length, 1, 'ordinary expansion and navigation do not refetch Git');
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
    assert.equal(view.gitRequests.length, 1, 'query and Clear leave the independent Git snapshot alone');
    assert.deepEqual(view.actions, []);
    view.unmount();
    assert.equal(view.timeouts.size, 0, 'component cancels its pending debounce on unmount');
  });

  test('Sidebar filter projects exact duplicate basenames with deterministic ancestor context and literal queries', async t => {
    const matches = Object.freeze([entry('z/same.ts'), entry('a/same.ts'), entry('a/same.ts'),
      entry('../unsafe.ts'), entry('/outside.ts'), entry('unused', true), entry('a/other.ts')]);
    const view = mountScenario({ handle: (_owner, r) => r.op === 'search' ? matches : [] });
    t.after(() => view.unmount());
    await view.settle();
    await searchFor(view, '  SAME[.]  ');
    assert.deepEqual(view.requests.map(r => r.request), [
      { op: 'list', root, path: '' }, { op: 'search', root, path: '', query: 'SAME[.]' },
    ]);
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['a/other.ts', 'a/same.ts', 'z/same.ts']);
    const contexts = view.nodes().filter(n => n.type === 'div' && n.props.className === 'file-row');
    assert.deepEqual(contexts.map(n => n.props.title), ['a', 'z']);
    assert.ok(contexts.every(n => !n.props.onClick), 'ancestors are presentation only');
    assert.ok(visibleRows(view).every(n => n.props['aria-label'] === n.props.title));
    assert.ok(hasText(view, '3 matching files in the searched scope.'));
    assertNavigationOnly(view);
    for (const path of ['a/same.ts', 'z/same.ts']) view.event(visibleRows(view).find(n => n.props.title === path), 'onClick');
    assert.deepEqual(view.actions, [['onFile', 'a/same.ts'], ['onFile', 'z/same.ts']]);
    assert.equal(matches.length, 7, 'projection did not mutate the supplied frozen result');
  });

  test('Sidebar filter zero one many and cap states disclose bounded scope and fixed recoverable errors', async t => {
    let result = [], fails = false;
    const view = mountScenario({ handle: (_owner, r) => {
      if (r.op === 'list') return [];
      if (fails) throw Error('PRIVATE synthetic stack <script>');
      return result;
    } });
    t.after(() => view.unmount());
    await view.settle();
    assert.ok(hasText(view, 'No files are available in this directory listing.'));
    assert.ok(hasText(view, 'Directory listings show up to 600 entries. Excluded paths may be omitted.'));
    assert.ok(hasText(view, 'Files only · up to 100 matches · up to 20,000 files searched. Excluded or unreadable paths may be omitted.'));
    assert.ok(hasText(view, 'Local search also stops at depth 25.'));
    await searchFor(view, 'zero');
    assert.ok(hasText(view, 'No matching files in the searched scope.'));
    assert.ok(hasText(view, 'Try another name or path, or clear the filter.'));
    assert.equal(view.nodes().filter(n => n.props.role === 'alert').length, 0);
    result = [entry('only.ts')];
    await searchFor(view, 'one');
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['only.ts']);
    assert.ok(hasText(view, '1 matching files in the searched scope.'));
    result = Array.from({ length: 105 }, (_, i) => entry(`branch${i}/same.ts`));
    await searchFor(view, 'cap');
    assert.equal(visibleRows(view).length, 100);
    assert.ok(hasText(view, 'First 100 matching files shown. More files may match.'));
    const oldClick = visibleRows(view)[0].props.onClick;
    fails = true;
    typeQuery(view, 'failure');
    assert.equal(visibleRows(view).length, 0, 'old results disappear during debounce');
    oldClick();
    assert.ok(hasText(view, 'Searching files…'));
    view.advanceTime(200); await view.settle();
    assert.ok(hasText(view, 'Could not search this project. Retry or clear the filter.'));
    assert.ok(!hasText(view, 'PRIVATE'));
    assert.equal(view.nodes().filter(n => n.props.role === 'alert').length, 1);
    const before = view.requests.length;
    view.advanceTime(10000); await view.settle();
    assert.equal(view.requests.length, before, 'failure never retries automatically');
    fails = false; result = [entry('fresh.ts')];
    view.event(button(view, 'Retry search'), 'onClick');
    view.advanceTime(200); await view.settle();
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['fresh.ts']);
    assertNavigationOnly(view);
    view.event(visibleRows(view)[0], 'onClick');
    assert.deepEqual(view.actions, [['onFile', 'fresh.ts']]);
  });

  test('Sidebar whitespace invalid and rapid queries remain bounded with one polite busy status', async t => {
    const pending = deferred();
    const view = mountScenario({ handle: (_owner, r) => r.op === 'search' ? pending.promise : [] });
    t.after(() => view.unmount());
    await view.settle();
    assert.equal(input(view).props.maxLength, 300);
    assert.equal(input(view).props.placeholder, 'Filter files by name or path…');
    typeQuery(view, '   '); view.advanceTime(200); await view.settle();
    assert.equal(view.requests.length, 1, 'whitespace sends no search');
    typeQuery(view, 'a'.repeat(301)); view.advanceTime(200); await view.settle();
    assert.equal(view.requests.length, 1, 'programmatic overlength input is refused');
    assert.ok(hasText(view, 'Could not search this project. Retry or clear the filter.'));
    for (const value of ['a', 'ab', 'abc']) { typeQuery(view, value); view.advanceTime(50); }
    assert.equal(view.timeouts.size, 1);
    view.advanceTime(150); await view.settle();
    assert.deepEqual(view.requests.at(-1).request, { op: 'search', root, path: '', query: 'abc' });
    const statuses = view.nodes().filter(n => n.props.role === 'status' && !n.props.className?.split(' ').includes('explorer-git'));
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].props['aria-live'], 'polite');
    assert.equal(statuses[0].props['aria-atomic'], 'true');
    assert.equal(statuses[0].props['aria-busy'], true);
    view.event(button(view, 'Clear file filter'), 'onClick');
    pending.resolve([entry('obsolete.ts')]); await view.settle();
    assert.equal(visibleRows(view).length, 0);
    assertNavigationOnly(view);
  });

  test('Sidebar reverse searches and retained controls reject obsolete query target refresh and unmount lifetimes', async t => {
    const pending = new Map();
    const view = mountScenario({ handle: (_owner, r) => r.op === 'search' ? pending.get(r.query).promise : [entry('normal.ts')] });
    t.after(() => view.unmount());
    await view.settle();
    const normalClick = fileRow(view, 'normal.ts').props.onClick;
    pending.set('old', deferred()); pending.set('new', deferred());
    await searchFor(view, 'old'); await searchFor(view, 'new');
    pending.get('new').resolve([entry('new.ts')]); await view.settle();
    pending.get('old').resolve([entry('old.ts')]); await view.settle();
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['new.ts']);
    normalClick();
    const staleRow = visibleRows(view)[0].props.onClick;
    const staleClear = button(view, 'Clear file filter').props.onClick;
    const staleInput = input(view).props.onChange;
    view.update({ activeFile: { connection, root, path: 'normal.ts' } });
    staleRow(); staleClear(); staleInput({ target: { value: 'obsolete' } });
    view.flush();
    assert.equal(input(view).props.value, 'new');
    view.update({ fileRevision: 1 });
    view.event(button(view, 'Clear file filter'), 'onClick'); await view.settle();
    normalClick(); staleRow();
    assertNavigationOnly(view);
    view.event(fileRow(view, 'normal.ts'), 'onClick');
    assert.deepEqual(view.actions, [['onFile', 'normal.ts']]);
    pending.set('late', deferred()); await searchFor(view, 'late');
    const latestInput = input(view).props.onChange;
    const before = view.observations.stateUpdates;
    view.unmount(); pending.get('late').resolve([entry('late.ts')]); await view.settle();
    latestInput({ target: { value: 'after unmount' } });
    assert.equal(view.observations.stateUpdates, before, 'late results and callbacks do not set state after unmount');
    assert.equal(view.timeouts.size, 0);
  });

  test('Sidebar direct target Reveal verifies exact ancestors and leaf then locates only that row without editor effects', async t => {
    const listings = { '': [entry('a', true), entry('z', true)], a: [entry('a/same.ts')], z: [entry('z/deep', true)], 'z/deep': [entry('z/deep/same.ts')] };
    const view = mountScenario({ props: { activeFile: { connection, root, path: `${root}/z/deep/same.ts` } },
      handle: (_owner, r) => r.op === 'search' ? [entry('a/same.ts')] : listings[r.path] });
    t.after(() => view.unmount()); await view.settle();
    await searchFor(view, 'same');
    const prior = view.requests.length;
    const reveal = button(view, 'Reveal active file'); reveal.focus();
    view.event(reveal, 'onClick');
    assert.equal(input(view).props.value, '');
    assert.equal(button(view, 'Reveal active file').props.disabled, true);
    assert.ok(hasText(view, 'Revealing active file…'));
    await view.settle(); await view.settle();
    assert.deepEqual(view.requests.slice(prior).map(r => r.request), [
      { op: 'list', root, path: '' }, { op: 'list', root, path: 'z' }, { op: 'list', root, path: 'z/deep' },
    ]);
    assert.ok(fileRow(view, 'z/deep/same.ts'));
    assert.equal(fileRow(view, 'z').props['aria-expanded'], true);
    assert.equal(fileRow(view, 'z/deep').props['aria-expanded'], true);
    assert.ok(fileRow(view, 'z/deep/same.ts').props.className.includes('file-revealed'));
    assert.ok(hasText(view, 'Revealed z/deep/same.ts.'));
    assert.ok(hasText(view, 'Revealed file'));
    assert.equal(view.observations.scrolls.length, 1);
    assert.equal(view.observations.scrolls[0].node, fileRow(view, 'z/deep/same.ts'));
    assert.equal(view.observations.scrolls[0].options.block, 'nearest');
    assert.equal(view.document.activeElement, reveal, 'synthetic scroll does not invoke focus');
    assertNavigationOnly(view);
    view.event(fileRow(view, 'z/deep/same.ts'), 'onClick');
    assert.deepEqual(view.actions, [['onFile', 'z/deep/same.ts']]);
    await searchFor(view, 'same');
    assert.ok(hasText(view, '1 matching files in the searched scope.'));
    assert.ok(!hasText(view, 'Reveal cancelled.'), 'completed Reveal does not replace later search outcome');
  });

  test('Sidebar Reveal missing capped excluded and wrong-kind leaves remain unavailable without basename substitution', async t => {
    for (const listing of [[], [entry('other/same.ts')], [entry('same.ts', true)],
      Array.from({ length: 600 }, (_, i) => entry(`other${i}.ts`))]) {
      const view = mountScenario({ props: { activeFile: { connection, root, path: 'same.ts' } }, handle: () => listing });
      try {
        await view.settle(); view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
        assert.ok(hasText(view, 'The active file is not available in the directory listings. Refresh or select another file.'));
        assert.equal(view.observations.scrolls.length, 0);
        assert.equal(view.requests.length, 2, 'bounded verification does not enumerate alternatives');
        assertNavigationOnly(view);
      } finally { view.unmount(); }
    }
  });

  test('Sidebar Reveal refuses absent foreign unsafe ambiguous and non-file targets with visible associated reasons', async t => {
    const view = mountScenario(); t.after(() => view.unmount()); await view.settle();
    const ineligible = [null, { connection: { ...connection, host: 'foreign' }, root, path: leaf.path },
      { connection, root: root + '-adjacent', path: leaf.path },
      ...['../secret.ts', './needle.ts', 'src//needle.ts', 'src/../needle.ts', root + '-adjacent/needle.ts', '/', 'C:\\else\\file.ts', 'src/\u0000file.ts'].map(path => ({ connection, root, path }))];
    for (const activeFile of ineligible) {
      view.update({ activeFile }); const reveal = button(view, 'Reveal active file');
      assert.equal(reveal.props.disabled, true);
      assert.ok(reveal.props['aria-describedby']);
      assert.ok(hasText(view, activeFile ? 'The active file is not available in this project.' : 'Select an editor or diff in this project to reveal its file.'));
      view.event(reveal, 'onClick'); await view.settle();
      assert.equal(view.requests.length, 1);
    }
    assertNavigationOnly(view);
  });

  test('Sidebar folder and Reveal request failures expose fixed explicit retries and fresh successful controls', async t => {
    let failures = true;
    const view = mountScenario({ props: { activeFile: { connection, root, path: leaf.path } },
      handle: (_owner, r) => { if (failures) throw Error('PRIVATE list rejection'); return r.path ? [leaf] : [directory]; } });
    t.after(() => view.unmount()); await view.settle();
    assert.ok(hasText(view, 'Could not list this folder. Retry.'));
    assert.ok(!hasText(view, 'PRIVATE'));
    const oldRetry = button(view, 'Retry folder').props.onClick;
    failures = false; view.event(button(view, 'Retry folder'), 'onClick'); await view.settle();
    assert.ok(fileRow(view, 'src'));
    const before = view.requests.length; oldRetry(); await view.settle();
    assert.equal(view.requests.length, before, 'obsolete folder retry refuses');
    failures = true; view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
    assert.ok(hasText(view, 'Could not reveal the active file. Retry.'));
    assert.ok(!hasText(view, 'PRIVATE'));
    const failedRequests = view.requests.length; view.advanceTime(10000); await view.settle();
    assert.equal(view.requests.length, failedRequests);
    failures = false; view.event(button(view, 'Retry reveal'), 'onClick'); await view.settle(); await view.settle();
    assert.ok(hasText(view, 'Revealed src/needle.ts.'));
    assert.equal(view.observations.scrolls.length, 1);
    assertNavigationOnly(view);
  });

  test('Sidebar hidden normal lists may finish for the same owner while hidden callbacks and collapsed child callbacks refuse', async t => {
    const pending = deferred();
    const view = mountScenario({ handle: (_owner, r) => r.op === 'search' ? [leaf] : r.path ? pending.promise : [directory] });
    t.after(() => view.unmount()); await view.settle();
    view.event(fileRow(view, 'src'), 'onClick'); await view.settle();
    assert.ok(hasText(view, 'Loading folder…'));
    await searchFor(view, 'needle');
    pending.resolve([leaf]); await view.settle();
    const hiddenClick = fileRow(view, leaf.path).props.onClick;
    hiddenClick(); assertNavigationOnly(view);
    const count = view.requests.length;
    view.event(button(view, 'Clear file filter'), 'onClick'); await view.settle();
    assert.equal(view.requests.length, count, 'valid hidden cache retained');
    const childClick = fileRow(view, leaf.path).props.onClick;
    view.event(fileRow(view, 'src'), 'onClick'); childClick();
    assertNavigationOnly(view);
    view.event(fileRow(view, 'src'), 'onClick'); await view.settle();
    childClick(); assertNavigationOnly(view);
    view.event(fileRow(view, leaf.path), 'onClick');
    assert.deepEqual(view.actions, [['onFile', leaf.path]]);
  });

  test('Sidebar every full raw endpoint slot and exact root reject retained rows controls and delayed lists with fresh positives', async t => {
    const changes = [{ id: 'replacement' }, { kind: 'ssh' }, { host: 'other' }, { port: 2202 }, { distro: 'other' }, { rigBinary: '/other/rig' }, { root: root + '/other' }];
    for (const change of changes) {
      let wait = null;
      const view = mountScenario({ props: { activeFile: { connection, root, path: 'current.ts' } },
        handle: (_owner, r) => r.op === 'search' ? wait.promise : [entry('current.ts')] });
      try {
        await view.settle();
        const oldClick = fileRow(view, 'current.ts').props.onClick;
        const oldReveal = button(view, 'Reveal active file').props.onClick;
        wait = deferred(); await searchFor(view, 'pending');
        const oldInput = input(view).props.onChange;
        const nextConnection = { ...connection, ...change }, nextRoot = change.root || root;
        view.update({ connection: nextConnection, root: nextRoot, activeFile: { connection: nextConnection, root: nextRoot, path: 'current.ts' } });
        assert.equal(visibleRows(view).length, 0, 'new owner shows no prior row before lists finish');
        assert.equal(input(view).props.value, '');
        const before = view.requests.length;
        oldClick(); oldReveal(); oldInput({ target: { value: 'stale' } });
        wait.resolve([entry('obsolete.ts')]); await view.settle();
        assert.equal(view.requests.length, before + 1, 'only the new owner root list is sent');
        assert.ok(!hasText(view, 'obsolete.ts'));
        assert.equal(view.requests.at(-1).owner, nextConnection);
        assert.deepEqual(view.requests.at(-1).request, { op: 'list', root: nextRoot, path: '' });
        assertNavigationOnly(view);
        view.event(fileRow(view, 'current.ts'), 'onClick');
        assert.deepEqual(view.actions, [['onFile', 'current.ts']]);
      } finally { view.unmount(); }
    }
  });

  test('Sidebar pending Reveal cancels on query target refresh owner root and unmount and fresh Reveal still succeeds', async t => {
    for (const change of ['query', 'target', 'refresh', 'owner', 'root', 'unmount']) {
      let waiting = false;
      const pending = deferred();
      const view = mountScenario({ props: { activeFile: { connection, root, path: leaf.path } },
        handle: (_owner, r) => waiting ? pending.promise : r.op === 'search' ? [] : r.path ? [leaf] : [directory] });
      try {
        await view.settle(); waiting = true;
        const click = button(view, 'Reveal active file').props.onClick;
        view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
        const count = view.requests.length;
        click(); await view.settle();
        assert.equal(view.requests.length, count, 'retained duplicate Reveal cannot start another request');
        if (change === 'query') typeQuery(view, 'new navigation');
        if (change === 'target') view.update({ activeFile: { connection, root, path: 'other.ts' } });
        if (change === 'refresh') view.update({ fileRevision: 1 });
        if (change === 'owner') view.update({ connection: { ...connection, host: 'other' } });
        if (change === 'root') view.update({ root: root + '/other' });
        if (change === 'unmount') view.unmount();
        const before = view.observations.stateUpdates;
        pending.resolve([directory]); await view.settle();
        assert.equal(view.observations.scrolls.length, 0, `${change} cannot locate stale target`);
        assert.ok(!hasText(view, 'Revealed src/needle.ts.'));
        assertNavigationOnly(view);
        if (change === 'unmount') assert.equal(view.observations.stateUpdates, before);
        else {
          waiting = false;
          view.update({ connection, root, activeFile: { connection, root, path: leaf.path } });
          if (input(view).props.value) view.event(button(view, 'Clear file filter'), 'onClick');
          await view.settle(); view.event(button(view, 'Reveal active file'), 'onClick');
          await view.settle(); await view.settle();
          assert.ok(hasText(view, 'Revealed src/needle.ts.'), `${change}: fresh explicit Reveal works`);
          assert.equal(view.observations.scrolls.length, 1);
          assertNavigationOnly(view);
        }
      } finally { view.unmount(); }
    }
  });

  test('Sidebar full raw owner changes discard delayed normal lists and Reveal verifications including same-id repoints', async t => {
    for (const delta of [{ id: 'new' }, { kind: 'wsl' }, { host: 'new' }, { port: 2300 }, { distro: 'new' }, { rigBinary: 'new' }]) {
      for (const operation of ['list', 'reveal']) {
        const old = deferred(); let hold = operation === 'list';
        const next = { ...connection, ...delta };
        const view = mountScenario({ props: { activeFile: { connection, root, path: 'file.ts' } }, handle: (owner, r) => {
          if (owner === connection && hold) return old.promise;
          return [entry('file.ts')];
        } });
        try {
          await view.settle();
          if (operation === 'reveal') { hold = true; view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle(); }
          view.update({ connection: next, activeFile: { connection: next, root, path: 'file.ts' } });
          assert.equal(visibleRows(view).length, 0);
          old.resolve([entry('obsolete.ts')]); await view.settle();
          assert.ok(!hasText(view, 'obsolete.ts'));
          assert.equal(view.observations.scrolls.length, 0);
          assert.ok(fileRow(view, 'file.ts'));
          view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
          assert.ok(hasText(view, 'Revealed file.ts.'));
          assert.equal(view.observations.scrolls.length, 1);
          assert.equal(view.requests.at(-1).owner, next);
          assertNavigationOnly(view);
          view.event(fileRow(view, 'file.ts'), 'onClick');
          assert.deepEqual(view.actions, [['onFile', 'file.ts']]);
        } finally { view.unmount(); }
      }
    }
  });

  test('Sidebar normal child empty root cap long labels and explicit navigation keep exact bounded row semantics', async t => {
    const longPath = 'long-長い-'.repeat(70) + '.ts';
    const view = mountScenario({ handle: (_owner, r) => r.path ? [] : [directory, entry(longPath),
      ...Array.from({ length: 600 }, (_, i) => entry(`file-${i}.ts`))] });
    t.after(() => view.unmount()); await view.settle();
    assert.equal(visibleRows(view).length, 600);
    assert.equal(fileRow(view, longPath).props['aria-label'], longPath);
    assert.equal(fileRow(view, 'src').props['aria-expanded'], false);
    view.event(fileRow(view, 'src'), 'onClick'); await view.settle();
    assert.equal(fileRow(view, 'src').props['aria-expanded'], true);
    assert.ok(hasText(view, 'No entries in this directory listing.'));
    assert.deepEqual(view.requests.map(r => r.request), [{ op: 'list', root, path: '' }, { op: 'list', root, path: 'src' }]);
    assertNavigationOnly(view);
    view.event(fileRow(view, longPath), 'onClick');
    assert.deepEqual(view.actions, [['onFile', longPath]]);
  });

  test('Sidebar explicit navigation supersedes pending Reveal and refresh discards verified row data immediately', async t => {
    let wait = false, fresh = false; const pending = deferred();
    const view = mountScenario({ props: { activeFile: { connection, root, path: leaf.path } }, handle: (_owner, r) => {
      if (wait) return pending.promise;
      return fresh ? [] : r.path ? [leaf] : [directory];
    } });
    t.after(() => view.unmount()); await view.settle();
    wait = true; view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
    view.event(fileRow(view, 'src'), 'onClick');
    wait = false; pending.resolve([directory]); await view.settle();
    assert.equal(view.observations.scrolls.length, 0, 'normal navigation supersedes the old Reveal');
    view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle(); await view.settle();
    assert.equal(view.observations.scrolls.length, 1);
    const oldClick = fileRow(view, leaf.path).props.onClick;
    fresh = true; view.update({ fileRevision: 1 });
    assert.equal(visibleRows(view).length, 0, 'verified old revision never renders as fresh while refresh loads');
    oldClick(); await view.settle();
    assert.ok(hasText(view, 'No files are available in this directory listing.'));
    assertNavigationOnly(view);
  });

  test('Sidebar retained file Reveal and input callbacks refuse same-id repoints before child effect cleanup', async t => {
    for (const change of [{ host: 'other' }, { kind: 'ssh' }, { port: 2222 }, { distro: 'other' }, { rigBinary: 'other' }]) {
      let retained = null, invoked = 0;
      const view = mountScenario({ props: { activeFile: { connection, root, path: 'file.ts' } },
        handle: () => [entry('file.ts')], beforeChildEffects() {
          if (!retained) return;
          invoked++;
          retained.file(); retained.reveal(); retained.input({ target: { value: 'obsolete query' } });
        } });
      try {
        await view.settle();
        retained = { file: fileRow(view, 'file.ts').props.onClick, reveal: button(view, 'Reveal active file').props.onClick,
          input: input(view).props.onChange };
        const next = { ...connection, ...change };
        view.update({ connection: next, activeFile: { connection: next, root, path: 'file.ts' } });
        assert.equal(invoked, 1, 'retained callbacks exercised during the parent effect');
        await view.settle();
        assert.equal(input(view).props.value, '');
        assert.equal(view.requests.length, 2, 'only original and new-owner root lists; no stale Reveal/search');
        assertNavigationOnly(view);
        view.event(fileRow(view, 'file.ts'), 'onClick');
        assert.deepEqual(view.actions, [['onFile', 'file.ts']]);
      } finally { view.unmount(); }
    }
  });

  test('Sidebar unchanged query and repeated fresh normal row actions remain usable', async t => {
    const view = mountScenario({ handle: (_owner, r) => r.op === 'search' ? [entry('match.ts')] : [entry('normal.ts')] });
    t.after(() => view.unmount()); await view.settle();
    view.event(fileRow(view, 'normal.ts'), 'onClick');
    view.event(fileRow(view, 'normal.ts'), 'onClick');
    assert.deepEqual(view.actions, [['onFile', 'normal.ts'], ['onFile', 'normal.ts']]);
    await searchFor(view, 'match'); const count = view.requests.length;
    typeQuery(view, 'match'); view.advanceTime(200); await view.settle();
    assert.equal(view.requests.length, count);
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['match.ts']);
    view.event(visibleRows(view)[0], 'onClick');
    assert.deepEqual(view.actions.at(-1), ['onFile', 'match.ts']);
    assert.deepEqual(view.forbidden, []);
  });
}

module.exports = { mountFiles, mountScenario, fileRow, connection, root, leaf, entry, deferred, input, button,
  visibleRows, typeQuery, searchFor, hasText, assertNavigationOnly };

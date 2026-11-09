const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
const { appFixture } = require('./file-explorer-app.test.cjs');
const { deferred, entry, input, button, searchFor, visibleRows } = require('./file-explorer.test.cjs');

const leaf = 'nested/selected.ts';
const records = [entry(leaf), entry('nested/added.ts'), entry('nested/deleted.ts'), entry('nested/untracked.ts')];
const response = (status = 'M') => ({ isRepository: true, root: '/canonical', projectPrefix: '',
  entries: records.map((r, i) => ({ path: r.path, status: [status, 'A', 'D', '??'][i] })) });
const text = v => v.nodes().map(n => v.text(n)).join('\n');
const row = (v, p) => visibleRows(v).find(n => n.props.title?.split(' —')[0] === p);
function badge(v, p, letter) {
  const r = row(v, p);
  assert.ok(r, `actual listed row ${p}`);
  assert.ok(v.nodes().some(n => r.contains(n) && n.props.className === 'git-badge' && v.text(n) === letter),
    `actual current row ${p} displays ${letter}`);
}
function mount({ handleGit = () => response(), before = () => {}, component = 'editor' } = {}) {
  const f = appFixture(component), gitRequests = [], files = [], forbidden = [];
  const api = new Proxy({ platform: 'linux', git(connection, root) {
    gitRequests.push({ connection, root });
    return Promise.resolve().then(() => handleGit(connection, root, gitRequests.length));
  }, file(connection, request) {
    assert.ok(['list', 'search'].includes(request.op));
    files.push({ connection, request: { ...request } });
    return Promise.resolve(request.op === 'search' || request.path ? records : [entry('nested', true)]);
  } }, { get: (o, k) => k in o ? o[k] : (...args) => { forbidden.push([k, ...args]); return Promise.resolve(); } });
  for (const name of ['refreshAll', 'openProject', 'openConnect', 'openSeat', 'openSeatBeside', 'dragSeat', 'setState', 'setRevision']) {
    const original = f.scope[name];
    f.scope[name] = (...args) => { forbidden.push([name]); return original(...args); };
  }
  const props = f.render();
  const v = mountComponent('src/Sidebar.tsx', 'default', props, { actualComponents: true, api,
    settings: { effective: { 'rig.seatSort': 'name', 'appearance.density': 'compact' }, project: {}, update() { forbidden.push(['settings']); } },
    root({ react, load }) {
      const Sidebar = load('src/Sidebar.tsx').default;
      return function Boundary(current) {
        react.useEffect(() => before(current), [current.connection, current.root, current.fileRevision]);
        return react.createElement(Sidebar, current);
      };
    } });
  const selection = JSON.stringify(f.model.toJson());
  return Object.assign(v, { f, api, gitRequests, files, forbidden, selection });
}
function safe(v) {
  assert.deepEqual(v.forbidden, [], 'no host, write, lifecycle, settings or App action');
  assert.deepEqual(v.f.events, [], 'no implicit file/editor action');
  assert.equal(JSON.stringify(v.f.model.toJson()), v.selection, 'editor selection unchanged');
  assert.equal(v.f.scope.pendingFileFocus.current, null);
  assert.equal(v.intervals.size, 0);
}
async function expand(v, letter = 'M') {
  if (!row(v, leaf)) { v.event(row(v, 'nested'), 'onClick'); await v.settle(); }
  badge(v, leaf, letter);
}
const changes = f => Object.fromEntries(['id', 'kind', 'host', 'port', 'distro', 'rigBinary', 'root', 'refresh'].map(slot =>
  [slot, slot === 'root' ? { root: '/synthetic/other' } : slot === 'refresh' ? { fileRevision: 1 } :
    { connection: { ...f.config.connection, [slot]: slot === 'port' ? 2300 : slot === 'kind' ? 'wsl' : 'synthetic-other' } }]));

test('Git badges preserve current-owner authority without navigation refetch or side effects', async t => {
  // Actual editor buffer module, with inert draft effects and a preserved dirty buffer.
  const buffers = {}, draftEffects = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/editor-buffers.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: buffers, require(id) {
    assert.equal(id, './drafts');
    return new Proxy({}, { get: () => (...args) => draftEffects.push(args) });
  } });
  const dirty = { content: 'synthetic unsaved', saved: 'synthetic saved', revision: 'r1' };
  buffers.buffers.set('selected', dirty);

  // Run every stale/lifetime control before the fail-first navigation assertion.
  const template = appFixture();
  for (const [slot, change] of Object.entries(changes(template))) {
    const pending = [];
    let inspect = () => {};
    const v = mount({ handleGit: () => { const d = deferred(); pending.push(d); return d.promise; }, before: () => inspect() });
    try {
      await v.settle(); pending[0].resolve(response()); await v.settle(); await expand(v);
      const old = { row: row(v, leaf).props.onClick, input: input(v).props.onChange,
        reveal: button(v, 'Reveal active file').props.onClick };
      let checked = false;
      inspect = () => {
        checked = true;
        assert.match(text(v), /Checking Git status/);
        assert.doesNotMatch(text(v), /Git reported 4 status|Reported Git paths/);
        const updates = v.observations.stateUpdates;
        old.row(); old.input({ target: { value: 'obsolete' } }); old.reveal();
        assert.equal(v.observations.stateUpdates, updates, `${slot}: stale callbacks before child cleanup`);
      };
      // Connections must derive from this actual mount, not the template's object.
      const actualChange = changes(v.f)[slot];
      v.update(actualChange); assert.equal(checked, true); inspect = () => {};
      await v.settle(); assert.equal(v.gitRequests.length, 2);
      v.update({ fileRevision: 2 }); await v.settle();
      pending[2].resolve(response('A')); await v.settle();
      pending[1].resolve({ ...response(), entries: [{ path: 'obsolete', status: 'D' }] }); await v.settle();
      await expand(v, 'A'); assert.doesNotMatch(text(v), /obsolete/); safe(v);
      v.update({ fileRevision: 3 }); await v.settle();
      v.update({ fileRevision: 4 }); await v.settle();
      pending[4].resolve(response()); await v.settle();
      pending[3].reject(new Error('synthetic obsolete failure')); await v.settle();
      await expand(v); assert.doesNotMatch(text(v), /unavailable|synthetic obsolete failure/); safe(v);
      assert.equal(v.gitRequests.at(-1).connection, actualChange.connection || v.f.config.connection);
      assert.equal(v.gitRequests.at(-1).root, actualChange.root || v.f.config.root);
    } finally { v.unmount(); }
  }
  for (const error of [false, true]) {
    const d = deferred(), v = mount({ handleGit: () => d.promise });
    await v.settle(); v.unmount(); const updates = v.observations.stateUpdates;
    error ? d.reject(new Error('synthetic obsolete')) : d.resolve(response());
    await v.settle(); assert.equal(v.observations.stateUpdates, updates); safe(v);
    const fresh = mount(); await fresh.settle(); await expand(fresh); safe(fresh); fresh.unmount();
  }
  for (const slot of Object.keys(changes(template))) {
    let inspect = () => {};
    const v = mount({ handleGit: (_c, _r, n) => n === 1 ? Promise.reject(new Error('synthetic')) : response(), before: () => inspect() });
    try {
      await v.settle(); const retry = button(v, 'Retry Git status').props.onClick;
      let checked = false;
      inspect = () => { checked = true; const updates = v.observations.stateUpdates; retry();
        assert.equal(v.observations.stateUpdates, updates, `${slot}: retained Retry refused`);
        assert.match(text(v), /Checking Git status/); };
      v.update(changes(v.f)[slot]); inspect = () => {}; assert.equal(checked, true);
      await v.settle(); await expand(v); assert.equal(v.gitRequests.length, 2); safe(v);
    } finally { v.unmount(); }
  }
  {
    const pending = [], v = mount({ handleGit: () => { const d = deferred(); pending.push(d); return d.promise; } });
    try {
      await v.settle(); pending[0].reject(new Error('synthetic')); await v.settle();
      const retry = button(v, 'Retry Git status').props.onClick;
      v.event(button(v, 'Retry Git status'), 'onClick');
      assert.match(text(v), /Checking Git status/);
      const updates = v.observations.stateUpdates; retry(); assert.equal(v.observations.stateUpdates, updates);
      await v.settle(); assert.equal(v.gitRequests.length, 2);
      pending[1].resolve(response()); await v.settle(); await expand(v); safe(v);
      v.unmount(); const after = v.observations.stateUpdates; retry();
      assert.equal(v.observations.stateUpdates, after);
    } finally { v.unmount(); }
  }
  // Actual App retained opens must refuse every raw repoint; fresh exact captured open works.
  for (const slot of ['id', 'kind', 'host', 'port', 'distro', 'rigBinary', 'root']) {
    const f = appFixture(), old = f.props;
    const delta = changes(f)[slot];
    const next = delta.connection || { ...f.config.connection, root: delta.root };
    f.scope.stateRef.current = { ...f.scope.state, connections: [next], activeConnection: next.id, roots: { [next.id]: next.root } };
    old.onFile('obsolete.ts'); old.onDiff('obsolete.ts'); assert.deepEqual(f.events, []);
    f.scope.connection = next; f.scope.root = next.root; f.scope.state = f.scope.stateRef.current;
    f.render().onFile('fresh.ts'); assert.equal(f.events.length, 1);
    assert.equal(f.events[0][2].connection, next); assert.equal(f.events[0][2].root, next.root);
    assert.equal(f.events[0][2].path, 'fresh.ts');
  }
  for (const component of ['editor', 'diff']) {
    const v = mount({ component });
    try {
      buffers.bufferConfigs.set('selected', v.f.config);
      await v.settle(); await expand(v);
      for (const [i, letter] of ['M', 'A', 'D', '?'].entries()) badge(v, records[i].path, letter);
      assert.equal(v.gitRequests.length, 1);
      const subject = { api: v.api, connection: v.f.config.connection, root: v.f.config.root,
        filter: query => searchFor(v, query) };
      const actual = process.env.GSD_PROHIB_SUBJECT ? require(path.resolve(process.env.GSD_PROHIB_SUBJECT))(subject) : subject;
      await actual.filter('selected'); badge(v, leaf, 'M');
      assert.equal(input(v).props.value, 'selected', 'original filter event executed');
      assert.equal(v.files.at(-1).request.op, 'search');
      v.event(button(v, 'Clear file filter'), 'onClick'); await v.settle(); badge(v, leaf, 'M');
      assert.equal(input(v).props.value, '');
      v.event(row(v, 'nested'), 'onClick'); await v.settle();
      v.event(row(v, 'nested'), 'onClick'); await v.settle(); badge(v, leaf, 'M');
      v.event(button(v, 'Reveal active file'), 'onClick'); await v.settle(); await v.settle();
      badge(v, leaf, 'M'); assert.match(text(v), /Revealed nested\/selected.ts/);
      safe(v); assert.deepEqual(draftEffects, []);
      assert.equal(buffers.buffers.get('selected'), dirty);
      assert.deepEqual(dirty, { content: 'synthetic unsaved', saved: 'synthetic saved', revision: 'r1' });
      assert.equal(buffers.bufferConfigs.get('selected'), v.f.config);
      t.diagnostic('Actual Sidebar rows M/A/D/? and original filter/Clear/folder/Reveal executed; stale controls completed.');
      assert.equal(v.gitRequests.length, 1, 'authority: navigation must not refetch Git');
      v.event(row(v, leaf), 'onClick'); assert.equal(v.f.events.length, 1);
      const captured = v.f.events[0][2];
      assert.equal(captured.connection, v.f.config.connection); assert.equal(captured.root, v.f.config.root);
      assert.equal(captured.path, leaf);
    } finally { v.unmount(); }
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { appFixture } = require('./file-explorer-app.test.cjs');
const { mountScenario, entry, deferred, input, button, visibleRows, searchFor, typeQuery } = require('./file-explorer.test.cjs');

test('file filter and Reveal preserve current-owner read-only authority', async () => {
  const effects = [];
  const actualApp = component => {
    const fixture = appFixture(component);
    for (const name of ['refreshAll', 'openProject', 'openConnect', 'openSeat', 'openSeatBeside', 'dragSeat',
      'setState', 'setRevision']) {
      const original = fixture.scope[name];
      fixture.scope[name] = (...args) => { effects.push(['App action', name]); return original(...args); };
    }
    fixture.render();
    return fixture;
  };
  const wrap = subject => process.env.GSD_PROHIB_SUBJECT
    ? require(path.resolve(process.env.GSD_PROHIB_SUBJECT))(subject) : subject;
  const buffers = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/editor-buffers.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: buffers, require(id) {
    assert.equal(id, './drafts');
    return new Proxy({}, { get: () => (...args) => effects.push(['draft', ...args]) });
  } });
  const dirty = { content: 'synthetic unsaved', saved: 'synthetic saved', revision: 'r1' };
  buffers.buffers.set('selected', dirty);
  for (const component of ['editor', 'diff']) {
    const f = actualApp(component);
    buffers.bufferConfigs.set('selected', f.config);
    const selection = JSON.stringify(f.model.toJson());
    const view = mountScenario({ props: f.props, handle(owner, request) {
      assert.equal(owner, f.config.connection);
      assert.equal(request.root, f.config.root);
      return request.op === 'search' || request.path === 'nested'
        ? [entry('nested/selected.ts')] : [entry('nested', true)];
    } });
    const subject = wrap({ filter: query => searchFor(view, query),
      reveal: () => view.event(button(view, 'Reveal active file'), 'onClick'),
      row: row => view.event(row, 'onClick'), record: effect => effects.push(effect) });
    try {
      await view.settle(); await subject.filter(' selected ');
      assert.deepEqual(visibleRows(view).map(n => n.props.title), ['nested/selected.ts']);
      assert.ok(view.nodes().some(n => n.type === 'div' && n.props.title === 'nested'));
      subject.reveal(); await view.settle(); await view.settle();
      assert.deepEqual(view.requests.map(r => r.request), [
        { op: 'list', root: f.config.root, path: '' },
        { op: 'search', root: f.config.root, path: '', query: 'selected' },
        { op: 'list', root: f.config.root, path: '' },
        { op: 'list', root: f.config.root, path: 'nested' },
      ]);
      const row = visibleRows(view).find(n => n.props.title === 'nested/selected.ts');
      assert.ok(row.props.className.includes('file-revealed'));
      assert.equal(view.observations.scrolls.length, 1);
      assert.equal(JSON.stringify(f.model.toJson()), selection);
      assert.equal(buffers.buffers.get('selected'), dirty);
      assert.deepEqual(dirty, { content: 'synthetic unsaved', saved: 'synthetic saved', revision: 'r1' });
      assert.equal(buffers.bufferConfigs.get('selected'), f.config);
      assert.equal(f.scope.pendingFileFocus.current, null);
      assert.deepEqual(f.events, []);
      assert.deepEqual(view.actions, []); assert.deepEqual(view.forbidden, []);
      assert.deepEqual(effects, [], 'authority: no forbidden file effects');
      subject.row(row);
      assert.equal(f.events.length, 1);
      assert.equal(f.events[0][2].connection, f.config.connection);
      assert.equal(f.events[0][2].root, f.config.root);
      assert.equal(f.events[0][2].path, 'nested/selected.ts');
    } finally { view.unmount(); }
  }
  // Retained actual App callbacks consult latest refs even before a rerender.
  for (const delta of [{ id: 'other' }, { kind: 'wsl' }, { host: 'other.invalid' },
    { port: 2300 }, { distro: 'other' }, { rigBinary: '/other/rig' }, { root: '/other' }]) {
    const f = actualApp(), old = f.props;
    const next = { ...f.config.connection, ...delta };
    f.scope.stateRef.current = { ...f.scope.state, connections: [next], activeConnection: next.id,
      roots: { [next.id]: next.root } };
    old.onFile('obsolete.ts'); old.onDiff('obsolete.ts');
    assert.deepEqual(f.events, []);
    f.scope.connection = next; f.scope.root = next.root; f.scope.state = f.scope.stateRef.current;
    f.render().onFile('fresh.ts');
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0][2].connection, next);
    assert.equal(f.events[0][2].root, next.root);
  }
  // Real pending Reveal and retained callbacks reject every view lifetime.
  for (const delta of [{ id: 'other' }, { kind: 'wsl' }, { host: 'other.invalid' },
    { port: 2300 }, { distro: 'other' }, { rigBinary: '/other/rig' }, { root: '/other' }]) {
    const f = actualApp(); let retained = null, armed = false, invoked = false;
    const view = mountScenario({ props: f.props, beforeChildEffects() {
      if (armed) { invoked = true; retained.row(); retained.reveal(); retained.input({ target: { value: 'obsolete' } }); }
    }, handle: (_owner, r) => r.op === 'search' || r.path === 'nested'
      ? [entry('nested/selected.ts')] : [entry('nested', true)] });
    try {
      await view.settle(); await searchFor(view, 'selected');
      retained = { row: visibleRows(view)[0].props.onClick,
        reveal: button(view, 'Reveal active file').props.onClick, input: input(view).props.onChange };
      const next = { ...f.config.connection, ...delta }, nextRoot = next.root;
      const before = view.requests.length;
      armed = true;
      view.update({ connection: next, root: nextRoot, activeFile: { connection: next, root: nextRoot, path: f.config.path } });
      armed = false; await view.settle();
      assert.equal(invoked, true, 'retained callbacks exercised before child cleanup');
      assert.deepEqual(f.events, []); assert.deepEqual(view.actions, []); assert.deepEqual(view.forbidden, []);
      assert.equal(input(view).props.value, '');
      assert.deepEqual(view.requests.slice(before).map(r => [r.owner, r.request]),
        [[next, { op: 'list', root: nextRoot, path: '' }]]);
      f.scope.connection = next; f.scope.root = nextRoot;
      f.scope.stateRef.current = { ...f.scope.state, connections: [next], activeConnection: next.id };
      f.scope.state = f.scope.stateRef.current;
      view.update({ ...f.render(), activeFile: { connection: next, root: nextRoot, path: f.config.path } });
      await searchFor(view, 'selected');
      view.event(visibleRows(view)[0], 'onClick');
      assert.equal(f.events.length, 1);
      assert.equal(f.events[0][2].connection, next);
      assert.equal(f.events[0][2].root, nextRoot);
    } finally { view.unmount(); }
  }
  for (const change of ['query', 'target', 'refresh', 'unmount', 'root',
    'id', 'kind', 'host', 'port', 'distro', 'rigBinary']) {
    const f = actualApp(), pending = deferred(); let hold = false;
    const view = mountScenario({ props: f.props, handle: (_owner, r) => hold ? pending.promise
      : r.op === 'search' || r.path === 'nested' ? [entry('nested/selected.ts')] : [entry('nested', true)] });
    try {
      await view.settle(); await searchFor(view, 'selected');
      const oldRow = visibleRows(view)[0].props.onClick;
      const oldInput = input(view).props.onChange;
      const oldClear = button(view, 'Clear file filter').props.onClick;
      hold = true; view.event(button(view, 'Reveal active file'), 'onClick'); await view.settle();
      const oldReveal = button(view, 'Reveal active file').props.onClick;
      if (change === 'query') typeQuery(view, 'new');
      else if (change === 'target') view.update({ activeFile: { ...f.config, path: 'other.ts' } });
      else if (change === 'refresh') view.update({ fileRevision: 1 });
      else if (change === 'unmount') view.unmount();
      else if (change === 'root') view.update({ root: '/other' });
      else view.update({ connection: { ...f.config.connection,
        [change]: change === 'port' ? 2300 : change === 'kind' ? 'wsl' : 'other' } });
      const before = view.requests.length, updates = view.observations.stateUpdates;
      oldRow(); oldClear(); oldInput({ target: { value: 'obsolete' } }); oldReveal();
      pending.resolve([entry('nested', true)]); await view.settle();
      assert.equal(view.observations.scrolls.length, 0, change);
      assert.deepEqual(f.events, []); assert.deepEqual(view.actions, []); assert.deepEqual(view.forbidden, []);
      if (change === 'unmount') assert.equal(view.observations.stateUpdates, updates);
      else {
        assert.ok(view.requests.slice(before).every(r => r.owner !== f.config.connection ||
          r.request.root !== f.config.root || change === 'refresh'), change);
        hold = false;
        view.update({ connection: f.config.connection, root: f.config.root, activeFile: f.config });
        if (input(view).props.value) view.event(button(view, 'Clear file filter'), 'onClick');
        await view.settle(); view.event(button(view, 'Reveal active file'), 'onClick');
        await view.settle(); await view.settle();
        assert.equal(view.observations.scrolls.length, 1, `${change}: fresh Reveal`);
      }
    } finally { view.unmount(); }
  }
  // Reverse query responses cannot revive an obsolete result or its callback.
  for (const delta of [{ id: 'other' }, { kind: 'wsl' }, { host: 'other.invalid' },
    { port: 2300 }, { distro: 'other' }, { rigBinary: '/other/rig' }, { root: '/other' }]) {
    for (const operation of ['list', 'search']) {
      const f = actualApp(), pending = deferred();
      const next = { ...f.config.connection, ...delta };
      const view = mountScenario({ props: f.props, handle: (owner, r) =>
        owner === f.config.connection && r.op === operation ? pending.promise : [entry('fresh.ts')] });
      try {
        await view.settle();
        if (operation === 'search') await searchFor(view, 'pending');
        view.update({ connection: next, root: next.root });
        pending.resolve([entry('obsolete.ts')]); await view.settle();
        assert.deepEqual(visibleRows(view).map(n => n.props.title), ['fresh.ts']);
        assert.equal(view.requests.at(-1).owner, next);
        assert.deepEqual(view.requests.at(-1).request, { op: 'list', root: next.root, path: '' });
        assert.deepEqual(f.events, []); assert.deepEqual(view.actions, []); assert.deepEqual(view.forbidden, []);
      } finally { view.unmount(); }
    }
  }
  const old = deferred(), fresh = deferred();
  const view = mountScenario({ handle: (_owner, r) => r.op === 'list' ? [] : r.query === 'old' ? old.promise : fresh.promise });
  try {
    await view.settle(); await searchFor(view, 'old'); await searchFor(view, 'fresh');
    fresh.resolve([entry('fresh.ts')]); await view.settle();
    old.resolve([entry('obsolete.ts')]); await view.settle();
    assert.deepEqual(visibleRows(view).map(n => n.props.title), ['fresh.ts']);
    const click = visibleRows(view)[0].props.onClick;
    typeQuery(view, 'next'); click(); assert.deepEqual(view.actions, []);
    view.unmount(); assert.equal(view.timeouts.size, 0);
  } finally { view.unmount(); }
  assert.deepEqual(effects, [], 'authority: no forbidden file effects');
});

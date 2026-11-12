const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
const { metadataCore, ordinaryRead } = require('./git-info-api.test.cjs');

// Evaluate the actual conditional App footer, including its real click callback.
// No prospective module is imported on the unchanged baseline.
function mountGitInfoApp(options = {}) {
  const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(n) {
    if (ts.isJsxExpression(n) && n.expression &&
        n.expression.getText(app).startsWith('showStatusBar(focusMode, preferences["appearance.statusBar"]) &&')) matches.push(n.expression);
    ts.forEachChild(n, visit);
  }
  visit(app); assert.equal(matches.length, 1, 'actual conditional footer seam is unique');
  const events = [], requests = [], pendingReads = [];
  const connection = options.connection || { id: 'synthetic', kind: 'local', name: 'Synthetic', root: '/synthetic-alias' };
  const view = mountComponent(null, null, {
    connection, root: options.root || '/synthetic-alias', fileRevision: 0, visible: options.visible ?? true,
  }, {
    api: { file(owner, request) {
      requests.push({ owner, request });
      const promise = Promise.resolve(options.file(owner, request));
      pendingReads.push(promise.catch(() => {})); return promise;
    } },
    root({ react, load }) {
      const GitInfoStatus = fs.existsSync('src/GitInfoStatus.tsx') ? load('src/GitInfoStatus.tsx').default : undefined;
      return props => {
        const scope = vm.createContext({ React: react, GitInfoStatus,
          ...props, preferences: { 'appearance.statusBar': props.visible },
          AccountStatus: 'account-status', Network: 'network-icon', GitBranch: 'git-icon',
          Check: 'check-icon', Activity: 'activity-icon', tabCount: 2,
          // Inert stand-ins for the rig-health status element (not under test here).
          RigHealthStatus: () => null, attentionScope: () => ({ inventory: null, ready: false }),
          inventory: null, inventoryHealth: { current: { key: '', verified: false } },
          inventoryError: '', state: { activeRig: '', connections: [] },
          // Inert stand-ins for the status-bar connection switcher.
          menu: null, setMenu() {}, chooseConnection() {}, ChevronDown: 'chevron-icon',
          // The build chain's footer rules: focus mode off, every item shown, nothing dropped.
          focusMode: false, showStatusBar: (focus, pref) => pref !== false && !focus,
          isVisible: () => true, hiddenStatusItems: new Set(), statusSeparators: {},
          droppedNow: [], reconnectDropped() {}, RefreshCw: 'refresh-icon', droppedLabel: n => 'Reconnect all dropped (' + n + ')',
          setSection: value => events.push(['section', value]),
          setSidebar: value => events.push(['sidebar', value]),
          addPanel: (...args) => events.push(['panel', ...args]),
        });
        vm.runInContext(ts.transpileModule(`result = (${matches[0].getText(app)});`, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
        }).outputText, scope);
        return scope.result;
      };
    },
  });
  const settle = view.settle;
  return Object.assign(view, { events, requests, connection,
    async settle() { await settle(); await Promise.all(pendingReads); await settle(); },
    sourceButton() { return view.nodes().find(n => n.type === 'button' &&
      (view.text(n).includes('Source control') || n.props['aria-label']?.startsWith('Open source control.'))); },
  });
}

if (require.main === module) {
  const { test } = require('node:test');
  test('actual App selected workspace and Refresh/save revisions own footer independently of saved panel', async t => {
    const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function nodes(predicate) {
      const found = []; const visit = n => { if (predicate(n)) found.push(n); ts.forEachChild(n, visit); }; visit(app); return found;
    }
    function evaluate(node, scope) {
      const context = vm.createContext(scope);
      vm.runInContext(ts.transpileModule(`result = (${node.getText(app)});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText, context); return context.result;
    }
    const declaration = name => { const found = nodes(n => ts.isVariableDeclaration(n) && n.name.getText(app) === name); assert.equal(found.length, 1); return found[0].initializer; };
    const selected = { id: 'selected', kind: 'ssh', name: 'Selected', host: 'synthetic.invalid', root: '/selected/default' };
    const saved = { id: 'saved', kind: 'local', root: '/saved' };
    const state = { connections: [saved, selected], activeConnection: 'selected', roots: { selected: '/selected/exact' } };
    const scope = { state, local: saved, config: { connection: saved, root: saved.root }, activeFile: { connection: saved, root: saved.root } };
    scope.connection = evaluate(declaration('connection'), scope);
    scope.root = evaluate(declaration('root'), scope);
    assert.equal(scope.connection, selected); assert.equal(scope.root, '/selected/exact');
    const result = { state: 'repository', root: '/canonical', head: 'attached', branch: 'selected-topic', oid: 'a'.repeat(40), comparison: 'none' };
    const v = mountGitInfoApp({ connection: scope.connection, root: scope.root, file: () => result });
    t.after(() => v.unmount()); await v.settle(); assert.equal(v.text(v.sourceButton()), 'selected-topic · no upstream');
    assert.equal(v.requests[0].owner, selected); assert.equal(v.requests[0].request.root, '/selected/exact');
    let revision = 0, refresh = 0;
    const callbacks = { setRefresh: fn => { refresh = fn(refresh); }, setFileRevision: fn => { revision = fn(revision); } };
    evaluate(declaration('refreshAll'), callbacks)(); assert.equal(refresh, 1); assert.equal(revision, 1);
    v.update({ fileRevision: revision }); assert.equal(v.text(v.sourceButton()), 'Checking Git…'); await v.settle();
    // Execute the actual successful Save All function tail, including its revision update.
    const saveDispatch = nodes(n => ts.isExpressionStatement(n) && n.getText(app).startsWith('window.dispatchEvent(new Event("hrig:buffers-saved"))'));
    assert.equal(saveDispatch.length, 1);
    const statements = Array.from(saveDispatch[0].parent.statements);
    const next = statements[statements.indexOf(saveDispatch[0]) + 1];
    const context = vm.createContext(callbacks);
    vm.runInContext(ts.transpileModule(next.getText(app), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    assert.equal(revision, 2); v.update({ fileRevision: revision }); await v.settle();
    assert.equal(v.requests.length, 3); assert.equal(v.text(v.sourceButton()), 'selected-topic · no upstream');
    v.update({ visible: false }); await v.settle(); assert.equal(v.sourceButton(), undefined);
    v.update({ fileRevision: 3 }); await v.settle(); assert.equal(v.requests.length, 3);
    v.update({ visible: true }); await v.settle(); assert.equal(v.requests.length, 4);
    v.event(v.sourceButton(), 'onClick'); assert.deepEqual(v.events, [['section', 'changes'], ['sidebar', true]]);
    assert.equal(scope.config.connection, saved); assert.equal(scope.activeFile.connection, saved);
  });
}

module.exports = { mountGitInfoApp };
if (require.main === module) {
  const { test } = require('node:test');
  test('actual App existing Source control click opens Changes and shows sidebar', () => {
    const h = metadataCore();
    const view = mountGitInfoApp({ file: (owner, request) => h.core.fileOperation(owner, request) });
    view.event(view.sourceButton(), 'onClick');
    assert.deepEqual(view.events, [['section', 'changes'], ['sidebar', true]]);
    view.unmount();
  });
  test('actual core metadata reaches actual App footer branch counts and preserves navigation', async t => {
    const h = metadataCore(); await ordinaryRead(h);
    const view = mountGitInfoApp({ connection: h.connection,
      file: (owner, request) => h.core.fileOperation(owner, request) });
    t.after(() => view.unmount());
    // The existing real App callback is a passing control before the desired assertion.
    view.event(view.sourceButton(), 'onClick');
    assert.deepEqual(view.events, [['section', 'changes'], ['sidebar', true]]);
    t.diagnostic('Positive control: actual existing App button opened Changes and showed sidebar.');
    await view.settle();
    assert.equal(view.text(view.sourceButton()), 'topic ↑3 ↓1', 'actual current footer must display metadata branch/count meaning');
    assert.equal(view.requests.length, 1);
    assert.equal(view.requests[0].owner, h.connection);
    assert.deepEqual(JSON.parse(JSON.stringify(view.requests[0].request)), { op: 'gitInfo', root: '/synthetic-alias' });
    assert.match(view.sourceButton().props['aria-label'], /Upstream refs\/remotes\/origin\/topic\./);
    assert.match(view.sourceButton().props.title, /Local Git snapshot; no remote fetch\./);
  });
  test('actual App hidden status bar makes no metadata request', async () => {
    const view = mountGitInfoApp({ visible: false, file() { assert.fail('hidden footer must not read metadata'); } });
    await view.settle();
    assert.equal(view.nodes().length, 0); assert.equal(view.requests.length, 0);
    view.unmount();
  });
}

if (require.main === module) require('node:test').test('actual core unsupported command reaches actual App fixed explanation and manual snapshot name', async t => {
  const h = metadataCore(args => args[0] === 'symbolic-ref' ? { code: 129, stderr: 'usage: unsupported PRIVATE_CANARY' } : undefined);
  await ordinaryRead(h);
  const v = mountGitInfoApp({ connection: h.connection, file: (owner, request) => h.core.fileOperation(owner, request) });
  t.after(() => v.unmount()); v.event(v.sourceButton(), 'onClick');
  assert.deepEqual(v.events.splice(0), [['section', 'changes'], ['sidebar', true]]);
  await v.settle(); assert.equal(v.text(v.sourceButton()), 'Git unsupported');
  assert.ok(v.sourceButton().props.title.includes('Snapshot, not live. Terminal checkouts or commits need Refresh files.'));
  assert.doesNotMatch(v.sourceButton().props.title, /PRIVATE_CANARY|usage:/);
});

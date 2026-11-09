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
        n.expression.getText(app).startsWith('preferences["appearance.statusBar"] &&')) matches.push(n.expression);
    ts.forEachChild(n, visit);
  }
  visit(app); assert.equal(matches.length, 1, 'actual conditional footer seam is unique');
  const events = [], requests = [], pendingReads = [];
  const connection = options.connection || { id: 'synthetic', kind: 'local', name: 'Synthetic', root: '/synthetic-alias' };
  const view = mountComponent(null, null, {
    connection, root: '/synthetic-alias', fileRevision: 0, visible: options.visible ?? true,
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

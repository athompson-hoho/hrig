const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
const known = { state: 'repository', root: '/canonical', head: 'attached', branch: 'topic', oid: 'a'.repeat(40), comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 3, behind: 1 };
const base = { id: 'synthetic', kind: 'local', host: 'host', port: 22, distro: 'Distro', rigBinary: 'rig' };
function mount(before) {
  const requests = [], pending = [], actions = [], forbidden = [];
  const api = new Proxy({ file(owner, request) {
    requests.push({ owner, request });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } }, { get: (target, key) => key in target ? target[key] : (...args) => { forbidden.push([key, ...args]); } });
  const props = { connection: { ...base }, root: '/project', revision: 0, onOpen: () => actions.push('open') };
  const view = mountComponent('src/GitInfoStatus.tsx', 'default', props, { api,
    ...(before ? { root({ react, load }) { const Status = load('src/GitInfoStatus.tsx').default;
      return current => { react.useEffect(() => before(current), [current.connection, current.root, current.revision]); return react.createElement(Status, current); };
    } } : {}),
  });
  return Object.assign(view, { requests, pending, actions, forbidden, props,
    button() { return view.nodes().find(n => n.type === 'button'); },
    summary() { return view.text(this.button()); },
  });
}
function safe(v) {
  assert.deepEqual(v.forbidden, []); assert.deepEqual(v.actions, []);
  for (const key of ['intervals', 'timeouts', 'animationFrames', 'listeners', 'observers']) assert.equal(v[key].size, 0);
}
for (const [axis, change] of Object.entries({
  id: { connection: { ...base, id: 'new' } }, kind: { connection: { ...base, kind: 'ssh' } },
  host: { connection: { ...base, host: 'HOST ' } }, port: { connection: { ...base, port: '22' } },
  distro: { connection: { ...base, distro: 'distro' } }, rigBinary: { connection: { ...base, rigBinary: ' rig' } },
  root: { root: '/project/' }, revision: { revision: 1 },
})) test(`actual GitInfo ${axis} invalidates before cleanup and rejects reversed success/error with current positives`, async t => {
  let before;
  const v = mount(() => before?.()); t.after(() => v.unmount()); await v.settle();
  v.pending[0].resolve(known); await v.settle(); assert.equal(v.summary(), 'topic ↑3 ↓1');
  // Parent effect runs before the old child's cleanup. Publication must already be revoked.
  const updates = v.observations.stateUpdates;
  before = () => { assert.equal(v.summary(), 'Checking Git…'); v.pending[0].resolve({ ...known, branch: 'obsolete' }); };
  v.update(change); before = null; await v.settle();
  assert.equal(v.observations.stateUpdates, updates);
  assert.equal(v.requests.length, 2);
  assert.equal(v.requests[1].owner, change.connection || v.props.connection);
  assert.equal(v.requests[1].request.root, change.root || '/project');
  v.update({ revision: 10 }); await v.settle();
  v.pending[2].resolve({ ...known, branch: 'fresh' }); await v.settle();
  v.pending[1].resolve({ ...known, branch: 'obsolete' }); await v.settle(); assert.equal(v.summary(), 'fresh ↑3 ↓1');
  v.update({ revision: 11 }); await v.settle(); v.update({ revision: 12 }); await v.settle();
  v.pending[4].resolve(known); await v.settle(); v.pending[3].reject(Error('private obsolete host')); await v.settle();
  assert.equal(v.summary(), 'topic ↑3 ↓1'); safe(v);
});
test('actual GitInfo A-B-A does not resurrect first A and unmount refuses publication', async () => {
  const v = mount(); await v.settle();
  v.update({ root: '/B' }); await v.settle(); v.update({ root: '/project' }); await v.settle();
  v.pending[0].resolve({ ...known, branch: 'obsolete A' }); v.pending[1].reject(Error('obsolete B')); await v.settle();
  assert.equal(v.summary(), 'Checking Git…');
  v.pending[2].resolve(known); await v.settle(); assert.equal(v.summary(), 'topic ↑3 ↓1');
  v.update({ revision: 1 }); await v.settle(); v.unmount(); const updates = v.observations.stateUpdates;
  v.pending[3].resolve(known); await v.settle(); assert.equal(v.observations.stateUpdates, updates); safe(v);
});
test('actual GitInfo ignores error after unmount and suppresses queued obsolete success before cleanup', async () => {
  let before;
  const v = mount(() => before?.()); await v.settle();
  // The parent effect observes the new render before the child cleanup runs.
  v.pending[0].resolve({ ...known, branch: 'obsolete' });
  before = () => assert.equal(v.summary(), 'Checking Git…');
  v.update({ root: '/replacement' }); before = null; await v.settle();
  assert.equal(v.summary(), 'Checking Git…');
  v.pending[1].resolve(known); await v.settle(); assert.equal(v.summary(), 'topic ↑3 ↓1');
  v.update({ revision: 1 }); await v.settle(); v.unmount();
  const updates = v.observations.stateUpdates;
  v.pending[2].reject(Error('private post-unmount error')); await v.settle();
  assert.equal(v.observations.stateUpdates, updates); safe(v);
});
test('actual GitInfo finite states safe full text navigation and fresh error recovery', async t => {
  const v = mount(); t.after(() => v.unmount()); await v.settle();
  assert.equal(v.summary(), 'Checking Git…');
  assert.equal(v.button().props.title, 'Open source control. Checking Git information for the selected workspace.');
  const cases = [
    [known, 'topic ↑3 ↓1'], [{ ...known, ahead: 0, behind: 0 }, 'topic ↑0 ↓0'],
    [{ ...known, comparison: 'none', upstream: undefined, ahead: undefined, behind: undefined }, 'topic · no upstream'],
    [{ ...known, comparison: 'unknown', ahead: undefined, behind: undefined }, 'topic · comparison unavailable'],
    [{ state: 'repository', root: '/canonical', head: 'detached', oid: 'a'.repeat(40), comparison: 'none' }, 'Detached HEAD'],
    [{ state: 'repository', root: '/canonical', head: 'unborn', branch: 'topic', comparison: 'none' }, 'topic · no commits'],
    [{ state: 'not-repository', root: '/canonical' }, 'No Git repository'],
    [{ ...known, ahead: null }, 'Git unavailable'],
    [{ ...known, branch: ' e\u0301/分支<&> '.repeat(40) }, `${' e\u0301/分支<&> '.repeat(40)} ↑3 ↓1`],
  ];
  for (let i = 0; i < cases.length; i++) {
    if (i) { v.update({ revision: i }); await v.settle(); }
    const [result, summary] = cases[i]; v.pending[i].resolve(result); await v.settle();
    assert.equal(v.summary(), summary); assert.equal(v.button().props.type, 'button'); assert.ok(!v.button().props.disabled);
    assert.equal(v.button().props.title, v.button().props['aria-label']); assert.match(v.button().props.title, /^Open source control\./);
    if (result.branch && summary !== 'Git unavailable') assert.ok(v.button().props.title.includes(result.branch));
    safe(v); v.event(v.button(), 'onClick'); assert.deepEqual(v.actions.splice(0), ['open']);
  }
  v.update({ revision: 20 }); await v.settle(); v.pending.at(-1).reject(Error('/private host stderr')); await v.settle();
  assert.equal(v.summary(), 'Git unavailable'); assert.doesNotMatch(v.button().props.title, /private|stderr/);
  v.update({ revision: 21 }); await v.settle(); v.pending.at(-1).resolve(known); await v.settle();
  assert.equal(v.summary(), 'topic ↑3 ↓1'); const count = v.requests.length;
  v.update({ connection: { ...base } }); await v.settle(); assert.equal(v.requests.length, count); safe(v);
});

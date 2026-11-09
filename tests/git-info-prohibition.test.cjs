const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { metadataCore, ordinaryRead } = require('./git-info-api.test.cjs');
const harness = require('./helpers/virtual-list-harness.cjs');

test('Git metadata preserves informational authority through actual core and App', async t => {
  const effects = [];
  // Evaluate the unchanged actual helper, instrumenting only its inert API boundary.
  const filename = path.resolve(__dirname, 'git-info-app.test.cjs');
  const localRequire = createRequire(filename), helper = { exports: {} };
  let api;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: helper, exports: helper.exports,
    require(id) {
      if (id !== './helpers/virtual-list-harness.cjs') return localRequire(id);
      return { mountComponent(file, name, props, options) {
        api = new Proxy(options.api, { get(object, key) {
          return key in object ? object[key] : (...args) => { effects.push([String(key), ...args]); return Promise.resolve(); };
        } });
        return harness.mountComponent(file, name, props, { ...options, api });
      } };
    },
  }, { filename });
  const h = metadataCore(); await ordinaryRead(h);
  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const pending = [];
  const actual = {
    mount() { return helper.exports.mountGitInfoApp({ connection: h.connection, file(owner, request) {
      assert.equal(owner, h.connection);
      assert.deepEqual(JSON.parse(JSON.stringify(request)), { op: 'gitInfo', root: '/synthetic-alias' });
      return h.core.fileOperation(owner, request);
    } }); },
    async complete(view) { await view.settle(); },
    get api() { return api; },
  };
  let subject = actual;
  if (process.env.GSD_PROHIB_SUBJECT) {
    const fixture = fs.realpathSync(path.resolve(process.env.GSD_PROHIB_SUBJECT));
    const trusted = fs.realpathSync(path.join(__dirname, 'fixtures')) + path.sep;
    assert.ok(fixture.startsWith(trusted), 'subject stays inside trusted checkout fixtures');
    subject = require(fixture)(actual);
  }
  const v = subject.mount(); t.after(() => v.unmount());
  assert.equal(v.text(v.sourceButton()), 'Checking Git…');
  await subject.complete(v);
  assert.equal(v.text(v.sourceButton()), 'topic ↑3 ↓1', 'actual current branch/count positive');
  assert.equal(v.requests.length, 1);
  assert.equal(v.events.length, 0, 'metadata completion must not navigate');
  assert.equal(h.calls.length, 10, 'bounded metadata-only transcript');
  assert.ok(h.calls.every(a => ['rev-parse', 'symbolic-ref', 'for-each-ref', 'rev-list'].includes(a[0])));
  assert.equal(v.intervals.size, 0); assert.equal(v.timeouts.size, 0);
  v.event(v.sourceButton(), 'onClick');
  assert.deepEqual(JSON.parse(JSON.stringify(v.events)), [['section', 'changes'], ['sidebar', true]], 'actual explicit Changes click positive');
  assert.equal(v.requests.length, 1, 'explicit navigation adds no metadata request');
  // Actual helper/consumer with deferred results: stale success and error cannot publish.
  const w = helper.exports.mountGitInfoApp({ file() { const d = deferred(); pending.push(d); return d.promise; } });
  t.after(() => w.unmount());
  await Promise.resolve(); await Promise.resolve();
  const result = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' });
  w.update({ fileRevision: 1 }); await Promise.resolve(); await Promise.resolve();
  pending[1].resolve(result); pending[0].resolve({ ...result, branch: 'obsolete' }); await w.settle();
  assert.equal(w.text(w.sourceButton()), 'topic ↑3 ↓1');
  w.update({ fileRevision: 2 }); await Promise.resolve(); await Promise.resolve();
  w.update({ fileRevision: 3 }); await Promise.resolve(); await Promise.resolve();
  pending[3].resolve(result); pending[2].reject(new Error('synthetic obsolete error')); await w.settle();
  assert.equal(w.text(w.sourceButton()), 'topic ↑3 ↓1'); assert.equal(w.events.length, 0);
  w.unmount(); const updates = w.observations.stateUpdates;
  await w.settle(); assert.equal(w.observations.stateUpdates, updates);
  t.diagnostic('Actual core metadata, current App branch/count and explicit Changes click executed; stale success/error controls executed.');
  assert.deepEqual(effects, [], 'authority: metadata must not invoke forbidden API effects (including git fetch)');
});

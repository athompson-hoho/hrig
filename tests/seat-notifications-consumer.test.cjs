const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { nativeHarness } = require('./seat-notifications-native.test.cjs');

const host = Object.freeze({ id: 'synthetic-owner', kind: 'ssh', name: 'SYNTHETIC_PRIVATE_HOST_NAME',
  host: 'SYNTHETIC_PRIVATE_HOST', root: '/SYNTHETIC_PRIVATE_PATH' });
const seat = Object.freeze({ id: 'synthetic-seat', name: 'Builder', status: 'idle',
  rigId: 'synthetic-rig', rigName: 'SYNTHETIC_PRIVATE_RIG', pod: 'SYNTHETIC_PRIVATE_POD',
  runtime: 'synthetic', model: 'synthetic', session: 'synthetic-session', workCount: 0,
  activity: 'SYNTHETIC_PRIVATE_ACTIVITY', error: 'SYNTHETIC_PRIVATE_ERROR',
  prompt: 'SYNTHETIC_PRIVATE_PROMPT', path: '/SYNTHETIC_PRIVATE_PATH' });

function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(root, predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(root);
  assert.equal(matches.length, 1, 'actual source seam must be unique');
  return matches[0];
}
function evaluate(node, root, context) {
  return vm.runInContext(ts.transpileModule('(' + node.getText(root) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
}
function loadLocal(file, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const text = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(text, { exports, require(id) {
    assert.ok(id.startsWith('.'), 'transition helpers may only load local source');
    return loadLocal(path.resolve(path.dirname(file), id + '.ts'), cache);
  } });
  return exports;
}
function settings() {
  const root = source('src/settings.ts');
  const context = vm.createContext({ isWindows: false });
  context.defaults = evaluate(find(root, n => ts.isVariableDeclaration(n) &&
    n.name.getText(root) === 'defaults').initializer, root, context);
  const resolver = find(root, n => ts.isFunctionDeclaration(n) && n.name?.text === 'resolveSettings');
  vm.runInContext(ts.transpileModule(resolver.getText(root).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { defaults: context.defaults, resolve: context.resolveSettings };
}
function snapshot(rows) {
  return Object.freeze({ seats: Object.freeze(rows.map(row => Object.freeze({ ...row }))),
    rigs: Object.freeze([]), sampledAt: 'synthetic-time' });
}

// Real App callback and dependency expression, persistent actual ref initializers,
// real preload, real trusted main registration, inert native constructor/show.
// No renderer boot, poll, owner operation, timer, Electron import or UI launch.
function consumerHarness(options = {}) {
  const native = nativeHarness(options.native);
  const app = source('src/App.tsx');
  const effect = find(app, n => ts.isCallExpression(n) && n.expression.getText(app) === 'useEffect' &&
    n.arguments[0]?.getText(app).includes('preferences["notifications.desktop"]') &&
    /window\.hrig\.notify(?:Attention|SeatAttention)\s*\(/.test(n.arguments[0].getText(app)));
  const helpers = loadLocal('src/seat-pins.ts');
  // Only follow an import actually present in App. No proposed helper is required
  // for the preimplementation baseline or substituted by test-side logic.
  for (const statement of app.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === './seat-notifications')
      Object.assign(helpers, loadLocal('src/seat-notifications.ts'));
  }
  const prefs = settings();
  const context = vm.createContext({ ...helpers, window: { hrig: native.preload },
    connection: host, inventory: null, inventoryError: '',
    preferences: prefs.resolve(options.user || {}, options.project || {}),
    inventoryHealth: { current: { key: helpers.pinConnectionIdentity(host), verified: true,
      failures: 0, lastSuccessAt: 1 } },
  });
  context.pinOwner = helpers.pinConnectionIdentity(host);
  const body = effect.arguments[0].getText(app);
  function refs(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      ts.isCallExpression(node.initializer) && node.initializer.expression.getText(app) === 'useRef' &&
      body.includes(node.name.text) && !(node.name.text in context)) {
      context[node.name.text] = { current: node.initializer.arguments.length
        ? evaluate(node.initializer.arguments[0], app, context) : undefined };
    }
    ts.forEachChild(node, refs);
  }
  refs(app);
  let previous;
  return {
    native, context, defaults: prefs.defaults,
    async render(rows, changes = {}) {
      if (rows !== undefined) context.inventory = rows === null ? null : snapshot(rows);
      Object.assign(context, changes);
      context.pinOwner = helpers.pinConnectionIdentity(context.connection);
      const before = JSON.stringify(context.inventory);
      const dependencies = evaluate(effect.arguments[1], app, context);
      if (!previous || dependencies.length !== previous.length ||
        dependencies.some((value, i) => !Object.is(value, previous[i]))) {
        previous = Array.from(dependencies);
        evaluate(effect.arguments[0], app, context)();
      }
      await native.flush();
      assert.equal(JSON.stringify(context.inventory), before, 'actual effect never mutates input inventory');
      assert.deepEqual(native.unexpected, [], 'seat notifications grant no other action authority');
    },
  };
}

async function transitionScenario(options = {}) {
  const h = consumerHarness({ user: { 'notifications.desktop': true }, ...options });
  await h.render([seat]);
  assert.equal(h.native.notifications.length, 0, 'idle baseline reaches no native effect');
  await h.render([{ ...seat, status: 'attention' }]);
  return h;
}

if (require.main === module) {
  test('actual App default-off and project-off controls reach no preload or native effect', async () => {
    for (const options of [{}, { user: { 'notifications.desktop': true },
      project: { 'notifications.desktop': false } }]) {
      const h = consumerHarness(options);
      assert.equal(h.defaults['notifications.desktop'], false);
      await h.render([seat]);
      await h.render([{ ...seat, status: 'attention' }]);
      assert.deepEqual(h.native.requests, []);
      assert.deepEqual(h.native.notifications, []);
    }
  });
  test('actual opted-in App idle to attention reaches real preload trusted main and native show', async () => {
    const h = await transitionScenario();
    assert.equal(h.native.requests.length, 1, 'actual transport executes exactly once');
    assert.equal(h.native.notifications.length, 1, 'ordinary opted-in positive constructs once');
    assert.equal(h.native.notifications[0].shows, 1, 'ordinary opted-in positive requests show once');
    assert.ok(h.native.notifications[0].options.title.includes(seat.name), 'useful name reaches actual sink');
    assert.equal(h.native.notifications[0].options.silent, true);
    assert.ok(!h.native.notifications[0].listeners.some(l => /click|reply|action/i.test(l.name)));
  });
  test('actual App needs-input transition supplies exact seat-name-only silent native options', async () => {
    const h = await transitionScenario();
    assert.equal(h.native.notifications.length, 1, 'privacy assertion follows real useful native positive');
    assert.equal(h.native.notifications[0].shows, 1);
    assert.deepEqual(h.native.notifications[0].options, { title: 'Builder', silent: true },
      'R08 privacy: exact accepted seat name only; no suffix, rig, activity, error, prompt, host or path body');
    assert.deepEqual(JSON.parse(JSON.stringify(h.native.requests.map(r => r.args))), [[{ seatName: 'Builder' }]],
      'R08 renderer projection: a fresh one-key seatName request only');
  });
  test('actual App first enabled verified attention snapshot seeds silently before later transition', async () => {
    const h = consumerHarness({ user: { 'notifications.desktop': true } });
    await h.render([{ ...seat, status: 'attention' }]);
    assert.equal(h.native.notifications.length, 0, 'R08 enable baseline is silent, even for current attention');
    assert.deepEqual(h.native.requests, []);
    await h.render([seat]);
    await h.render([{ ...seat, status: 'attention' }]);
    assert.equal(h.native.notifications.length, 1, 'later represented transition still has a useful positive');
    assert.equal(h.native.notifications[0].shows, 1);
  });
  test('actual App failed-seat diagnostics do not request needs-input notifications', async () => {
    const h = consumerHarness({ user: { 'notifications.desktop': true } });
    await h.render([seat]);
    await h.render([{ ...seat, status: 'failed' }]);
    assert.equal(h.native.notifications.length, 0, 'R08 failed diagnostics are not needs-input events');
    assert.deepEqual(h.native.requests, []);
    await h.render([{ ...seat, status: 'attention' }]);
    assert.equal(h.native.notifications.length, 1, 'fresh attention contrast still requests once');
    assert.equal(h.native.notifications[0].shows, 1);
  });
}

module.exports = { consumerHarness, transitionScenario, host, seat, snapshot };

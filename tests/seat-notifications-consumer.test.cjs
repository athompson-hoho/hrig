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
  return vm.runInContext(ts.transpileModule('(' + node.getText(root).replace(/^export\s+/, '') + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
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
  return Object.freeze({ seats: Object.freeze(rows.map(row => row && typeof row === 'object'
    ? Object.freeze({ ...row }) : row)),
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

module.exports = { consumerHarness, transitionScenario, host, seat, snapshot, loadLocal, settings,
  source, find, evaluate };

const json = value => JSON.parse(JSON.stringify(value));
function assertOutput(h, names) {
  assert.deepEqual(h.native.notifications.map(n => n.options), names.map(title => ({ title, silent: true })));
  assert.deepEqual(json(h.native.requests.map(r => r.args)), names.map(seatName => [{ seatName }]));
  assert.ok(h.native.requests.every(r => r.channel === 'seat:notify-attention'));
  for (const n of h.native.notifications) {
    assert.equal(n.shows, 1); assert.deepEqual(n.listeners.map(l => l.name), ['failed']);
  }
  assert.deepEqual(h.native.unexpected, []);
}
function healthFor(connection = host, changes = {}) {
  return { key: loadLocal('src/seat-pins.ts').pinConnectionIdentity(connection), verified: true,
    failures: 0, lastSuccessAt: 1, ...changes };
}
// Plan02 may invoke this actual chain (or wrap its real preload transport).
// No tests are registered when this module is imported by a proof target.
async function privacyAuthorityScenario(options = {}) {
  const h = consumerHarness({ user: { 'notifications.desktop': true }, ...options });
  await h.render([seat]); assertOutput(h, []);
  await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
  await h.render([{ ...seat, status: 'attention', activity: 'CHANGED_PRIVATE_ACTIVITY', error: 'CHANGED_PRIVATE_ERROR' }]);
  assertOutput(h, ['Builder']);
  await h.render([seat]);
  h.context.inventoryHealth.current.failures = 1;
  await h.render(undefined); assertOutput(h, ['Builder']);
  h.context.inventoryHealth.current.failures = 0;
  await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
  await h.render([seat]);
  await h.render([{ ...seat, status: 'attention', name: 'Fresh contrast' }]);
  assertOutput(h, ['Builder', 'Fresh contrast']);
  return h;
}
module.exports.privacyAuthorityScenario = privacyAuthorityScenario;

function preferenceHarness(user = {}, project = {}) {
  const app = source('src/App.tsx'), prefs = source('src/settings.ts');
  const react = { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } };
  const context = vm.createContext({ React: react, isWindows: false, projectId: 'synthetic-project',
    state: { preferences: user, projectPreferences: { 'synthetic-project': project } },
  });
  const declaration = name => find(app, n => ts.isVariableDeclaration(n) && n.name.getText(app) === name);
  context.defaults = evaluate(find(prefs, n => ts.isVariableDeclaration(n) && n.name.getText(prefs) === 'defaults').initializer, prefs, context);
  const row = find(prefs, n => ts.isObjectLiteralExpression(n) && n.properties.some(p =>
    ts.isPropertyAssignment(p) && p.name.getText(prefs) === 'key' && p.initializer.text === 'notifications.desktop'));
  context.schema = [evaluate(row, prefs, context)];
  for (const name of ['validateOverrides', 'safeOverrides', 'resolveSettings']) {
    const fn = find(prefs, n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    context[name] = evaluate(fn, prefs, context);
  }
  context.useMemo = fn => fn();
  context.setState = change => { context.state = change(context.state); };
  context.changePreferences = evaluate(declaration('changePreferences').initializer, app, context);
  function refresh() {
    for (const name of ['userPreferences', 'projectPreferences', 'preferences'])
      context[name] = evaluate(declaration(name).initializer, app, context);
    context.settingsContext = evaluate(declaration('settingsContext').initializer, app, context);
  }
  function attentionToggle(value) {
    const panel = find(app, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(app) === 'AttentionPanel');
    const attribute = panel.attributes.properties.find(n => n.name?.text === 'onNotifications');
    evaluate(attribute.initializer.expression, app, context)(value); refresh();
  }
  function settingsRow(scope) {
    const page = source('src/SettingsPage.tsx');
    const rowFn = find(page, n => ts.isFunctionDeclaration(n) && n.name?.text === 'Row');
    const rowContext = vm.createContext({ React: react, defaults: context.defaults,
      validateOverrides: context.validateOverrides, useSettings: () => context.settingsContext,
      useState: value => [value, () => {}], useEffect() {}, RotateCcw: 'RotateCcw' });
    return evaluate(rowFn, page, rowContext)({ row: context.schema[0], scope });
  }
  refresh(); return { context, refresh, attentionToggle, settingsRow };
}

if (require.main === module) {
  test('actual chain quiet failure with retained inventory ref disarms and recovers before fresh exact positive', () => privacyAuthorityScenario());
  const { ownerChanges, nameCases } = require('./seat-notifications.test.cjs');
  for (const [axis, value] of ownerChanges) test(`actual App raw ${axis} repoint with retained inventory and return to absent slots silently reseeds`, async () => {
    const h = consumerHarness({ user: { 'notifications.desktop': true } });
    await h.render([seat]);
    const connection = Object.freeze({ ...host, [axis]: value });
    await h.render(undefined, { connection }); // old health and exact retained inventory
    assertOutput(h, []);
    await h.render([{ ...seat, status: 'attention' }], { inventoryHealth: { current: healthFor(connection) } });
    assertOutput(h, []);
    await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
    await h.render(undefined, { connection: host });
    await h.render(undefined, { inventoryHealth: { current: healthFor() } }); assertOutput(h, ['Builder']);
    await h.render([seat]); await h.render([{ ...seat, status: 'attention', name: 'Original owner contrast' }]);
    assertOutput(h, ['Builder', 'Original owner contrast']);
  });
  const gaps = [
    ['quiet failure one', h => { h.context.inventoryHealth.current.failures = 1; }],
    ['quiet failure two', h => { h.context.inventoryHealth.current.failures = 2; }],
    ['reported stale failure', h => { h.context.inventoryHealth.current.failures = 3; }],
    ['unverified checking', h => { h.context.inventoryHealth.current.verified = false; }],
    ['foreign health key', h => { h.context.inventoryHealth.current.key = 'foreign'; }],
    ['inventory error', h => { h.context.inventoryError = 'PRIVATE_INVENTORY_ERROR'; }],
    ['missing inventory', h => { h.context.inventory = null; }],
    ['disabled', h => { h.context.preferences = { ...h.context.preferences, 'notifications.desktop': false }; }],
  ];
  for (const [label, invalidate] of gaps) test(`actual App ${label} dependency invalidates retained snapshot then silently rearms`, async () => {
    const h = consumerHarness({ user: { 'notifications.desktop': true } });
    await h.render([seat]); const retained = h.context.inventory;
    invalidate(h); await h.render(undefined);
    if (label !== 'missing inventory') assert.equal(h.context.inventory, retained);
    assertOutput(h, []);
    await h.render([{ ...seat, status: 'attention' }], { inventoryError: '', inventoryHealth: { current: healthFor() },
      preferences: settings().resolve({ 'notifications.desktop': true }) });
    assertOutput(h, []);
    await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
  });
  test('actual App zero many order exact fresh projections continuous rename duplicate repair and leave reentry', async () => {
    const h = consumerHarness({ user: { 'notifications.desktop': true } });
    await h.render([]); assertOutput(h, []);
    const a = { ...seat, id: 'a', name: ' A ', status: 'attention' };
    const b = { ...seat, id: 'b', name: 'B', status: 'attention' };
    await h.render([b, a, b]); assertOutput(h, ['B', ' A ']);
    assert.notEqual(h.native.requests[0].args[0], h.native.requests[1].args[0]);
    await h.render([{ ...a, name: 'Renamed', activity: 'PRIVATE_NEW', error: 'PRIVATE_NEW' }, b]);
    assertOutput(h, ['B', ' A ']);
    await h.render([]);
    await h.render([a, { ...a, name: 'Conflict' }, b, { ...b, status: 'idle' }]);
    assertOutput(h, ['B', ' A ']);
    await h.render([a, b]); assertOutput(h, ['B', ' A ']);
    await h.render([{ ...a, status: 'idle' }, { ...b, status: 'failed' }]);
    await h.render([a, b]); assertOutput(h, ['B', ' A ', ' A ', 'B']);
  });
  test('actual App malformed IDs and exact Unicode names refuse without metadata fallback then fresh positives work', async () => {
    for (const id of ['', ' ', null, undefined, 1]) {
      const h = consumerHarness({ user: { 'notifications.desktop': true } });
      await h.render([]); await h.render([{ ...seat, id, status: 'attention' }]); assertOutput(h, []);
      await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
    }
    for (const [name, accepted] of nameCases.filter(([name]) => typeof name !== 'object' && name !== undefined)) {
      const h = consumerHarness({ user: { 'notifications.desktop': true } });
      await h.render([]); await h.render([{ ...seat, name, status: 'attention' }]);
      assertOutput(h, accepted ? [name] : []);
      await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]);
      assertOutput(h, accepted ? [name, 'Builder'] : ['Builder']);
    }
  });
  test('actual App disable reenable never queues disabled transitions and content does not replay native failures', async () => {
    const h = await transitionScenario(); assertOutput(h, ['Builder']);
    h.native.failNotification();
    await h.render([{ ...seat, status: 'attention', activity: 'PRIVATE_CHANGED' }]); assertOutput(h, ['Builder']);
    await h.render([seat], { preferences: settings().resolve() });
    await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder']);
    await h.render(undefined, { preferences: settings().resolve({ 'notifications.desktop': true }) });
    assertOutput(h, ['Builder']);
    await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]); assertOutput(h, ['Builder', 'Builder']);
  });
  test('actual effective settings Attention callback and Settings reset preserve user project precedence through native contrasts', async () => {
    const { flatten } = require('./attention-inbox-app.test.cjs');
    for (const [user, project, scope, initial] of [
      [{}, {}, 'user', false], [{ 'notifications.desktop': true }, {}, 'user', true],
      [{ 'notifications.desktop': true }, { 'notifications.desktop': false }, 'project', false],
      [{ 'notifications.desktop': false }, { 'notifications.desktop': true }, 'project', true],
    ]) {
      const p = preferenceHarness(user, project);
      const h = consumerHarness({ user, project });
      assert.equal(p.context.preferences['notifications.desktop'], initial);
      assert.equal(p.context.defaults['notifications.desktop'], false);
      await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]);
      assertOutput(h, initial ? ['Builder'] : []);
      const untouchedScope = json(scope === 'project' ? p.context.state.preferences : p.context.state.projectPreferences);
      p.attentionToggle(false);
      assert.equal(p.context.preferences['notifications.desktop'], false);
      assert.deepEqual(json(scope === 'project' ? p.context.state.preferences : p.context.state.projectPreferences), untouchedScope);
      assert.equal((scope === 'project' ? p.context.state.projectPreferences['synthetic-project'] : p.context.state.preferences)['notifications.desktop'], false);
      await h.render([seat], { preferences: p.context.preferences });
      p.attentionToggle(true);
      await h.render([{ ...seat, status: 'attention' }], { preferences: p.context.preferences });
      assertOutput(h, initial ? ['Builder'] : []);
      await h.render([seat]); await h.render([{ ...seat, status: 'attention', name: 'Settings contrast' }]);
      const names = initial ? ['Builder', 'Settings contrast'] : ['Settings contrast'];
      assertOutput(h, names);
      const tree = flatten(p.settingsRow(scope));
      const checkbox = tree.find(n => n?.type === 'input' && n.props.type === 'checkbox');
      assert.equal(checkbox.props.checked, true); assert.ok(!checkbox.props.disabled);
      checkbox.props.onChange({ target: { checked: false } }); p.refresh();
      assert.equal(p.context.preferences['notifications.desktop'], false, 'real Settings checkbox updates same preference');
      const reset = flatten(p.settingsRow(scope)).find(n => n?.type === 'button' && n.props.className === 'setting-reset');
      assert.equal(reset.props.disabled, false); reset.props.onClick(); p.refresh();
      assert.equal(Object.hasOwn(scope === 'project' ? p.context.projectPreferences : p.context.userPreferences, 'notifications.desktop'), false);
      const inherited = scope === 'project' ? !!user['notifications.desktop'] : false;
      assert.equal(p.context.preferences['notifications.desktop'], inherited);
      await h.render([seat], { preferences: p.context.preferences });
      await h.render([{ ...seat, status: 'attention', name: 'After reset' }]);
      assertOutput(h, inherited ? [...names, 'After reset'] : names);
    }
  });
  test('actual legacy explicit opt-in migration preserves prior true and honors existing explicit preferences', async () => {
    const app = source('src/App.tsx');
    const migration = find(app, n => ts.isPropertyAssignment(n) && n.name.getText(app) === 'preferences' &&
      n.initializer.getText(app).includes('base.desktopNotifications'));
    for (const [base, enabled] of [[{}, false], [{ desktopNotifications: false }, false],
      [{ desktopNotifications: true }, true],
      [{ desktopNotifications: true, preferences: {} }, false],
      [{ desktopNotifications: true, preferences: { 'notifications.desktop': false } }, false],
      [{ preferences: { 'notifications.desktop': true } }, true]]) {
      const user = evaluate(migration.initializer, app, vm.createContext({ base }));
      if (base.preferences) assert.equal(user, base.preferences, 'existing preference owner survives migration');
      const h = consumerHarness({ user });
      assert.equal(h.context.preferences['notifications.desktop'], enabled);
      await h.render([seat]); await h.render([{ ...seat, status: 'attention' }]);
      assertOutput(h, enabled ? ['Builder'] : []);
    }
  });
  test('actual Attention checkbox stays editable with support copy during loading error and checking without triggering queue or actions', () => {
    const { harness, flatten } = require('./attention-inbox-app.test.cjs');
    for (const state of ['loading', 'error', 'checking']) {
      const h = harness(); const p = preferenceHarness();
      h.scope.inventory = null;
      h.scope.inventoryError = state === 'error' ? 'SYNTHETIC_INVENTORY_UNAVAILABLE' : '';
      h.scope.inventoryHealth.current.verified = false;
      h.scope.settingsContext = { update: (...args) => { p.context.settingsContext.update(...args); p.refresh(); } };
      let tree = flatten(h.render()); // intentionally do not flush unrelated pre-existing queue effect
      let checkbox = tree.find(n => n?.type === 'input' && n.props.type === 'checkbox');
      assert.equal(checkbox.props.checked, false); assert.ok(!checkbox.props.disabled);
      assert.ok(tree.some(n => typeof n === 'string' && n.includes('Enabling starts silently; only later changes notify.')));
      assert.ok(tree.some(n => typeof n === 'string' && n.includes('Desktop notification support and OS settings may prevent display.')));
      checkbox.props.onChange({ target: { checked: true } });
      h.scope.preferences = p.context.preferences;
      tree = flatten(h.render()); checkbox = tree.find(n => n?.type === 'input' && n.props.type === 'checkbox');
      assert.equal(checkbox.props.checked, true); assert.deepEqual(h.effects, []);
      checkbox.props.onChange({ target: { checked: false } });
      assert.equal(p.context.preferences['notifications.desktop'], false); assert.deepEqual(h.effects, []);
    }
  });
}

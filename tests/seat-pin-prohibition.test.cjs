const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Only these source expressions run; no App render, bridge, host or timer runs.
function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(root, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  assert.equal(matches.length, 1, 'actual source seam must be unique');
  return matches[0];
}
function evaluate(node, root, scope) {
  const context = vm.createContext({ ...scope });
  vm.runInContext(ts.transpileModule(`result = (${node.getText(root)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context, { timeout: 1000 });
  assert.notEqual(typeof context.result, 'undefined', 'actual expression evaluates');
  return context.result;
}
const app = source('src/App.tsx');
const sidebar = source('src/Sidebar.tsx');
const callback = find(app, n => ts.isJsxAttribute(n) && n.name.text === 'onToggleSeatPin')
  .initializer.expression;
const variable = name => find(app, n => ts.isVariableDeclaration(n) &&
  n.name.getText(app) === name).initializer;
const button = find(sidebar, n => ts.isJsxOpeningElement(n) && n.tagName.getText(sidebar) === 'button' &&
  n.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.text === 'className' &&
    ts.isStringLiteral(p.initializer) && p.initializer.text.split(/\s+/).includes('seat-pin')));
const click = button.attributes.properties.find(p => p.name?.text === 'onClick').initializer.expression;
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/seat-pins.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: helpers });

test('pin and unpin remain local without host authority', () => {
  const effects = [];
  const spy = name => (...args) => { effects.push({ name, args }); };
  const hostEffects = Object.fromEntries([
    'openSeat', 'openSeatBeside', 'dragSeat', 'startSeat', 'stopSeat', 'deleteSeat',
    'sendInput', 'writeTerminal', 'setRelaunch', 'relaunchSeat', 'refreshInventory',
    'refreshAll', 'refresh', 'setInventory',
  ].map(name => [name, spy(name)]));
  const hrig = new Proxy({}, { get: (_, name) => spy(`window.hrig.${String(name)}`) });
  const scopeEffects = { ...hostEffects, window: { hrig },
    setTimeout: spy('setTimeout'), setInterval: spy('setInterval'), fetch: spy('fetch'),
    onSeat: hostEffects.openSeat, onSeatBeside: hostEffects.openSeatBeside,
    onRelaunch: hostEffects.setRelaunch, onDrag: hostEffects.dragSeat,
    onRefresh: hostEffects.refreshInventory };
  const host = { id: 'host', kind: 'ssh', host: 'server', name: 'Host', root: '~' };
  const local = { id: 'local', kind: 'local', name: 'Local', root: '~' };
  const expectedPin = '["host","ssh","server",null,null,null,"rig:seat"]';
  const workspace = extra => ({ version: 1, connections: [host], activeConnection: 'host',
    pinnedSeats: [], sidebarWidth: 321, ...extra });
  const seat = { id: 'rig:seat', name: 'Seat', rigName: 'Rig', status: 'unknown' };
  function handler(state, owner, setState, health = 'fresh') {
    const scope = { ...scopeEffects, ...helpers, state, local, setState,
      inventoryHealth: { current: { key: owner, status: health } } };
    for (const name of ['connection', 'pinOwner', 'pinsAvailable']) {
      scope[name] = evaluate(variable(name), app, scope);
    }
    const actualOnToggleSeatPin = evaluate(callback, app, scope);
    let subject = actualOnToggleSeatPin;
    if (process.env.GSD_PROHIB_SUBJECT) {
      const fixture = require(path.resolve(process.cwd(), process.env.GSD_PROHIB_SUBJECT));
      assert.equal(typeof fixture.createPinSubject, 'function', 'fixture factory must exist');
      subject = fixture.createPinSubject({ actualOnToggleSeatPin, hostEffects });
      assert.equal(typeof subject, 'function', 'fixture must return callback');
    }
    return { available: scope.pinsAvailable, actualOnToggleSeatPin,
      click: evaluate(click, sidebar, { ...scopeEffects, s: seat,
        pinsAvailable: scope.pinsAvailable, onToggleSeatPin: subject }) };
  }
  for (const health of ['fresh', 'stale', 'checking']) {
    let state = workspace();
    const initial = state;
    const pin = handler(state, helpers.pinConnectionIdentity(host), update => { state = update(state); }, health);
    assert.equal(pin.available, true);
    pin.click();
    assert.deepEqual(Array.from(state.pinnedSeats), [expectedPin], `${health}: pin changes membership`);
    assert.equal(state.sidebarWidth, initial.sidebarWidth);
    pin.click();
    assert.deepEqual(Array.from(state.pinnedSeats), [], `${health}: unpin reverses membership`);
  }
  const queued = [];
  const foreign = handler(workspace(), helpers.pinConnectionIdentity(local), update => queued.push(update));
  assert.equal(foreign.available, false);
  foreign.click();
  foreign.actualOnToggleSeatPin(seat); // also challenge the App guard independently
  assert.equal(queued.length, 0, 'foreign inventory never schedules mutation');
  handler(workspace(), helpers.pinConnectionIdentity(host), update => queued.push(update)).click();
  assert.equal(queued.length, 1);
  for (const latest of [workspace({ connections: [local, host], activeConnection: 'local' }),
    workspace({ connections: [{ ...host, host: 'repointed' }] }),
    workspace({ connections: [{ ...host, rigBinary: '/other/rig' }] })]) {
    assert.equal(queued[0](latest), latest, 'queued callback rejects changed host by object identity');
  }
  assert.deepEqual(effects, [], 'zero host effects: pin and unpin remain local');
});

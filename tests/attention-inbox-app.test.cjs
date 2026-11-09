const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual panel and factory expression with inert legacy effects.
// This establishes source behavior, not native focus or live attachment.
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
function evaluate(node, root, scope) {
  const context = vm.createContext({ ...scope });
  const expression = node.getText(root).replace(/^export\s+/, '');
  vm.runInContext(ts.transpileModule(`result = (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return context.result;
}
const React = { createElement(type, props, ...children) { return { type, props: { ...props, children } }; } };
function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value == null || value === false) return [];
  return typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [value];
}

function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: id => dependencies[id] || require(id) });
  return exports;
}
const pins = load("src/seat-pins.ts");
const helpers = { ...pins, ...load("src/attention-inbox.ts", { "./seat-pins": pins }) };
const host = { id: "host", name: "Host", kind: "ssh", host: "server", root: "~" };
const seat = { id: "rig:seat", name: "Builder", rigId: "rig", rigName: "Rig", pod: "Workers", status: "attention", session: "session" };
let nextPanelId = 0;
function harness(authority = {}) {
  const panelId = `attention-test-${nextPanelId++}`;
  const inventory = { seats: [seat], rigs: [], sampledAt: "now" };
  const panels = source("src/WorkbenchPanels.tsx");
  const panel = find(panels, n => ts.isFunctionDeclaration(n) && n.name?.text === "AttentionPanel");
  const effects = [];
  const states = []; let cursor = 0; let pendingEffect; let cleanup; let deps;
  // The real visibleInterval wraps the authority's timer functions, so the
  // tests keep observing every interval the panel registers.
  const visibleInterval = (fn, ms) => {
    const id = authority.setInterval ? authority.setInterval(fn, ms) : undefined;
    return () => authority.clearInterval?.(id);
  };
  const component = evaluate(panel, panels, { React, ...helpers, ...authority, visibleInterval,
    useId: () => panelId,
    useState: value => { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], v => { states[i] = v; }]; },
    useEffect: (fn, next) => { if (JSON.stringify(deps) !== JSON.stringify(next)) { deps = next; pendingEffect = fn; } },
    AlertCircle: "AlertCircle", StatusDot: "StatusDot", ErrorBox: "ErrorBox", Loading: "Loading", Empty: "Empty", Check: "Check" });
  const app = source("src/App.tsx");
  const factory = find(app, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(app) === "AttentionPanel");
  const scope = { React, ...helpers, ...authority, AttentionPanel: component,
    config: { connection: host }, connection: host, inventory, inventoryError: "",
    inventoryHealth: { current: { key: pins.pinConnectionIdentity(host), verified: true } },
    stateRef: { current: { connections: [host], activeConnection: host.id } }, local: host,
    modelRef: { current: { getNodeById() {} } },
    preferences: { "notifications.desktop": false }, projectPreferences: {}, settingsContext: { update() {} },
    attentionContext: { current: { connection: host, inventory, inventoryError: "",
      openSeat: value => effects.push({ name: "open", args: [value] }),
      focusPanel: id => effects.push({ name: "focus", args: [id] }) } } };
  scope.jumpAttention = evaluate(find(app, n => ts.isVariableDeclaration(n) && n.name.getText(app) === "jumpAttention").initializer, app, scope);
  function render() { cursor = 0; return component(evaluate(factory, app, scope).props); }
  function flush() { if (pendingEffect) { cleanup?.(); const fn = pendingEffect; pendingEffect = null; cleanup = fn(); } }
  function click() {
    const jump = flatten(render()).find(n => n?.type === "button" && flatten(n.props.children).some(v => typeof v === "string" && v.includes("Jump")));
    assert.ok(jump, "actual panel must expose contextual explicit Jump");
    assert.match(jump.props["aria-label"], /Builder.*Rig.*Workers.*Host/);
    jump.props.onClick();
  }
  return { scope, effects, render, click, flush, states };
}
if (require.main === module) test("actual AttentionPanel exposes contextual explicit Jump through actual App factory", () => {
  const h = harness();
  assert.deepEqual(h.effects, [], "render never opens a seat");
  h.click();
  assert.equal(h.effects.length, 1);
  assert.equal(h.effects[0].args[0], seat);
});
if (require.main === module) test("actual callback rejects all raw owner transitions, stale health, missing and changed seats", () => {
  for (const change of [{ id: "other" }, { kind: "wsl" }, { host: "Server" }, { port: 22 }, { distro: "Ubuntu" }, { rigBinary: "rig" }]) {
    const h = harness(); h.scope.stateRef.current.connections = [{ ...host, ...change }];
    const reason = h.scope.jumpAttention(host, seat);
    assert.ok(reason); assert.deepEqual(h.effects, []);
  }
  for (const mutate of [h => h.scope.inventoryHealth.current.verified = false,
    h => h.scope.attentionContext.current.inventoryError = "offline",
    h => h.scope.attentionContext.current.inventory = null,
    h => h.scope.attentionContext.current.inventory = { seats: [] },
    h => h.scope.attentionContext.current.inventory = { seats: [{ ...seat, session: "changed" }] },
    h => h.scope.attentionContext.current.inventory = { seats: [{ ...seat, status: "idle" }] }]) {
    const h = harness(); mutate(h); assert.ok(h.scope.jumpAttention(host, seat)); assert.deepEqual(h.effects, []);
  }
});
if (require.main === module) test("actual callback uses latest model/actions and refuses unsafe existing target", () => {
  const h = harness(); const id = "seat:host:rig:seat";
  for (const layout of ["main", "popout", "detached"]) {
    h.scope.modelRef.current = { getNodeById: () => ({ getComponent: () => "terminal",
      getConfig: () => ({ connection: host, seat, terminalId: id }),
      getDocument: () => ({}), getWindow: () => ({ closed: false }), getLayoutId: () => layout }) };
    assert.equal(h.scope.jumpAttention(host, seat), "");
  }
  assert.deepEqual(h.effects.map(e => e.name), ["focus", "focus", "focus"]);
  h.effects.length = 0;
  for (const node of [{}, { getComponent: () => "editor" }, { getComponent: () => "terminal", getConfig: () => ({ connection: host, seat, terminalId: id }) }]) {
    h.scope.modelRef.current = { getNodeById: () => node };
    assert.ok(h.scope.jumpAttention(host, seat)); assert.deepEqual(h.effects, []);
  }
});
module.exports = { harness, host, seat, helpers, flatten };

if (require.main === module) test('disabled duplicate Jump controls describe their own visible reasons across panels', () => {
  const ids = [];
  for (const h of [harness(), harness()]) {
    h.scope.inventory = { seats: [{ ...seat, session: null }, { ...seat, session: null }] };
    const tree = flatten(h.render());
    for (const button of tree.filter(n => n?.type === 'button')) {
      assert.equal(button.props.disabled, true);
      const id = button.props['aria-describedby'];
      assert.ok(id, 'disabled Jump associates its visible reason');
      const reasons = tree.filter(n => n?.props?.id === id);
      assert.equal(reasons.length, 1);
      assert.match(flatten(reasons[0].props.children).join(''), /no attachable.*session/i);
      ids.push(id);
    }
  }
  assert.equal(new Set(ids).size, 4, 'descriptions do not collide across duplicate rows or panels');
});

if (require.main === module) test('actual panel reports owned missing inventory error without loading or empty claim', () => {
  const h = harness(); h.scope.inventory = null; h.scope.inventoryError = 'offline';
  const tree = flatten(h.render());
  assert.ok(tree.some(n => typeof n === 'string' && /Could not verify.*offline/.test(n)));
  assert.ok(!tree.some(n => typeof n === 'string' && /Loading/.test(n)));
  assert.ok(!tree.some(n => n?.props?.title === 'No seats need input'));
  assert.equal(tree.filter(n => n?.type === 'button').length, 0);
});
if (require.main === module) test('actual panel qualifies stale and checking counts while keeping healthy count fresh', () => {
  const h = harness();
  const heading = () => flatten(h.render()).find(n => n?.type === 'h4');
  assert.equal(flatten(heading().props.children).join(''), 'Needs input (1)');
  h.scope.inventoryError = 'offline';
  assert.equal(flatten(heading().props.children).join(''), 'Last known needs input (1)');
  h.scope.inventoryError = ''; h.scope.inventoryHealth.current.verified = false;
  assert.equal(flatten(heading().props.children).join(''), 'Last known needs input (1)');
  assert.ok(flatten(h.render()).some(n => typeof n === 'string' && /unverified|Checking/.test(n)));
  assert.ok(flatten(h.render()).filter(n => n?.type === 'button').every(n => n.props.disabled));
});

if (require.main === module) test('actual panel covers zero one many duplicate partial long text stale foreign diagnostic and notification states', () => {
  const h = harness();
  const labels = tree => flatten(tree).filter(n => n?.type === 'button');
  for (const rows of [[], [seat], [seat, seat]]) {
    h.scope.inventory = { seats: rows };
    const tree = h.render(); assert.equal(labels(tree).length, rows.length);
    assert.ok(flatten(tree).includes(` (${rows.length})`));
  }
  const partial = { ...seat, name: '', rigName: '', rigId: '', pod: '', session: null };
  const failed = { ...seat, id: 'failed', status: 'failed', error: '<script>diagnostic</script>' };
  const long = { ...seat, id: 'long', name: 'long '.repeat(200) };
  h.scope.inventory = { seats: [partial, failed, long] };
  let tree = h.render(); const buttons = labels(tree);
  assert.equal(buttons.length, 3); assert.equal(buttons[0].props.disabled, true);
  assert.match(buttons[0].props['aria-label'], /Seat name unavailable.*Rig unavailable.*Pod unavailable/);
  assert.ok(flatten(tree).includes(failed.error)); assert.match(buttons[1].props['aria-label'], /^Jump/);
  assert.ok(buttons.some(b => b.props['aria-label'].includes(long.name)));
  const settings = []; h.scope.settingsContext.update = (...args) => settings.push(args);
  tree = h.render(); flatten(tree).find(n => n?.type === 'input').props.onChange({ target: { checked: true } });
  assert.deepEqual(settings, [['user', 'notifications.desktop', true]]);
  for (const change of [() => { h.scope.inventoryError = 'offline'; }, () => { h.scope.inventoryHealth.current.verified = false; }]) {
    change(); tree = h.render(); assert.ok(labels(tree).every(b => b.props.disabled));
    assert.ok(flatten(tree).some(n => typeof n === 'string' && /Last known/.test(n)));
  }
  h.scope.connection = { ...host, host: 'foreign' }; tree = h.render();
  assert.equal(labels(tree).length, 0); assert.ok(!flatten(tree).some(n => n?.props?.title === 'No seats need input'));
});
if (require.main === module) test('latest actions healthy busy and fresh independent refusal axes preserve navigation authority', () => {
  for (const mutate of [h => { h.scope.inventoryHealth.current.key = 'foreign'; },
    h => { h.scope.attentionContext.current.connection = { ...host, port: 22 }; },
    h => { h.scope.attentionContext.current.inventory = { seats: [seat, { ...seat, rigId: 'other' }] }; },
    h => { h.scope.attentionContext.current.inventory = { seats: [{ ...seat, session: null }] }; }]) {
    const h = harness(); const button = flatten(h.render()).find(n => n?.type === 'button');
    mutate(h); button.props.onClick(); assert.deepEqual(h.effects, []);
    assert.ok(flatten(h.render()).some(n => n?.type === 'ErrorBox' && n.props.error));
  }
  const h = harness(); const calls = [];
  h.scope.attentionContext.current.openSeat = value => calls.push(value);
  h.scope.stateRef.current.connections = [{ ...host, name: 'Renamed', root: '/new' }];
  h.scope.busy = true; h.click(); assert.deepEqual(calls, [seat]); assert.deepEqual(h.effects, []);
});

if (require.main === module) test('malformed current layout refuses visibly without throwing or navigating', () => {
  for (const node of [{ getConfig() { throw Error('broken'); } },
    { getConfig: () => ({}), getComponent: 'terminal' },
    { getComponent: () => 'terminal', getConfig: () => null },
    { getComponent: () => 'terminal', getConfig: () => ({ connection: { ...host, host: 'other' }, seat, terminalId: 'seat:host:rig:seat' }) },
    { getComponent: () => 'terminal', getConfig: () => ({ connection: host, seat: { ...seat, session: 'other' }, terminalId: 'seat:host:rig:seat' }) }]) {
    const h = harness(); h.scope.modelRef.current = { getNodeById: () => node };
    assert.doesNotThrow(() => h.click());
    assert.deepEqual(h.effects, []);
    assert.ok(flatten(h.render()).some(n => n?.type === 'ErrorBox' && /preserved/.test(n.props.error)));
  }
});
if (require.main === module) test('owned empty inventory has separate inbox and diagnostic empty states', () => {
  const h = harness(); h.scope.inventory = { seats: [] };
  const tree = flatten(h.render());
  assert.ok(tree.some(n => n?.props?.title === 'No seats need input'));
  assert.ok(tree.includes('No failed-seat diagnostics in the available represented inventory.'));
});
if (require.main === module) test('queue rows suppress before raw owner effect and late responses cannot cross owners', async () => {
  const requests = [], timers = [], cleared = [];
  const h = harness({ window: { hrig: { queue: connection => new Promise(resolve => requests.push({ connection, resolve })) } },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: id => cleared.push(id) });
  h.render(); h.flush();
  requests[0].resolve([{ id: 'old', title: 'Old blocked', status: 'blocked' }, { title: 'Ignore', status: 'done' }]);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(flatten(h.render()).includes('Old blocked'));
  timers[0].fn(); // leave an old-owner request in flight
  h.scope.config.connection = { ...host, host: 'other' };
  assert.ok(!flatten(h.render()).includes('Old blocked'), 'old rows hidden before effect');
  h.flush(); requests[1].resolve([{ title: 'Late foreign', status: 'failed' }]);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(!flatten(h.render()).includes('Late foreign'));
  requests[2].resolve([]); await Promise.resolve(); await Promise.resolve();
  assert.ok(flatten(h.render()).includes('No blocked or failed work was reported for Host.'));
  assert.deepEqual(timers.map(t => t.ms), [15000, 15000]); assert.deepEqual(cleared, [1]);
});

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

test('actual AttentionPanel exposes contextual explicit Jump through actual App factory', () => {
  const host = { id: 'host', name: 'Host', kind: 'ssh', host: 'server', root: '~' };
  const seat = { id: 'rig:seat', name: 'Builder', rigId: 'rig', rigName: 'Rig', pod: 'Workers', status: 'attention', session: 'session' };
  const inventory = { seats: [seat], rigs: [], sampledAt: 'now' };
  const panels = source('src/WorkbenchPanels.tsx');
  const panel = find(panels, n => ts.isFunctionDeclaration(n) && n.name?.text === 'AttentionPanel');
  const effects = [];
  const component = evaluate(panel, panels, { React,
    useState: value => [value, () => {}], useEffect: () => {},
    AlertCircle: 'AlertCircle', StatusDot: 'StatusDot', ErrorBox: 'ErrorBox', Loading: 'Loading', Empty: 'Empty', Check: 'Check' });
  const app = source('src/App.tsx');
  const factory = find(app, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(app) === 'AttentionPanel');
  const element = evaluate(factory, app, { React, AttentionPanel: component,
    config: { connection: host }, connection: host, inventory,
    openSeat: value => effects.push(value), preferences: { 'notifications.desktop': false },
    projectPreferences: {}, settingsContext: { update() {} } });
  const tree = component(element.props);
  const nodes = flatten(tree);
  assert.deepEqual(effects, [], 'render never opens a seat');
  const jump = nodes.find(n => n?.type === 'button' && flatten(n.props.children).some(v => typeof v === 'string' && v.includes('Jump')));
  assert.ok(jump, 'actual panel must expose contextual explicit Jump');
  assert.match(jump.props['aria-label'], /Builder.*Rig.*Workers.*Host/);
  jump.props.onClick();
  assert.equal(effects.length, 1);
  assert.equal(effects[0], seat);
});

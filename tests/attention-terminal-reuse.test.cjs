const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Evaluate the registered production callback, never a copy of its body.
function createHandler(scope) {
  const source = ts.createSourceFile('main.cjs', fs.readFileSync('electron/main.cjs', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'handle' &&
      n.arguments[0]?.text === 'terminal:create') matches.push(n.arguments[1]);
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, 'actual terminal:create must be unique');
  const context = vm.createContext(scope);
  vm.runInContext(`result = (${matches[0].getText(source)});`, context);
  return context.result;
}

test('actual terminal:create refuses foreign retained owner without touching its PTY', async () => {
  const connection = { id: 'host', kind: 'ssh', host: 'server', name: 'Host' };
  const effects = [];
  const terminal = { kill: () => effects.push('kill'), write: () => effects.push('write') };
  const item = { terminal, buffer: 'original owner output', connection: { ...connection, host: 'foreign' }, seatId: 'seat', session: 'session' };
  const terminals = new Map([['seat:host:seat', item]]);
  const handler = createHandler({ terminals, core: { validateConnection() {} },
    backend: { inventory: async () => ({ seats: [{ id: 'seat', session: 'session' }] }) },
    process, require, rigControl: { consumeTerminal: () => effects.push('consume') },
    terminalLogs: { forget: () => effects.push('forget') } });
  let rejected = false;
  try { await handler({ sender: {} }, { id: 'seat:host:seat', connection, seatId: 'seat', session: 'session' }); }
  catch (error) { rejected = true; }
  assert.equal(rejected, true, 'foreign retained owner must refuse reuse before returning its buffer');
  assert.equal(terminals.get('seat:host:seat'), item);
  assert.equal(item.terminal, terminal);
  assert.equal(item.buffer, 'original owner output');
  assert.deepEqual(effects, []);
});

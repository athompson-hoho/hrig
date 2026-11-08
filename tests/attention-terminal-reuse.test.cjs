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
  const context = vm.createContext({ seatTerminalReuse: require("../electron/terminal-reuse.cjs").seatTerminalReuse, ...scope });
  vm.runInContext(`result = (${matches[0].getText(source)});`, context);
  return context.result;
}

if (require.main === module) test('actual terminal:create refuses foreign retained owner without touching its PTY', async () => {
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

module.exports = { createHandler };

function hostFixture(options, retained) {
  const effects = [], callbacks = {};
  const terminal = { kill: (...args) => effects.push({ name: 'kill', args }), write: (...args) => effects.push({ name: 'write', args }),
    onData: fn => { callbacks.data = fn; }, onExit: fn => { callbacks.exit = fn; } };
  const terminals = new Map(retained ? [[options.id, retained]] : []);
  for (const name of ['set', 'delete', 'clear']) { const original = terminals[name].bind(terminals);
    terminals[name] = (...args) => { effects.push({ name, args }); return original(...args); }; }
  const record = name => (...args) => { effects.push({ name, args }); };
  const scope = { terminals, process, core: { validateConnection() {}, quote: v => v, sessionCommand: v => `attach ${v}`,
    transport: (...args) => { effects.push({ name: 'transport', args }); return { file: 'inert', args: ['fixture'] }; } },
    backend: { inventory: async () => ({ seats: [{ id: options.seatId, session: options.session }] }) },
    require: name => { assert.equal(name, 'node-pty'); return { spawn: (...args) => { effects.push({ name: 'spawn', args }); return terminal; } }; },
    features: { rigCommand: () => 'control' },
    rigControl: { consumeTerminal: (...args) => { effects.push({ name: 'consume', args }); return { args: ['status'] }; } },
    terminalLogs: { forget: record('forget'), append: record('append') } };
  return { scope, terminals, effects, terminal, callbacks };
}
module.exports.hostFixture = hostFixture;
if (require.main === module) test('each raw retained owner slot and unknown provenance refuses with all mutation spies untouched', async () => {
  const connection = { id: 'h', kind: 'ssh', host: 'server' };
  const options = { id: 'seat:h:s', connection, seatId: 's', session: 'session' };
  for (const change of [{ connection: undefined }, { seatId: undefined }, { session: undefined }, { seatId: 'other' }, { session: 'old' },
    ...[{ id: 'H' }, { kind: 'local' }, { host: 'Server' }, { port: 22 }, { distro: 'x' }, { rigBinary: 'rig' }].map(c => ({ connection: { ...connection, ...c } }))]) {
    const retained = { connection, seatId: 's', session: 'session', buffer: 'keep', terminal: {}, ...change };
    const f = hostFixture(options, retained); const before = { ...retained };
    await assert.rejects(createHandler(f.scope)({}, options), /preserved/);
    assert.equal(f.terminals.get(options.id), retained); assert.deepEqual(retained, before); assert.deepEqual(f.effects, []);
  }
});
if (require.main === module) test('new seat spawn records exact provenance and nonseat control paths retain existing behavior', async () => {
  const connection = { id: 'h', kind: 'ssh', host: 'server' };
  for (const extra of [{ seatId: 's', session: 's1' }, {}, { rigControlToken: 'token', rigControlConfirmation: 'yes' }]) {
    const options = { id: 'new', connection, ...extra }, f = hostFixture(options);
    const result = await createHandler(f.scope)({ sender: {} }, options);
    assert.equal(result.buffer, ''); const item = f.terminals.get('new');
    assert.equal(item.terminal, f.terminal); assert.equal(item.seatId, options.seatId); assert.equal(item.session, options.session);
    assert.notEqual(item.connection, connection); assert.equal(item.connection.host, connection.host);
    assert.equal(f.effects.filter(e => e.name === 'spawn').length, 1);
    assert.equal(f.effects.filter(e => e.name === 'set').length, 1);
    assert.equal(f.effects.filter(e => e.name === 'consume').length, extra.rigControlToken ? 1 : 0);
    assert.ok(!f.effects.some(e => ['kill', 'write', 'delete', 'forget'].includes(e.name)));
  }
  const options = { id: 'shell', connection }, item = { buffer: 'shell output', terminal: {} }, f = hostFixture(options, item);
  assert.equal((await createHandler(f.scope)({}, options)).buffer, 'shell output'); assert.deepEqual(f.effects, []);
});
if (require.main === module) test('deferred inventory races preserve every retained field without set delete kill write spawn consume forget', async () => {
  const connection = { id: 'h', kind: 'ssh', host: 'server' }, options = { id: 'seat:h:s', connection, seatId: 's', session: 's1' };
  for (const latest of [[], [{ id: 's', session: 'new' }], [{ id: 's', session: 's1' }]]) {
    const f = hostFixture(options); let resolve;
    f.scope.backend.inventory = () => new Promise(r => { resolve = r; });
    const pending = createHandler(f.scope)({}, options);
    const item = { connection: { ...connection, port: 22 }, seatId: 's', session: 's1', buffer: 'keep', terminal: f.terminal };
    Map.prototype.set.call(f.terminals, options.id, item); const before = { ...item };
    resolve({ seats: latest }); await assert.rejects(pending, /preserved/);
    assert.equal(f.terminals.get(options.id), item); assert.deepEqual(item, before); assert.deepEqual(f.effects, []);
  }
});

if (require.main === module) test('actual host returns original buffer only for exact requested latest and retained provenance', async () => {
  const connection = { id: 'h', kind: 'ssh', host: 'server' };
  const options = { id: 'seat:h:s', connection, seatId: 's', session: 'session' };
  const item = { connection, seatId: 's', session: 'session', buffer: 'original', terminal: {} };
  for (const change of [{}, { seatId: undefined }, { session: 'old' }, { connection: { ...connection, port: 22 } }]) {
    const retained = { ...item, ...change }, terminals = new Map([[options.id, retained]]);
    const handler = createHandler({ terminals, core: { validateConnection() {} },
      backend: { inventory: async () => ({ seats: [{ id: 's', session: 'session' }] }) } });
    if (!Object.keys(change).length) {
      const result = await handler({}, options);
      assert.equal(result.buffer, 'original'); assert.equal(result.reused, true);
    } else await assert.rejects(handler({}, options), /preserved/);
    assert.equal(terminals.get(options.id), retained);
  }
});
if (require.main === module) test('actual host rechecks map after deferred inventory and refuses changed session without replacement', async () => {
  const connection = { id: 'h', kind: 'ssh', host: 'server' };
  const options = { id: 'seat:h:s', connection, seatId: 's', session: 'session' };
  let resolve; const terminals = new Map();
  const handler = createHandler({ terminals, core: { validateConnection() {} },
    backend: { inventory: () => new Promise(r => { resolve = r; }) } });
  const pending = handler({}, options);
  const concurrent = { connection: { ...connection, host: 'foreign' }, seatId: 's', session: 'session', buffer: 'keep' };
  terminals.set(options.id, concurrent);
  resolve({ seats: [{ id: 's', session: 'session' }] });
  await assert.rejects(pending, /preserved/);
  assert.equal(terminals.get(options.id), concurrent); assert.equal(concurrent.buffer, 'keep');
  const next = handler({}, options); resolve({ seats: [{ id: 's', session: 'new' }] });
  await assert.rejects(next, /session changed/); assert.equal(terminals.get(options.id), concurrent);
});

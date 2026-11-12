const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, host, seat, flatten } = require('./attention-inbox-app.test.cjs');
const { createHandler, hostFixture } = require('./attention-terminal-reuse.test.cjs');

test('explicit Jump and retained refusal preserve bounded authority', async () => {
  const effects = [];
  const record = (name, args) => effects.push({ name, args });
  const spy = name => (...args) => record(name, args);
  const api = {};
  for (const name of ['writeTerminal', 'answerPrompt', 'closeTerminal', 'createTerminal', 'resetTerminal', 'relaunchTerminal',
    'startSeat', 'stopSeat', 'restartSeat', 'refreshInventory', 'inventory', 'fetch', 'edit', 'queue', 'rigControl']) api[name] = spy(name);
  const authority = { window: { hrig: api, dispatchEvent: spy('dispatchEvent') }, fetch: spy('fetch'),
    setTimeout: spy('setTimeout'), setInterval: spy('setInterval'), requestAnimationFrame: spy('requestAnimationFrame') };
  const id = 'seat:host:rig:seat';
  const wrap = subject => process.env.GSD_PROHIB_SUBJECT ? require(path.resolve(process.env.GSD_PROHIB_SUBJECT))(subject) : subject;
  const safeNode = () => ({ getComponent: () => 'terminal', getConfig: () => ({ connection: host, terminalId: id, seat }),
    getDocument: () => ({}), getWindow: () => ({ closed: false }) });
  const mutations = [null, h => { h.scope.modelRef.current = { getNodeById: safeNode }; },
    ...[{ id: 'other' }, { kind: 'wsl' }, { host: 'Server' }, { port: 22 }, { distro: 'x' }, { rigBinary: 'rig' }]
      .map(change => h => { h.scope.stateRef.current.connections = [{ ...host, ...change }]; }),
    h => { h.scope.inventoryHealth.current.verified = false; },
    h => { h.scope.attentionContext.current.inventoryError = 'offline'; },
    h => { h.scope.attentionContext.current.inventory = null; },
    h => { h.scope.attentionContext.current.inventory = { seats: [] }; },
    ...[{ session: 'changed' }, { status: 'idle' }, { rigId: 'other' }].map(change => h => {
      h.scope.attentionContext.current.inventory = { seats: [{ ...seat, ...change }] };
    })];
  for (let i = 0; i < mutations.length; i++) {
    const h = harness(authority);
    const button = flatten(h.render()).find(n => n?.type === 'button');
    assert.deepEqual(h.effects, [], 'render cannot navigate');
    mutations[i]?.(h);
    const subject = wrap({ jump: () => button.props.onClick(), record });
    subject.jump();
    if (i === 0) { assert.equal(h.effects.length, 1); assert.equal(h.effects[0].name, 'open'); assert.deepEqual(h.effects[0].args, [seat]); }
    else if (i === 1) assert.deepEqual(h.effects, [{ name: 'focus', args: [id] }]);
    else { assert.deepEqual(h.effects, []); assert.ok(flatten(h.render()).some(n => n?.type === 'ErrorBox' && n.props.error)); }
  }
  for (const change of [{ connection: undefined }, { seatId: undefined }, { session: undefined },
    { connection: { ...host, host: 'foreign' } }, { session: 'old' }]) {
    const options = { id, connection: host, seatId: seat.id, session: seat.session };
    const f = hostFixture(options);
    const item = { terminal: f.terminal, buffer: 'keep', connection: host, seatId: seat.id, session: seat.session, ...change };
    Map.prototype.set.call(f.terminals, id, item); const before = { ...item };
    const subject = wrap({ host: createHandler(f.scope), record });
    await assert.rejects(subject.host({}, options), /preserved/);
    assert.equal(f.terminals.get(id), item); assert.deepEqual(item, before);
    effects.push(...f.effects);
  }
  assert.deepEqual(effects, [], 'bounded authority: no forbidden effects or arguments');
});

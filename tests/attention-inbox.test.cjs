const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: id => dependencies[id] || require(id) });
  return exports;
}
const pins = load('src/seat-pins.ts');
const { attentionSeats, attentionScope, attentionJumpEligibility } = load('src/attention-inbox.ts', { './seat-pins': pins });
const host = { id: 'h', kind: 'ssh', host: 'server' };
const seat = { id: 'opaque', rigId: 'r', rigName: 'R', status: 'attention', session: 's' };
test('exact normalized membership preserves duplicates original references and source order', () => {
  const rows = [seat, { ...seat, status: 'failed', error: 'needs input' }, seat,
    { ...seat, status: 'Attention' }, { ...seat, status: undefined }];
  const result = attentionSeats({ seats: Object.freeze(rows) });
  assert.equal(result.length, 2); assert.equal(result[0], seat); assert.equal(result[1], seat);
  assert.equal(attentionSeats(null).length, 0);
});
test('scope requires raw six-slot owner healthy inventory and no error; name root and busy are irrelevant', () => {
  const inv = { seats: [seat] }, health = { key: pins.pinConnectionIdentity(host), verified: true };
  assert.equal(attentionScope(host, { ...host, name: 'new', root: '/new' }, inv, health, '').ready, true);
  for (const change of [{ id: 'x' }, { kind: 'wsl' }, { host: 'Server' }, { port: 22 }, { distro: 'x' }, { rigBinary: 'x' }]) {
    const scope = attentionScope(host, { ...host, ...change }, inv, health, '');
    assert.equal(scope.ready, false); assert.equal(scope.inventory, null);
  }
  assert.equal(attentionScope(host, host, inv, health, 'offline').inventory, inv);
  assert.equal(attentionScope(host, host, inv, health, 'offline').ready, false);
  assert.equal(attentionScope(host, host, null, health, '').ready, false);
});
test('identical duplicate targets permit Jump while conflicting identities and absent sessions refuse', () => {
  assert.equal(attentionJumpEligibility({ seats: [seat, seat] }, seat), '');
  for (const change of [{ rigId: 'R' }, { rigName: 'r' }, { session: 'S' }, { status: 'idle' }])
    assert.ok(attentionJumpEligibility({ seats: [seat, { ...seat, ...change }] }, seat));
  assert.ok(attentionJumpEligibility({ seats: [seat] }, { ...seat, session: null }));
  const failed = { ...seat, status: 'failed', error: '<error>' };
  assert.equal(attentionJumpEligibility({ seats: [failed] }, failed, true), '');
});
test('owned missing inventory reports known error before initial loading', () => {
  const health = { key: pins.pinConnectionIdentity(host), verified: false };
  const failed = attentionScope(host, host, null, health, 'offline');
  assert.equal(failed.ready, false);
  assert.equal(failed.inventory, null);
  assert.match(failed.reason, /Could not verify.*offline/);
  assert.doesNotMatch(failed.reason, /Loading/);
  assert.match(attentionScope(host, host, null, health, '').reason, /Loading/);
});

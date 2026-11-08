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
const pods = load('src/seat-pods.ts', { './seat-pins': pins });
const host = Object.freeze({ id: 'host', kind: 'ssh', host: 'server', name: 'Host', root: '~' });
const seat = Object.freeze({ id: 'one', rigId: 'r', rigName: 'Rig', pod: 'Builders' });
const identity = pods.podIdentity(host, seat);

test('pod identity preserves all six raw owner slots and tagged exact represented rig and pod', () => {
  assert.equal(identity, '["host","ssh","server",null,null,null,"rigId","r","Builders"]');
  for (const change of [{ id: 'other' }, { kind: 'wsl' }, { host: 'Server' },
    { port: 22 }, { distro: 'Ubuntu' }, { rigBinary: '/rig' }])
    assert.notEqual(pods.podIdentity({ ...host, ...change }, seat), identity);
  assert.equal(pods.podIdentity({ ...host, name: 'Rename', root: '/new' }, seat), identity);
  for (const other of [{ ...seat, rigId: '', rigName: 'r' }, { ...seat, pod: 'builders' },
    { ...seat, pod: 'Builders ' }, { ...seat, rigId: 'r:' }, { ...seat, pod: '[],:"' }])
    assert.notEqual(pods.podIdentity(host, other), identity);
  assert.notEqual(pods.podIdentity(host, { ...seat, pod: '' }),
    pods.podIdentity(host, { ...seat, pod: 'Ungrouped' }));
});

test('collapsed pod normalization keeps valid mixed frozen choices and rejects malformed slots per entry', () => {
  const tuple = JSON.parse(identity);
  const invalid = [null, 7, 'bad', '{}', '[]', JSON.stringify(tuple.slice(1))];
  for (const [index, value] of [[0, ''], [1, 'future'], [2, {}], [3, 0], [3, 65536],
    [3, 22.5], [4, []], [5, false], [6, 'rig'], [7, null], [7, ''], [8, null]]) {
    const bad = [...tuple]; bad[index] = value; invalid.push(JSON.stringify(bad));
  }
  const input = Object.freeze([...invalid, identity, JSON.stringify(tuple, null, 2), identity]);
  assert.deepEqual(Array.from(pods.normalizeCollapsedPods(input)), [identity]);
  assert.deepEqual(Array.from(pods.normalizeCollapsedPods(pods.normalizeCollapsedPods(input))), [identity]);
  for (const value of [undefined, null, {}, '', 2]) assert.deepEqual(Array.from(pods.normalizeCollapsedPods(value)), []);
  const fallback = pods.podIdentity(host, { rigName: '', pod: '' });
  assert.deepEqual(Array.from(pods.normalizeCollapsedPods([fallback])), [fallback]);
});

test('explicit pod setters are immutable idempotent and retain absent choices while double toggle restores', () => {
  const absent = pods.podIdentity(host, { ...seat, pod: 'Absent' });
  const input = Object.freeze([absent]);
  const collapsed = pods.setPodCollapsed(input, identity, true);
  assert.deepEqual(Array.from(collapsed), [absent, identity]);
  assert.deepEqual(Array.from(pods.setPodCollapsed(collapsed, identity, true)), [absent, identity]);
  assert.deepEqual(Array.from(pods.setPodCollapsed(collapsed, identity, false)), [absent]);
  assert.deepEqual(Array.from(pods.setPodCollapsed(
    pods.setPodCollapsed(collapsed, identity, false), identity, false)), [absent]);
  assert.deepEqual(Array.from(pods.togglePodCollapsed(pods.togglePodCollapsed(input, identity), identity)), [absent]);
  assert.deepEqual(Array.from(pods.setPodCollapsed(input, 'invalid', true)), [absent]);
  assert.deepEqual(input, [absent]);
});

test('pod normalization preserves valid port boundaries and exact punctuation whitespace and fallback tags', () => {
  const identities = [1, 65535].flatMap(port => [
    pods.podIdentity({ ...host, port }, { ...seat, rigId: ' [],:" ', pod: ' Pod ' }),
    pods.podIdentity({ ...host, port }, { ...seat, rigId: '', rigName: ' [],:" ', pod: ' Pod ' }),
    pods.podIdentity({ ...host, port }, { ...seat, rigId: '', rigName: ' [],:" ', pod: ' pod ' }),
  ]);
  assert.equal(new Set(identities).size, 6);
  const frozen = Object.freeze(identities);
  assert.deepEqual(Array.from(pods.normalizeCollapsedPods(frozen)), identities);
  assert.deepEqual(Array.from(pods.normalizeCollapsedPods(Object.freeze([
    'legacy/pod', ...identities, ...identities,
  ]))), identities);
});

test('ordinary pod grouping preserves first appearance duplicate references and exact fallback labels', () => {
  const a = seat, b = Object.freeze({ ...seat, id: 'two', pod: 'Other' });
  const c = Object.freeze({ ...seat, id: 'three' });
  const input = Object.freeze([a, b, c, a]);
  const groups = pods.groupSeatPods(input, host);
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0].seats), [a, c, a]);
  assert.equal(groups[0].seats[0], a);
  assert.equal(groups[1].seats[0], b);
  assert.deepEqual(Array.from(pods.groupSeatPods([], host)), []);
  const missing = pods.groupSeatPods([{ id: 'x', pod: '', rigName: '' },
    { id: 'y', pod: 'Ungrouped', rigName: '' }, { id: 'z', rigId: 'id', pod: '' }], host);
  assert.equal(missing.length, 3);
  assert.equal(missing[0].podLabel, 'Ungrouped');
  assert.equal(missing[0].rigLabel, 'Unknown rig');
  assert.equal(missing[2].rigLabel, 'id');
  assert.deepEqual(Array.from(pods.groupSeatPods(input, host), g => g.identity),
    Array.from(groups, g => g.identity));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadLocal, host, seat, snapshot } = require('./seat-notifications-consumer.test.cjs');
const { advanceSeatNotifications: advance, validSeatNotificationName: validName } = loadLocal('src/seat-notifications.ts');
const { pinConnectionIdentity: owner } = loadLocal('src/seat-pins.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const empty = () => Object.freeze({ owner: null, armed: false, attentionIds: Object.freeze([]) });
const attention = (extra = {}) => ({ ...seat, status: 'attention', ...extra });
function input(rows, changes = {}) {
  return Object.freeze({ enabled: true, connection: host, inventory: rows === null ? null : snapshot(rows),
    inventoryError: '', health: Object.freeze({ key: owner(host), verified: true, failures: 0 }), ...changes });
}
function step(previous, next) {
  Object.freeze(previous.attentionIds); Object.freeze(previous);
  const before = JSON.stringify({ previous, next });
  const result = advance(previous, next);
  assert.equal(JSON.stringify({ previous, next }), before, 'original frozen observations remain exact');
  assert.notEqual(result.state, previous);
  assert.notEqual(result.state.attentionIds, previous.attentionIds);
  assert.deepEqual(Object.keys(result.state).sort(), ['armed', 'attentionIds', 'owner']);
  assert.ok(result.state.attentionIds.every(id => typeof id === 'string'));
  for (const request of result.requests) assert.deepEqual(Reflect.ownKeys(request), ['seatName']);
  return result;
}
// Shared finite input corpus; importing this module registers no sibling suite.
const ownerChanges = [
  ['id', 'other-owner'], ['kind', 'wsl'], ['host', 'SYNTHETIC_PRIVATE_HOST'.toLowerCase()],
  ['port', 22], ['distro', 'Ubuntu'], ['rigBinary', '/synthetic/rig'],
];
const nameCases = [
  ['Builder', true], ['  Builder  ', true], ['工程师 🧑‍💻', false], // ZWJ is Cf
  ['工程师 🚀', true], ['é'.repeat(150), true], ['🚀'.repeat(150), true],
  ['🚀'.repeat(151), false], ['a'.repeat(151), false], ['', false], [' \t ', false],
  [null, false], [undefined, false], [7, false], [{ toString: () => 'Builder' }, false],
  ...['\u0000', '\u0009', '\u000a', '\u007f', '\u0085', '\u00ad', '\u200b',
    '\u200d', '\u202e', '\u2066', '\u2028', '\u2029'].map(c => ['Builder' + c + 'canary', false]),
];

if (require.main === module) {
  test('pure frozen zero one many transitions preserve first represented order and fresh exact requests', () => {
    let r = step(empty(), input([])); assert.deepEqual(plain(r.requests), []);
    r = step(r.state, input([attention({ id: 'b', name: ' B ' }), attention({ id: 'a', name: 'A' }),
      attention({ id: 'b', name: ' B ' }), { ...seat, id: 'idle' }]));
    assert.deepEqual(plain(r.requests), [{ seatName: ' B ' }, { seatName: 'A' }]);
    assert.deepEqual(plain(r.state.attentionIds), ['b', 'a']);
    assert.notEqual(r.requests[0], r.requests[1]);
    const repeated = step(r.state, input([attention({ id: 'a', name: 'Renamed' }), attention({ id: 'b' })]));
    assert.deepEqual(plain(repeated.requests), []);
    const absent = step(repeated.state, input([]));
    assert.deepEqual(plain(absent.state.attentionIds), [], 'membership is bounded to current rows');
    const reentered = step(absent.state, input([attention()]));
    assert.deepEqual(plain(reentered.requests), [{ seatName: 'Builder' }]);
    assert.notEqual(step(absent.state, input([attention()])).requests[0], reentered.requests[0]);
  });
  test('pure identity state retains no content and only exact normalized attention can enter', () => {
    let r = step(empty(), input([seat]));
    for (const status of ['failed', 'error', 'ATTENTION', 'needs_input', undefined, null, 'working', 'idle']) {
      r = step(r.state, input([{ ...seat, status }])); assert.deepEqual(plain(r.requests), []);
    }
    r = step(r.state, input([attention()]));
    assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
    r = step(r.state, input([attention({ name: 'Renamed', activity: 'NEW_PRIVATE_ACTIVITY', error: 'NEW_PRIVATE_ERROR' })]));
    assert.deepEqual(plain(r.requests), []);
    assert.deepEqual(plain(r.state), { owner: owner(host), armed: true, attentionIds: [seat.id] });
    r = step(r.state, input([seat]));
    r = step(r.state, input([attention({ name: 'Current name' })]));
    assert.deepEqual(plain(r.requests), [{ seatName: 'Current name' }]);
  });
  for (const [axis, value] of ownerChanges) {
    test(`pure raw owner ${axis} change and absent slot recovery seed silently`, () => {
      const initial = step(empty(), input([seat]));
      const connection = Object.freeze({ ...host, [axis]: value });
      const health = Object.freeze({ key: owner(connection), verified: true, failures: 0 });
      let r = step(initial.state, input([attention()], { connection, health }));
      assert.deepEqual(plain(r.requests), []);
      r = step(r.state, input([seat], { connection, health }));
      r = step(r.state, input([attention()], { connection, health }));
      assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
      r = step(r.state, input([attention()]));
      assert.deepEqual(plain(r.requests), [], 'return to original absent optional slots seeds again');
      r = step(r.state, input([seat])); r = step(r.state, input([attention()]));
      assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
    });
  }
  const gaps = [
    ['disabled', { enabled: false }], ['missing inventory', { inventory: null }],
    ['missing seats', { inventory: Object.freeze({}) }],
    ['invalid seats', { inventory: Object.freeze({ seats: 'PRIVATE_CANARY' }) }],
    ['inventory error', { inventoryError: 'PRIVATE_CANARY' }],
    ['foreign health key', { health: { key: 'foreign', verified: true, failures: 0 } }],
    ['unverified', { health: { key: owner(host), verified: false, failures: 0 } }],
    ...[1, 2, 3, -1, undefined, NaN].map(failures => ['failures ' + failures,
      { health: { key: owner(host), verified: true, failures } }]),
  ];
  for (const [label, changes] of gaps) test(`pure ${label} disarms and healthy recovery silently reseeds before a fresh positive`, () => {
    let r = step(empty(), input([seat]));
    r = step(r.state, input([attention()], changes));
    assert.deepEqual(plain(r), { state: { owner: null, armed: false, attentionIds: [] }, requests: [] });
    r = step(r.state, input([attention()])); assert.deepEqual(plain(r.requests), []);
    r = step(r.state, input([seat])); r = step(r.state, input([attention()]));
    assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
  });
  test('pure identical duplicates dedupe and conflicting rows stay suppressed through continuous repair', () => {
    for (const rows of [[attention(), attention({ name: 'Other' })], [attention(), seat],
      [seat, attention()], [attention({ name: '' }), attention()]]) {
      let r = step(empty(), input([]));
      r = step(r.state, input(rows)); assert.deepEqual(plain(r.requests), []);
      r = step(r.state, input([attention()])); assert.deepEqual(plain(r.requests), [], 'repair alone is not reentry');
      r = step(r.state, input([seat])); r = step(r.state, input([attention(), attention()]));
      assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
    }
  });
  test('pure malformed rows and invalid names never echo or choose fallback content', () => {
    for (const id of [null, undefined, '', '  ', 1, {}, []]) {
      let r = step(empty(), input([]));
      r = step(r.state, input([null, undefined, { ...attention(), id }]));
      assert.deepEqual(plain(r.requests), []);
      r = step(r.state, input([attention()]));
      assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
    }
    for (const [name, accepted] of nameCases) {
      assert.equal(validName(name), accepted, 'exact name policy for ' + JSON.stringify(name));
      let r = step(empty(), input([])); r = step(r.state, input([attention({ name })]));
      assert.deepEqual(plain(r.requests), accepted ? [{ seatName: name }] : []);
      if (!accepted) {
        r = step(r.state, input([attention()])); assert.deepEqual(plain(r.requests), []);
        r = step(r.state, input([seat])); r = step(r.state, input([attention()]));
        assert.deepEqual(plain(r.requests), [{ seatName: 'Builder' }]);
      }
    }
  });
}
module.exports = { ownerChanges, nameCases };

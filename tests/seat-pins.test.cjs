const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/seat-pins.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require });
const { pinConnectionIdentity, seatPinIdentity, normalizePinnedSeats,
  setSeatPinned, toggleSeatPin, partitionPinnedSeats } = exportsObject;
const host = Object.freeze({ id: 'owner', kind: 'ssh', host: 'server', root: '~', name: 'Host' });
const key = '["owner","ssh","server",null,null,null,"rig:seat"]';
const plain = values => Array.from(values);

test('pin identity matches the raw inventory tuple and opaque seat identity', () => {
  assert.equal(pinConnectionIdentity(host), '["owner","ssh","server",null,null,null]');
  assert.equal(seatPinIdentity(host, 'rig:seat'), key);
  assert.equal(seatPinIdentity({ ...host, name: 'Renamed', root: '/elsewhere' }, 'rig:seat'), key);
  for (const change of [{ id: 'other' }, { kind: 'wsl' }, { host: 'other' },
    { port: 22 }, { distro: 'Ubuntu' }, { rigBinary: '/bin/rig' }]) {
    assert.notEqual(seatPinIdentity({ ...host, ...change }, 'rig:seat'), key);
  }
  assert.notEqual(seatPinIdentity(host, 'other:seat'), key);
});

test('normalization validates each identity and retains only canonical first occurrences', () => {
  const mixed = Object.freeze([key, ' [ "owner", "ssh", "server", null, null, null, "rig:seat" ]',
    null, 4, {}, 'bad json', '[]', '["owner","ftp",null,null,null,null,"seat"]',
    '["","ssh",null,null,null,null,"seat"]', '["owner","ssh",null,0,null,null,"seat"]',
    '["owner","ssh",null,65536,null,null,"seat"]', '["owner","ssh",{},null,null,null,"seat"]',
    '["owner","ssh",null,null,null,null,""]']);
  assert.deepEqual(plain(normalizePinnedSeats(mixed)), [key]);
  for (const value of [undefined, null, '', {}, true]) assert.deepEqual(plain(normalizePinnedSeats(value)), []);
  assert.equal(mixed.length, 13);
  assert.deepEqual(plain(normalizePinnedSeats(normalizePinnedSeats(mixed))), [key]);
});

test('explicit membership is idempotent and toggling twice restores membership without mutation', () => {
  const input = Object.freeze([key]);
  assert.deepEqual(plain(setSeatPinned(input, key, true)), [key]);
  assert.deepEqual(plain(setSeatPinned(setSeatPinned(input, key, false), key, false)), []);
  assert.deepEqual(plain(toggleSeatPin(toggleSeatPin(input, key), key)), [key]);
  assert.deepEqual(plain(setSeatPinned([], 'invalid', true)), []);
  assert.deepEqual(input, [key]);
});

test('stable partition preserves duplicate rows references count and normal ordering', () => {
  const a = Object.freeze({ id: 'a' });
  const b = Object.freeze({ id: 'rig:seat' });
  const duplicate = Object.freeze({ id: 'rig:seat' });
  const input = Object.freeze([a, b, duplicate]);
  const result = partitionPinnedSeats(input, host, Object.freeze([key]));
  assert.deepEqual(plain(result), [b, duplicate, a]);
  assert.equal(result[0], b);
  assert.equal(result[1], duplicate);
  assert.equal(result.length, input.length);
  assert.deepEqual(plain(partitionPinnedSeats(result, host, [key])), [b, duplicate, a]);
  assert.deepEqual(plain(partitionPinnedSeats(input, { ...host, host: 'elsewhere' }, [key])), [a, b, duplicate]);
  for (const pins of [[], [key, seatPinIdentity(host, 'a')]]) {
    assert.deepEqual(plain(partitionPinnedSeats(input, host, pins)), [a, b, duplicate]);
  }
  assert.deepEqual(plain(partitionPinnedSeats([], host, [key])), []);
  assert.equal(partitionPinnedSeats([b], host, [key])[0], b);
});

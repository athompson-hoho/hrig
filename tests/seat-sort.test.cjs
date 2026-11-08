const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/seat-sort.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require });
const { sortSeats } = exportsObject;
const modes = ['name', 'activity', 'attention-first'];
const seat = (id, name, status) => Object.freeze({ id, name, status,
  session: null, activity: 'attention working newest' });
const ids = result => Array.from(result, item => item.id);

test('every mode safely copies frozen empty and single inputs with original references', () => {
  for (const mode of modes) {
    const empty = Object.freeze([]);
    const single = Object.freeze([seat('one', 'Seat 1', undefined)]);
    assert.deepEqual(ids(sortSeats(empty, mode)), []);
    const result = sortSeats(single, mode);
    assert.notEqual(result, single);
    assert.equal(result[0], single[0]);
    assert.equal(result.length, 1);
  }
});

test('Name uses natural numeric case-insensitive English collation with stable accent ties', () => {
  const input = Object.freeze([
    seat('ten', 'seat10', 'working'), seat('upper', 'SEAT2', 'idle'),
    seat('lower', 'seat2', 'attention'), seat('accent', 'Éclair', 'idle'),
    seat('plain', 'eclair', 'working'), seat('umlaut', 'Über', undefined),
    seat('u', 'uber', 'attention'),
  ]);
  assert.deepEqual(ids(sortSeats(input, 'name')),
    ['accent', 'plain', 'upper', 'lower', 'ten', 'umlaut', 'u']);
  assert.deepEqual(ids(input), ['ten', 'upper', 'lower', 'accent', 'plain', 'umlaut', 'u']);
});

test('Activity orders exact normalized ranks and name-orders stopped aliases and unclassified statuses', () => {
  const input = Object.freeze([
    seat('unknown', 'seat8', 'unknown'), seat('failed', 'seat3', 'failed'),
    seat('idle', 'seat0', 'idle'), seat('attention', 'seat0', 'attention'),
    seat('running', 'seat0', 'running'), seat('working', 'seat0', 'working'),
    seat('exited', 'seat2', 'exited'), seat('stopped', 'seat1', 'stopped'),
    seat('missing', 'seat4', undefined), seat('uppercase', 'seat5', 'WORKING'),
    seat('needs', 'seat6', 'needs_input'), seat('required', 'seat7', 'attention_required'),
    seat('future', 'seat9', 'future'),
  ]);
  assert.deepEqual(ids(sortSeats(input, 'activity')), [
    'working', 'running', 'attention', 'idle', 'stopped', 'exited', 'failed',
    'missing', 'uppercase', 'needs', 'required', 'unknown', 'future',
  ]);
});

test('Attention first has exactly two groups without inferring attention from prose or absent sessions', () => {
  const input = Object.freeze([
    seat('working', 'a', 'working'), seat('attention-z', 'z', 'attention'),
    seat('upper', 'b', 'ATTENTION'), seat('needs', 'c', 'needs_input'),
    seat('required', 'd', 'attention_required'), seat('missing', 'e', undefined),
    seat('attention-a', 'a', 'attention'), seat('idle', 'f', 'idle'),
  ]);
  assert.deepEqual(ids(sortSeats(input, 'attention-first')), [
    'attention-a', 'attention-z', 'working', 'upper', 'needs', 'required', 'missing', 'idle',
  ]);
});

test('all modes preserve membership, objects and stable ties and are idempotent without mutation', () => {
  const input = Object.freeze([
    seat('z', 'same', 'idle'), seat('a', 'SAME', 'working'),
    seat('b', 'same', 'idle'), seat('c', 'other', 'attention'),
  ]);
  const before = JSON.stringify(input);
  const expected = {
    name: ['c', 'z', 'a', 'b'], activity: ['a', 'c', 'z', 'b'],
    'attention-first': ['c', 'z', 'a', 'b'],
  };
  for (const mode of modes) {
    const result = sortSeats(input, mode);
    assert.deepEqual(ids(result), expected[mode]);
    assert.equal(result.length, input.length);
    assert.equal(new Set(result).size, input.length);
    for (const item of result) assert.equal(item, input.find(original => original.id === item.id));
    assert.deepEqual(ids(sortSeats(Object.freeze(result), mode)), expected[mode]);
    assert.deepEqual(ids(sortSeats(input, mode)), expected[mode]);
    assert.equal(JSON.stringify(input), before);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/seat-status.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject, require });
const { filterSeatsByStatus } = exportsObject;
const choices = ['all', 'working', 'idle', 'attention', 'stopped'];
const statuses = ['working', 'idle', 'attention', 'stopped', 'exited', 'failed',
  'running', 'unknown', 'future', undefined, 'WORKING', 'needs_input', 'attention_required'];
const seats = Object.freeze(statuses.map((status, id) => Object.freeze({
  id: String(id), status, session: null, activity: 'working attention stopped',
})));

test('specific filters match exact normalized statuses and all retains unclassified values', () => {
  const expected = { all: seats.map(s => s.id), working: ['0', '6'], idle: ['1'],
    attention: ['2'], stopped: ['3', '4', '5'] };
  for (const choice of choices) {
    const result = filterSeatsByStatus(seats, choice);
    assert.deepEqual(Array.from(result, s => s.id), expected[choice]);
    for (const item of result) assert.equal(item, seats[Number(item.id)]);
  }
  assert.deepEqual(seats.map(s => s.status), statuses);
});

test('empty and single frozen inputs retain references without inferring session or activity status', () => {
  for (const choice of choices) {
    assert.deepEqual(Array.from(filterSeatsByStatus(Object.freeze([]), choice)), []);
    for (const item of seats) {
      const result = filterSeatsByStatus(Object.freeze([item]), choice);
      if (result.length) assert.equal(result[0], item);
      if (item.status === undefined && choice !== 'all') assert.equal(result.length, 0);
    }
  }
});

test('duplicate statuses preserve source order and original objects across reset', () => {
  const input = Object.freeze([Object.freeze({ id: 'z', status: 'idle' }),
    Object.freeze({ id: 'a', status: 'working' }), Object.freeze({ id: 'b', status: 'idle' })]);
  const result = filterSeatsByStatus(input, 'idle');
  assert.deepEqual(Array.from(result, s => s.id), ['z', 'b']);
  assert.equal(result[0], input[0]);
  assert.equal(result[1], input[2]);
  const reset = filterSeatsByStatus(input, 'all');
  input.forEach((item, index) => assert.equal(reset[index], item));
  assert.deepEqual(input.map(s => s.id), ['z', 'a', 'b']);
});

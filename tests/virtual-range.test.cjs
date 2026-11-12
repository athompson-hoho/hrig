const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/virtual-range.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { prefixOffsets, viewportRange, sparseRetainedIndices } = exportsObject;

test('pure geometry normalizes invalid sizes and estimates without mutating frozen inputs', () => {
  const sizes = Object.freeze([0, -1, NaN, Infinity, -Infinity, 0.25, 10.5]);
  assert.deepEqual(Array.from(prefixOffsets(sizes, 2)), [0, 2, 4, 6, 8, 10, 10.25, 20.75]);
  assert.deepEqual(Array.from(prefixOffsets(Object.freeze([NaN]), NaN)), [0, 55]);
  assert.equal(sizes.length, 7); assert.ok(Number.isNaN(sizes[2]));
  assert.equal(sizes[3], Infinity);
});

test('pure ranges cover zero one hidden fractional boundary and clamped offsets', () => {
  const empty = viewportRange(Object.freeze([0]), Infinity, NaN);
  assert.equal(empty.start, 0); assert.equal(empty.end, 0); assert.equal(empty.scrollTop, 0);
  const one = viewportRange(Object.freeze([0, 0.25]), 999, 30);
  assert.equal(one.start, 0); assert.equal(one.end, 1); assert.equal(one.scrollTop, 0);
  const offsets = Object.freeze(Array.from(prefixOffsets(Object.freeze(Array(20).fill(10.5)))));
  for (const top of [-1, NaN, Infinity, -Infinity]) assert.equal(viewportRange(offsets, top, 21).scrollTop, 0);
  const boundary = viewportRange(offsets, 10.5, 10.5, 0);
  assert.equal(boundary.visibleStart, 1); assert.equal(boundary.visibleEnd, 2);
  const partial = viewportRange(offsets, 10.25, 0.5, 0);
  assert.equal(partial.visibleStart, 0); assert.equal(partial.visibleEnd, 2);
  assert.equal(viewportRange(offsets, 999, 21).scrollTop, 189);
  for (const height of [0, NaN, Infinity, -1]) assert.ok(viewportRange(offsets, 0, height).end <= 5);
});

test('pure variable geometry stays finite monotonic and bounded through a large collection', () => {
  const sizes = Object.freeze(Array.from({ length: 10000 }, (_, i) => [0.25, 10.5, 55, 190][i % 4]));
  const offsets = Object.freeze(Array.from(prefixOffsets(sizes)));
  assert.equal(offsets[4], 255.75);
  assert.ok(offsets.every((value, i) => Number.isFinite(value) && (!i || value > offsets[i - 1])));
  let previous = -1;
  for (const top of [0, 0.1, 10.75, 50000.25, 600000, Number.MAX_VALUE]) {
    const range = viewportRange(offsets, top, 330);
    assert.ok(range.visibleStart >= previous); previous = range.visibleStart;
    assert.ok(range.start <= range.visibleStart && range.end >= range.visibleEnd);
    assert.ok(range.end - range.start <= range.visibleEnd - range.visibleStart + 8);
    assert.ok(range.end <= sizes.length && range.scrollTop >= 0);
  }
  assert.equal(viewportRange(offsets, Number.MAX_VALUE, 330).end, 10000);
  assert.ok(prefixOffsets(Object.freeze([Number.MAX_VALUE, Number.MAX_VALUE])).every(Number.isFinite));
});

test('pure retention adds only unique valid isolated focus and drag indices', () => {
  const range = Object.freeze({ start: 500, end: 514, visibleStart: 504, visibleEnd: 510, scrollTop: 0 });
  const retained = Array.from(sparseRetainedIndices(range, 0, 9999, 10000));
  assert.equal(retained.length, 16); assert.equal(retained[0], 0); assert.equal(retained.at(-1), 9999);
  assert.equal(Array.from(sparseRetainedIndices(range, 505, 505, 10000)).length, 14);
  assert.equal(Array.from(sparseRetainedIndices(range, NaN, 10000, 10000)).length, 14);
  assert.equal(Array.from(sparseRetainedIndices(range, -1, 0.5, 10000)).length, 14);
});

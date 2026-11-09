const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('rm', module);
m._compile(buildSync({ entryPoints: ['src/reduced-motion.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'rm.js');
const { motionReduced } = m.exports;
const os = v => q => (assert.equal(q, '(prefers-reduced-motion: reduce)'), { matches: v });

test('setting wins; otherwise the OS preference decides; failures mean motion allowed', () => {
  assert.equal(motionReduced(true, os(false)), true);
  assert.equal(motionReduced(false, os(true)), true);
  assert.equal(motionReduced(false, os(false)), false);
  assert.equal(motionReduced(false, undefined), false);
  assert.equal(motionReduced(false, () => { throw new Error('no'); }), false);
  assert.equal(motionReduced(false, () => undefined), false);
});
test('script-driven motion goes through the helper; audit doc lists it', () => {
  const ed = fs.readFileSync('src/EditorPanel.tsx', 'utf8'), te = fs.readFileSync('src/TerminalPanel.tsx', 'utf8');
  assert.match(ed, /smoothScrolling: !motionReduced\(preferences\["appearance\.reduceMotion"\]\)/);
  assert.match(te, /cursorBlink: !motionReduced\(false\)/);
  assert.match(te, /!motionReduced\(preferences\["appearance\.reduceMotion"\]\)/);
  assert.doesNotMatch(ed + te, /smoothScrolling: !preferences|cursorBlink: true/);
  assert.match(fs.readFileSync('docs/reduce-motion-audit.md', 'utf8'), /motionReduced/);
});

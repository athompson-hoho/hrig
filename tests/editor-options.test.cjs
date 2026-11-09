const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const load = f => { const m = new Module('x', module); m._compile(buildSync({ entryPoints: [f], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'x.js'); return m.exports; };
const { monacoEditorOptions: o } = load('src/editor-options.ts');
const { defaults, schema, validateOverrides } = load('src/settings.ts');
const J = v => JSON.parse(JSON.stringify(v));

test('defaults map to exactly the object the editor built before the extraction', () => {
  assert.deepEqual(J(o(defaults, false)), {
    fontSize: defaults['editor.fontSize'], fontFamily: defaults['editor.fontFamily'], tabSize: defaults['editor.tabSize'], insertSpaces: defaults['editor.insertSpaces'],
    detectIndentation: false, wordWrap: 'on', minimap: { enabled: false }, lineNumbers: 'on', fontLigatures: false, renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true }, automaticLayout: true, scrollBeyondLastLine: false, smoothScrolling: true,
  });
  assert.equal(o(defaults, true).smoothScrolling, false);
});
test('every valid enumerated value passes through; invalid ones fall back to the default', () => {
  for (const v of ['selection', 'boundary', 'trailing', 'all', 'none']) assert.equal(o({ ...defaults, 'editor.renderWhitespace': v }, false).renderWhitespace, v);
  for (const v of ['on', 'off']) assert.equal(o({ ...defaults, 'editor.wordWrap': v }, false).wordWrap, v);
  for (const v of ['on', 'relative', 'off']) assert.equal(o({ ...defaults, 'editor.lineNumbers': v }, false).lineNumbers, v);
  for (const bad of ['bogus', '', 3, null, undefined, {}]) {
    const r = o({ ...defaults, 'editor.renderWhitespace': bad, 'editor.wordWrap': bad, 'editor.lineNumbers': bad }, false);
    assert.deepEqual([r.renderWhitespace, r.wordWrap, r.lineNumbers], ['selection', 'on', 'on'], String(bad));
  }
});
test('booleans only from real booleans; shapes for minimap and bracket pairs', () => {
  const r = o({ ...defaults, 'editor.minimap': 'yes', 'editor.bracketPairs': 0, 'editor.fontLigatures': 1, 'editor.insertSpaces': null }, false);
  assert.deepEqual(J([r.minimap, r.bracketPairColorization, r.fontLigatures, r.insertSpaces]), [{ enabled: false }, { enabled: true }, false, defaults['editor.insertSpaces']]);
  assert.deepEqual(J(o({ ...defaults, 'editor.minimap': true }, false).minimap), { enabled: true });
});
test('renderWhitespace setting accepts exactly the five values, default unchanged, documented', () => {
  const row = schema.find(r => r.key === 'editor.renderWhitespace');
  assert.deepEqual(J(row.options.map(x => x.value)), ['selection', 'boundary', 'trailing', 'all', 'none']);
  assert.equal(defaults['editor.renderWhitespace'], 'selection');
  for (const v of ['boundary', 'trailing']) assert.doesNotThrow(() => validateOverrides({ 'editor.renderWhitespace': v }));
  assert.throws(() => validateOverrides({ 'editor.renderWhitespace': 'bogus' }));
  const doc = fs.readFileSync('SETTINGS.md', 'utf8').split('\n').find(l => l.startsWith('| `editor.renderWhitespace` | `selection` |'));
  for (const v of ['selection', 'boundary', 'trailing', 'all', 'none']) assert.ok(doc.includes('`' + v + '`'), v);
});
test('EditorPanel builds options only through the shared function, for editor and diff alike', () => {
  const src = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  assert.match(src, /monacoEditorOptions\(\s*preferences,\s*motionReduced\(preferences\["appearance\.reduceMotion"\]\),?\s*\)/);
  assert.equal((src.match(/\.\.\.editorOptions/g) || []).length, 2, 'Editor and DiffEditor both spread it');
  assert.doesNotMatch(src, /preferences\["editor\.wordWrap"\] as/);
});

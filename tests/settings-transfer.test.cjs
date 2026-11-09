const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('st', module);
m._compile(buildSync({ entryPoints: ['src/settings-transfer.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'st.js');
const { analyzeSettingsImport: a, summarizeImport, MAX_SETTINGS_JSON } = m.exports;
const J = v => JSON.parse(JSON.stringify(v));
const file = (settings, version = 1) => JSON.stringify({ version, settings });

test('fatal problems block apply with a clear message', () => {
  for (const [text, re] of [['', /Paste or load/], ['not json', /not valid JSON/], ['[]', /JSON object/], ['{"settings":{}}', /numeric version/],
    [JSON.stringify({ version: '1', settings: {} }), /numeric version/], [JSON.stringify({ version: 0, settings: {} }), /numeric version/],
    [JSON.stringify({ version: 1 }), /settings object/], [JSON.stringify({ version: 1, settings: [] }), /settings object/],
    ['x'.repeat(MAX_SETTINGS_JSON + 1), /64 KB/]]) assert.match(a(text).fatal, re, text.slice(0, 30));
});
test('valid keys survive; unknown, wrong-type and out-of-range keys are skipped and explained', () => {
  const r = a(file({ 'editor.minimap': true, 'editor.nope': 1, 'editor.largeFileWarnKb': 99999, 'terminal.fontSize': 'big', 'workspace.updateCheckHours': '24' }));
  assert.equal(r.fatal, null);
  assert.deepEqual(J(r.valid), { 'editor.minimap': true, 'workspace.updateCheckHours': '24' });
  assert.deepEqual(r.skipped.map(s => s.key).sort(), ['editor.largeFileWarnKb', 'editor.nope', 'terminal.fontSize']);
  assert.match(r.skipped.find(s => s.key === 'editor.nope').reason, /newer or older/);
  assert.match(r.skipped.find(s => s.key === 'editor.largeFileWarnKb').reason, /out of range/);
  assert.match(summarizeImport(r), /3 skipped/);
});
test('diff against the current scope: added, changed, unchanged, removed (replace semantics)', () => {
  const r = a(file({ 'editor.minimap': true, 'editor.bracketPairs': false, 'editor.wordWrap': 'on' }), { 'editor.minimap': true, 'editor.bracketPairs': true, 'editor.lineNumbers': 'off' });
  assert.deepEqual(r.unchanged, ['editor.minimap']); assert.deepEqual(r.changed, ['editor.bracketPairs']);
  assert.deepEqual(r.added, ['editor.wordWrap']); assert.deepEqual(r.removed, ['editor.lineNumbers']);
  assert.match(summarizeImport(r), /1 added, 1 changed, 1 removed, 1 unchanged/);
});
test('newer format version and empty settings produce notes; reserved names are skipped', () => {
  assert.match(a(file({}, 3)).notes.join(' '), /format version 3/);
  assert.match(a(file({})).notes.join(' '), /clear this scope/);
  const r = a('{"version":1,"settings":{"__proto__":{"x":1},"constructor":1}}');
  assert.equal(r.skipped.length >= 1, true); assert.equal(({}).x, undefined); assert.deepEqual(J(r.valid), {});
});
test('wiring: the page uses the report, docs describe migration notes', () => {
  const p = fs.readFileSync('src/SettingsPage.tsx', 'utf8');
  assert.match(p, /analyzeSettingsImport\(json, own\)/); assert.match(p, /context\.replace\(scope, report\.valid\)/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /Migration notes/);
});

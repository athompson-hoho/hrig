const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const load = f => { const m = new Module('x', module); m._compile(buildSync({ entryPoints: [f], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'x.js'); return m.exports; };
const { shouldFormatOnSave: f, FORMATTABLE, MAX_FORMAT_CHARS, FORMAT_TIMEOUT_MS } = load('src/format-on-save.ts');
const ok = { enabled: true, languageId: 'json', chars: 100, readOnly: false };

test('only when enabled, writable, a built-in formatter language, and within bounds', () => {
  assert.equal(f(ok), true);
  assert.equal(f({ ...ok, enabled: false }), false);
  assert.equal(f({ ...ok, readOnly: true }), false);
  for (const l of ['markdown', 'python', 'plaintext', 'shell', 'yaml', '']) assert.equal(f({ ...ok, languageId: l }), false, l);
  for (const l of FORMATTABLE) assert.equal(f({ ...ok, languageId: l }), true, l);
  assert.equal(f({ ...ok, chars: 0 }), false);
  assert.equal(f({ ...ok, chars: MAX_FORMAT_CHARS }), true);
  assert.equal(f({ ...ok, chars: MAX_FORMAT_CHARS + 1 }), false);
  assert.equal(f({ ...ok, chars: NaN }), false);
  assert.equal(f({ ...ok, enabled: 'yes' }), false);
});
test('setting is opt-in and the save path is the only caller', () => {
  const s = load('src/settings.ts');
  assert.equal(s.resolveSettings()['editor.formatOnSave'], false);
  assert.ok(s.schema.some(r => r.key === 'editor.formatOnSave'));
  const src = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  assert.equal((src.match(/= formatBeforeSave\(\)/g) || []).length, 1, 'called once, from save');
  assert.match(src, /const save = \(\) => \{\s*if \(formatting\.current\) \{\s*setNotice\("Still formatting[^"]*"\);\s*return;\s*\}\s*const pending = formatBeforeSave\(\);\s*return pending \? pending\.then\(saveNow\) : saveNow\(\);/);
  assert.match(src, /const saveNow = async \(\) => \{/);
  assert.match(src, /editor\.action\.formatDocument/); assert.match(src, /isSupported\(\)/);
  assert.match(src, /\.catch\(\(\) => \{\s*setNotice\("Could not format this file; it was saved as written\."\)/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /exec|spawn|prettier/);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`editor\.formatOnSave` \| `false`/);
});

test('a formatter that never settles cannot block Save (timeout race, then save as written)', () => {
  assert.ok(FORMAT_TIMEOUT_MS >= 1000 && FORMAT_TIMEOUT_MS <= 10000);
  const src = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  assert.match(src, /Promise\.race\(\[Promise\.resolve\(action\.run\(\)\), limit\]\)/);
  assert.match(src, /setTimeout\(\(\) => reject\(new Error\("timeout"\)\), FORMAT_TIMEOUT_MS\)/);
  assert.match(src, /\.finally\(\(\) => \{\s*formatting\.current = false;/);
  // behavior model of the same race
  const race = (run) => Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20))]);
  return race(new Promise(() => {})).then(() => assert.fail('should time out'), e => assert.equal(e.message, 'timeout'));
});

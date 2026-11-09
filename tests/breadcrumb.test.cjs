const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const load = f => { const m = new Module('x', module); m._compile(buildSync({ entryPoints: [f], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 'x.js'); return m.exports; };
const { breadcrumbs } = load('src/breadcrumb.ts');
const J = v => JSON.parse(JSON.stringify(v));

test('splits relative, absolute and windows paths', () => {
  assert.deepEqual(J(breadcrumbs('src/a/b.ts')), { crumbs: [{ name: 'src', path: 'src', last: false }, { name: 'a', path: 'src/a', last: false }, { name: 'b.ts', path: 'src/a/b.ts', last: true }], hidden: 0 });
  assert.equal(breadcrumbs('/home/u/x.md').crumbs[2].path, '/home/u/x.md');
  assert.deepEqual(breadcrumbs('C:\\proj\\src\\x.ts').crumbs.map(c => c.name), ['C:', 'proj', 'src', 'x.ts']);
  assert.deepEqual(J(breadcrumbs('./x.ts').crumbs.map(c => c.name)), ['x.ts']);
});
test('empty/undefined and control or bidi characters', () => {
  assert.deepEqual(J(breadcrumbs(undefined)), { crumbs: [], hidden: 0 });
  assert.deepEqual(J(breadcrumbs('')), { crumbs: [], hidden: 0 });
  assert.deepEqual(breadcrumbs('a/\u202eb\u0007/c').crumbs.map(c => c.name), ['a', 'b', 'c']);
});
test('long paths keep the tail and report hidden count; cap has a floor of 2', () => {
  const r = breadcrumbs('a/b/c/d/e/f/g/h/i/j.ts');
  assert.equal(r.crumbs.length, 8); assert.equal(r.hidden, 2); assert.equal(r.crumbs.at(-1).name, 'j.ts'); assert.equal(r.crumbs.at(-1).last, true);
  assert.equal(breadcrumbs('a/b/c', 0).crumbs.length, 2);
});
test('setting is opt-in, documented, and the toolbar renders breadcrumbs only for non-diff files', () => {
  const s = load('src/settings.ts');
  assert.equal(s.resolveSettings()['editor.breadcrumbs'], false);
  assert.ok(s.schema.some(r => r.key === 'editor.breadcrumbs'));
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`editor\.breadcrumbs` \| `false`/);
  assert.match(fs.readFileSync('src/EditorPanel.tsx', 'utf8'), /preferences\["editor\.breadcrumbs"\] && !diff && config\.path/);
});

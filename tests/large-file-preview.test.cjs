const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const built = buildSync({ entryPoints: ['src/large-file.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = new Module('lf', module); mod._compile(built.outputFiles[0].text, 'lf.js');
const { largeFileNotice, PREVIEWABLE_READ_ERROR } = mod.exports;

test('large-file notice appears at or above the threshold only, and invalid thresholds never warn', () => {
  assert.equal(largeFileNotice(1024 * 1024 - 1, 1024), '');
  assert.match(largeFileNotice(1024 * 1024, 1024), /^Large file \(1\.0 MB\)\. Editing may be slow\./);
  assert.match(largeFileNotice(300 * 1024, 100), /Large file \(300 KB\)/);
  for (const bad of [undefined, null, 'x', NaN]) assert.equal(largeFileNotice(5e6, bad), '');
  assert.equal(largeFileNotice(NaN, 100), '');
});

test('only the two known "cannot edit" errors route to a read-only preview', () => {
  for (const m of ['Binary files cannot be edited', 'File exceeds 2 MB', 'Binary files cannot be edited (x)']) assert.ok(PREVIEWABLE_READ_ERROR.test(m), m);
  for (const m of ['ENOENT: no such file', 'The file is outside the project folder', 'Could not read a complete disk version.', 'CONFLICT: x']) assert.ok(!PREVIEWABLE_READ_ERROR.test(m), m);
});

test('setting is bounded and documented', () => {
  const { buildSync: b } = require('esbuild');
  const m = new Module('s', module); m._compile(b({ entryPoints: ['src/settings.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text, 's.js');
  const s = m.exports;
  assert.equal(s.resolveSettings()['editor.largeFileWarnKb'], 1024);
  for (const bad of [99, 2001, 1.5, '1024', NaN]) assert.throws(() => s.validateOverrides({ 'editor.largeFileWarnKb': bad }), String(bad));
  assert.equal(s.validateOverrides({ 'editor.largeFileWarnKb': 100 })['editor.largeFileWarnKb'], 100);
  assert.match(fs.readFileSync('SETTINGS.md', 'utf8'), /`editor\.largeFileWarnKb` \| `1024`/);
});

test('EditorPanel falls back to a read-only preview without creating a buffer or save path', () => {
  const panel = fs.readFileSync('src/EditorPanel.tsx', 'utf8');
  const catchBlock = panel.slice(panel.indexOf('// A binary or over-2 MB file'), panel.indexOf('} else setError(e.message);')).replace(/\/\/.*$/gm, '');
  assert.match(catchBlock, /op: "inspect"/);
  assert.doesNotMatch(catchBlock, /buffers\.set|setValue|persist|save|op: "save"/);
  assert.match(panel, /\{inspected && value === undefined \? \(\s*<FilePreview/);
  assert.match(panel, /largeFileNotice\(new TextEncoder\(\)\.encode\(disk\.content\)\.length, preferences\["editor\.largeFileWarnKb"\]\)/);
});

test('FilePreview renders read-only: image via data URL only, hex/text as plain pre, no editing controls', () => {
  const { mountComponent } = require('./helpers/virtual-list-harness.cjs');
  const render = info => { const v = mountComponent('src/FilePreview.tsx', 'default', { info, path: 'dir/a.png' }, { actualComponents: true, resolvedChildren: true, height: 300, rowHeight: 20 }); v.update({ info, path: 'dir/a.png' }); return v; };
  const img = render({ kind: 'image', size: 70, mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' });
  const im = img.nodes().find(n => n.type === 'img');
  assert.equal(im.props.src, 'data:image/png;base64,AAAA'); assert.match(im.props.alt, /Preview of a\.png/);
  assert.match(img.text(img.nodes().find(n => n.props?.className === 'editor-notice')), /Read-only/);
  const bin = render({ kind: 'binary', size: 600, hex: '00000000  00 01' });
  assert.ok(bin.nodes().some(n => n.type === 'pre')); assert.ok(!bin.nodes().some(n => ['textarea', 'input', 'img'].includes(n.type)));
  const big = render({ kind: 'large-text', size: 3e6, text: 'abc', shownBytes: 3 });
  assert.match(big.text(big.nodes().find(n => n.props?.className === 'editor-notice')), /Nothing here can be edited or saved/);
  assert.ok(!big.nodes().some(n => ['textarea', 'input'].includes(n.type)));
});

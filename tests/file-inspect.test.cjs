const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { classify, imageMime, hexRows, headText, IMAGE_MAX, HEAD_TEXT } = require('../electron/file-inspect.cjs');
const core = require('../electron/core.cjs');
const features = require('../electron/features.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]);

test('magic-byte detection: images, extension-gated bmp/ico, svg and text are not binary images', () => {
  assert.equal(imageMime(PNG), 'image/png'); assert.equal(imageMime(JPG), 'image/jpeg');
  assert.equal(imageMime(GIF), 'image/gif'); assert.equal(imageMime(WEBP), 'image/webp');
  assert.equal(imageMime(Buffer.from('BMxxxx'), 'a.bmp'), 'image/bmp'); assert.equal(imageMime(Buffer.from('BMxxxx'), 'a.txt'), '');
  assert.equal(imageMime(Buffer.from('<svg xmlns=...>')), '');
  assert.equal(classify(Buffer.from('hello'), 'a.txt'), 'text');
  assert.equal(classify(Buffer.from([1, 2, 0, 3]), 'a.bin'), 'binary');
  assert.equal(classify(PNG, 'renamed.txt'), 'image', 'content, not extension, decides');
});

test('hex rows and head text are bounded and well formed', () => {
  const rows = hexRows(Buffer.from('ABCDEFGHIJKLMNOPQRS\0'));
  assert.equal(rows.split('\n').length, 2);
  assert.match(rows.split('\n')[0], /^00000000  41 42 43 .* {2}ABCDEFGHIJKLMNOP$/);
  assert.match(rows.split('\n')[1], /^00000010  51 52 53 00 +  QRS\.$/);
  assert.equal(headText(Buffer.from('line1\nline2\npartial')), 'line1\nline2');
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrig-inspect-'));
  const w = (n, d) => fs.writeFileSync(path.join(dir, n), d);
  w('a.png', PNG); w('b.dat', Buffer.concat([Buffer.from([0, 1, 2, 3, 255]), Buffer.alloc(600, 7)]));
  w('big.txt', ('x'.repeat(99) + '\n').repeat(21000)); // ~2.1 MB
  w('small.txt', 'hello\n'); w('bigimg.png', Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX + 10)]));
  w('renamed.txt', GIF);
  return dir;
}
const local = { id: 'l', kind: 'local', name: 'L', root: '/' };
const inspectVia = (connection, dir, p) => features.edit(connection, { op: 'inspect', root: dir, path: p });

test('local inspect: image data URL, binary hex, large text head, small text, oversize image falls back', async () => {
  const dir = sandbox();
  try {
    const img = await inspectVia(local, dir, 'a.png');
    assert.equal(img.kind, 'image'); assert.equal(img.mime, 'image/png'); assert.equal(img.size, PNG.length);
    assert.equal(img.dataUrl, 'data:image/png;base64,' + PNG.toString('base64'));
    const bin = await inspectVia(local, dir, 'b.dat');
    assert.equal(bin.kind, 'binary'); assert.equal(bin.hex.split('\n').length, 32); assert.ok(!('dataUrl' in bin) && !('revision' in bin));
    const big = await inspectVia(local, dir, 'big.txt');
    assert.equal(big.kind, 'large-text'); assert.ok(big.size > 2000000); assert.ok(big.shownBytes <= HEAD_TEXT); assert.ok(big.text.endsWith('x'));
    assert.deepEqual(await inspectVia(local, dir, 'small.txt'), { kind: 'text', size: 6 });
    const huge = await inspectVia(local, dir, 'bigimg.png');
    assert.equal(huge.kind, 'binary'); assert.match(huge.note, /too large/); assert.ok(!huge.dataUrl);
    assert.equal((await inspectVia(local, dir, 'renamed.txt')).kind, 'image');
    await assert.rejects(inspectVia(local, dir, '../etc/passwd'));
    await assert.rejects(inspectVia(local, dir, '.'), /regular file|Not/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('remote python path returns the same results as the local path', async () => {
  const dir = sandbox();
  const original = core.remote;
  core.remote = async (connection, command, options) => {
    const r = cp.spawnSync('sh', ['-c', command], { input: options.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(r.stderr.trim().split('\n').pop());
    return r.stdout;
  };
  try {
    const ssh = { id: 's', kind: 'ssh', name: 'S', host: 'srv', root: '~' };
    for (const file of ['a.png', 'b.dat', 'big.txt', 'small.txt', 'bigimg.png', 'renamed.txt']) {
      const a = JSON.parse(JSON.stringify(await inspectVia(local, dir, file)));
      const b = JSON.parse(JSON.stringify(await inspectVia(ssh, dir, file)));
      assert.deepEqual(b, a, file);
    }
    await assert.rejects(inspectVia(ssh, dir, '../x'), /outside the project/);
  } finally { core.remote = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

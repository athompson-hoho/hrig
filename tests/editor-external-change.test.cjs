const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/editor-external-change.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: subject });
const { editorChangeOwner, canPublishEditorChange, canAcknowledgeEditorChange } = subject;
const config = () => ({ connection: { id: 'synthetic', kind: 'ssh', host: 'Host', port: 22,
  distro: 'Distro', rigBinary: 'rig', root: '/connection' }, root: '/panel', path: 'File.ts' });

for (const [level, fields] of [['connection', ['id', 'kind', 'host', 'port', 'distro', 'rigBinary', 'root']],
  ['panel', ['root', 'path']]]) {
  for (const key of fields) test(`raw owner ${level}.${key} preserves presence values case and whitespace`, () => {
    const variants = [undefined, null, '', 'Value', 'value', ' Value ', 0];
    const owners = variants.map(value => {
      const c = config(); (level === 'connection' ? c.connection : c)[key] = value;
      return editorChangeOwner('panel', c);
    });
    const absent = config(); delete (level === 'connection' ? absent.connection : absent)[key];
    owners.push(editorChangeOwner('panel', absent));
    assert.equal(new Set(owners).size, owners.length);
  });
}
test('panel id and diff are identity; display name is not identity', () => {
  const c = config(), owner = editorChangeOwner('panel', c);
  assert.notEqual(editorChangeOwner('other', c), owner);
  assert.notEqual(editorChangeOwner('panel', c, true), owner);
  c.connection.name = 'Renamed display only';
  assert.equal(editorChangeOwner('panel', c), owner);
});
test('publication requires current buffer lifetime request edit epoch and baseline', () => {
  const capture = { owner: 'raw-owner', lifetime: {}, buffer: {}, request: 3, edit: 8,
    content: 'local', saved: 'disk', revision: 'r1' };
  assert.equal(canPublishEditorChange(capture, { ...capture }), true);
  for (const [key, value] of Object.entries({ owner: 'other', lifetime: {}, buffer: {},
    request: 4, edit: 10, content: 'new typing', saved: 'other baseline', revision: 'r2' })) {
    assert.equal(canPublishEditorChange(capture, { ...capture, [key]: value }), false, key);
  }
  assert.equal(canPublishEditorChange(capture, { ...capture, edit: 10 }), false, 'ABA edit is still newer');
  assert.equal(canPublishEditorChange(capture, { ...capture, edit: 10, content: 'new' }, false), true,
    'Save may accept captured text while preserving newer typing');
  assert.equal(canPublishEditorChange(capture, { ...capture, saved: 'new' }, false), false);
});
test('acknowledgement requires exact represented revision and no conflicting request', () => {
  assert.equal(canAcknowledgeEditorChange('r1', 'r1', false), true);
  assert.equal(canAcknowledgeEditorChange('r1', 'r2', false), false);
  assert.equal(canAcknowledgeEditorChange('r1', undefined, false), false);
  assert.equal(canAcknowledgeEditorChange('r1', 'r1', true), false);
});


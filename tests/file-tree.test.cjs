const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/file-tree.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject });
const { fileTreeOwner, normalizeFileQuery, resolveRevealPath, projectFileMatches } = exportsObject;
const connection = Object.freeze({ id: 'fixture', kind: 'ssh', host: 'synthetic.invalid',
  port: 2222, distro: 'test', rigBinary: '/synthetic/rig' });
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { ...exportsObject };
if (require.main === module) {
  const { test } = require('node:test');
  test('owner uses every raw endpoint slot and exact root, excluding display metadata', () => {
    const owner = fileTreeOwner(connection, '/project');
    assert.equal(owner, '["fixture","ssh","synthetic.invalid",2222,"test","/synthetic/rig","/project"]');
    for (const [slot, value] of Object.entries({ id: 'other', kind: 'wsl', host: 'other', port: 2200,
      distro: 'other', rigBinary: '/other' })) {
      assert.notEqual(fileTreeOwner({ ...connection, [slot]: value }, '/project'), owner, slot);
      assert.notEqual(fileTreeOwner({ ...connection, [slot]: undefined }, '/project'), owner, `${slot} absent`);
    }
    assert.notEqual(fileTreeOwner(connection, '/project/'), owner);
    assert.equal(fileTreeOwner({ ...connection, name: 'Display only' }, '/project'), owner);
    assert.equal(fileTreeOwner({ id: 'x', kind: 'local' }, '.'), '["x","local",null,null,null,null,"."]');
  });
  test('query trims without interpreting literal case or metacharacters and enforces raw bounds', () => {
    for (const [value, expected] of [['', ''], ['   ', ''], ['  A[?]*.TS  ', 'A[?]*.TS'],
      ['x'.repeat(300), 'x'.repeat(300)], ['x'.repeat(301), null], [' '.repeat(301), null],
      ['a\nb', null], ['a\0b', null], ['a\x7fb', null]]) assert.equal(normalizeFileQuery(value), expected);
  });
  test('POSIX reveal paths preserve exact case and require separator containment and safe segments', () => {
    const cases = [
      ['/project', 'src/a.ts', 'src/a.ts'], ['relative', 'src/a.ts', 'src/a.ts'],
      ['~/project', '/project/a.ts', null], ['relative', '/relative/a.ts', null],
      ['/project', '/project/src/a.ts', 'src/a.ts'], ['/project/', '/project/a.ts', 'a.ts'],
      ['/', '/a.ts', 'a.ts'], ['/project', '/project-other/a.ts', null],
      ['/project', '/Project/a.ts', null], ['/project', '/project', null],
      ['/project', '../a.ts', null], ['/project', 'src/../a.ts', null],
      ['/project', './a.ts', null], ['/project', 'src//a.ts', null],
      ['/project', 'a.ts/', null], ['/project', 'a\\b.ts', null],
      ['/project', 'C:/a.ts', null], ['/project', '//server/share/a.ts', null],
      ['/project', 'a\0.ts', null], ['/project', '', null],
      ['/project/../else', '/project/../else/a.ts', null],
    ];
    for (const [root, path, expected] of cases) assert.equal(resolveRevealPath(connection, root, path, 'linux'), expected, `${root} | ${path}`);
    assert.equal(resolveRevealPath({ ...connection, kind: 'wsl' }, 'C:/project', 'C:/project/a.ts', 'win32'), null);
    assert.equal(resolveRevealPath(connection, '/project', '/Project/a.ts', 'win32'), null);
  });
  test('local Windows drive and UNC reveal accepts only unambiguous bounded absolute roots', () => {
    const local = { ...connection, kind: 'local' };
    for (const [root, path, expected] of [
      ['C:\\Project', 'c:\\project\\src\\A.ts', 'src/A.ts'],
      ['C:/Project/', 'C:/Project/a.ts', 'a.ts'],
      ['C:/', 'C:/a.ts', 'a.ts'],
      ['\\\\server\\share\\Project', '\\\\SERVER\\SHARE\\Project\\a.ts', 'a.ts'],
      ['//server/share/Project', '//server/share/Project/a.ts', 'a.ts'],
      ['C:/Project', 'C:/ProjectOther/a.ts', null],
      ['C:Project', 'C:/Project/a.ts', null],
      ['~/Project', 'C:/Project/a.ts', null],
      ['C:/Project', 'D:/Project/a.ts', null],
      ['C:/Project', 'C:/Project/../a.ts', null],
      ['C:/Project', 'C:Project/a.ts', null],
      ['C:/Project', 'src/a.ts', 'src/a.ts'],
      ['C:/Project', 'src\\a.ts', null],
    ]) assert.equal(resolveRevealPath(local, root, path, 'win32'), expected, `${root} | ${path}`);
  });
  test('projection produces independent directory-first sibling order and exact duplicate identities without mutation', () => {
    const inputs = Object.freeze([
      { name: 'ignored', path: 'z/same.ts', directory: false },
      { name: 'same.ts', path: 'a/same.ts', directory: false },
      { name: 'again', path: 'z/same.ts', directory: false },
      { name: 'B.ts', path: 'B.ts', directory: false },
      { name: 'a.ts', path: 'a.ts', directory: false },
      { name: 'folder', path: 'folder', directory: true },
      { name: 'bad', path: '../bad', directory: false },
    ].map(Object.freeze));
    const before = JSON.stringify(inputs);
    const expected = [
      { name: 'a', path: 'a', directory: true },
      { name: 'same.ts', path: 'a/same.ts', directory: false },
      { name: 'z', path: 'z', directory: true },
      { name: 'same.ts', path: 'z/same.ts', directory: false },
      { name: 'a.ts', path: 'a.ts', directory: false },
      { name: 'B.ts', path: 'B.ts', directory: false },
    ];
    assert.deepEqual(plain(projectFileMatches(inputs)), expected);
    assert.deepEqual(plain(projectFileMatches([...inputs].reverse())), expected);
    assert.equal(JSON.stringify(inputs), before);
    assert.deepEqual(plain(projectFileMatches([])), []);
    assert.deepEqual(plain(projectFileMatches([{ name: 'x', path: 'x', directory: false }])), [{ name: 'x', path: 'x', directory: false }]);
    const capped = projectFileMatches(Array.from({ length: 101 }, (_, i) => ({ name: String(i), path: `dir/${i}`, directory: false })));
    assert.equal(capped.filter(e => !e.directory).length, 100);
    assert.equal(capped.some(e => e.path === 'dir/100'), false);
  });
}

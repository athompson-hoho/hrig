const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/terminal-path-links.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: exportsForTest});
const {matchTerminalPaths, terminalPathLinks} = exportsForTest;
const plain = value => JSON.parse(JSON.stringify(value));

test('matches conventional paths and unambiguous quoted paths with location suffixes', () => {
  const text = `at (src/main.ts:12:3), "src/my file.ts":42:2 './other file.js:7' C:\\work\\index.ts`;
  const matches = plain(matchTerminalPaths(text));
  assert.deepEqual(matches.map(({file,line}) => ({file,line})), [
    {file:'src/main.ts',line:12}, {file:'src/my file.ts',line:42},
    {file:'./other file.js',line:7}, {file:'C:\\work\\index.ts',line:undefined},
  ]);
  for (const match of matches) assert.ok(text.slice(match.start,match.end).startsWith(match.file));
});

test('does not turn URL fragments, shell syntax or malformed quotes into paths', () => {
  for (const text of [
    'https://user:secret@example.com/a.ts', 'https://example.com/a.ts',
    'file:///etc/passwd.txt', 'vscode://file/a.ts', '$(secret.txt)',
    '"good file.ts"junk', '"escaped\\"file.ts"',
    '"$HOME/file.ts"', '"src/file.ts":0', 'src/file.ts:9007199254740993',
  ]) assert.deepEqual(plain(matchTerminalPaths(text)), [], text);
});

function buffer(rows) {
  return {length:rows.length, getLine(i) {
    if (!rows[i]) return;
    const [text, isWrapped] = rows[i];
    const cells = [];
    for (const chars of text) {
      const width = chars === '界' ? 2 : 1;
      cells.push({getChars:()=>chars, getWidth:()=>width});
      if (width === 2) cells.push({getChars:()=>'',getWidth:()=>0});
    }
    return {isWrapped,length:cells.length,getCell:i=>cells[i]};
  }};
}
test('soft wraps produce one range and the same file on either hovered row', () => {
  const b = buffer([['src/long/',false],['file.ts:8',true],['other.ts ',false]]);
  for (const y of [1,2]) {
    const links = plain(terminalPathLinks(b,y));
    assert.equal(links.length,1);
    assert.equal(links[0].file,'src/long/file.ts');
    assert.equal(links[0].line,8);
    assert.deepEqual(links[0].range,{start:{x:1,y:1},end:{x:9,y:2}});
  }
  assert.equal(terminalPathLinks(b,3)[0].file,'other.ts');
});
test('quoted paths preserve spaces at wrap boundaries and ranges use cell columns', () => {
  const b = buffer([['界 "src/my ',false],['file.ts"    ',true]]);
  const link = plain(terminalPathLinks(b,2))[0];
  assert.equal(link.file,'src/my file.ts');
  assert.deepEqual(link.range,{start:{x:5,y:1},end:{x:7,y:2}});
});
test('hard breaks never join paths and very long logical lines are bounded', () => {
  assert.equal(terminalPathLinks(buffer([['src/long/',false],['file.ts',false]]),2)[0].file,'file.ts');
  assert.deepEqual(plain(terminalPathLinks(buffer(Array.from({length:202},(_,i)=>['a',i>0])),1)),[]);
});
test('compiler locations and sentence punctuation retain file links', () => {
  for (const [text,line] of [['src/a.ts:12:3: error',12],['src/a.ts:12:',12],['src/a.ts(12,3): error',12],['see src/a.ts.',undefined]]) {
    const links = plain(matchTerminalPaths(text));
    assert.equal(links[0]?.file,'src/a.ts',text);
    assert.equal(links[0]?.line,line,text);
  }
});
test('quoted prose is not treated as a whitespace-containing filename', () => {
  assert.equal(matchTerminalPaths('Error: "Cannot read file foo.ts"').some(m => m.file === 'Cannot read file foo.ts'),false);
});
test('unmatched opening quote does not hide later paths', () => {
  assert.ok(matchTerminalPaths('"unterminated x then src/a.ts').some(m => m.file === 'src/a.ts'));
});

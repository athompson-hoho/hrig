const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');
const exportsForTest={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/terminal-commands.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsForTest});
const {snippetError}=exportsForTest;
test('printable shell text is preserved and accepted',()=>{
  for(const text of ['git status','echo "hello world"','printf "\\n"','echo café','one && two']) assert.equal(snippetError(text),'');
});
test('insertion rejects submit keys, escape sequences and multiline/control input',()=>{
  for(const text of ['', '  ', 'ls\nrm x','ls\r','\x1b[200~','a\x00b','a\tb','a\x7fb','a\u0085b','a\u2028b','x'.repeat(10001)]) assert.notEqual(snippetError(text),'');
});
test('rejects invisible format controls that could disguise reviewed text',()=>{
  for (const code of [0x202a,0x202e,0x2066,0x2069,0x200b,0x200c,0x200d,0xfeff,0x00ad]) {
    assert.notEqual(snippetError('echo a'+String.fromCodePoint(code)+'b'),'');
  }
});

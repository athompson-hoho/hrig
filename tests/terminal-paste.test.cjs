const {test}=require('node:test'),assert=require('node:assert/strict');const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');const out={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/terminal-paste.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:out});
test('mixed clipboard pastes text without opening an image-upload confirmation',async()=>{
 const sent=[];await out.pasteClipboard({readText:async()=> 'a\tb\nc\td',hasImage:async()=>true,pasteText:s=>sent.push(s),pasteImage:async()=>{throw Error('Image dialog must not open');}});assert.deepEqual(sent,['a\tb\nc\td']);
});
test('image-only clipboard takes image flow, empty clipboard sends nothing',async()=>{
 for(const has of [true,false]){let count=0;await out.pasteClipboard({readText:async()=>'',hasImage:async()=>has,pasteText:()=>{throw Error('No text expected');},pasteImage:async()=>{count++;}});assert.equal(count,has?1:0);}
});

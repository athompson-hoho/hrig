const {test}=require('node:test'),assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');const out={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/terminal-navigation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:out});
test('error navigation moves in either direction, respects boundaries, and does not wrap',()=>{
 const rows=['ok','error: broken','still ok','Traceback (most recent call last):','failed'];const b={length:rows.length,getLine:i=>({translateToString:()=>rows[i]})};
 assert.equal(out.errorLine(b,0,1),1);assert.equal(out.errorLine(b,3,-1),1);assert.equal(out.errorLine(b,3,1),4);assert.equal(out.errorLine(b,4,1),null);assert.equal(out.errorLine(b,0,-1),null);
});

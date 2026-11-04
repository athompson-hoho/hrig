const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {MAX_IMAGE_BYTES,validateImage,imageDestination,saveImage,quotedImagePath}=require('../electron/terminal-images.cjs');
test('image bounds and random paths reject malformed values',()=>{
 assert.throws(()=>validateImage(Buffer.alloc(0)));assert.throws(()=>validateImage(Buffer.alloc(MAX_IMAGE_BYTES+1)));validateImage(Buffer.from('png'));
 assert.throws(()=>imageDestination({kind:'ssh'},'../escape'));
 assert.match(imageDestination({kind:'ssh'},'12345678-1234-1234-1234-123456789abc'),/^\/tmp\/hrig-image-[a-f0-9-]+\/image.png$/);
});
test('path quoting preserves spaces and quotes without a submit key',()=>{
 assert.equal(quotedImagePath("a'b c"),"'a'\\''b c'");assert.equal(quotedImagePath("a'b c",'powershell'),"'a''b c'");assert.equal(quotedImagePath('C:\\a b\\x.png','cmd'),'"C:\\a b\\x.png"');assert.throws(()=>quotedImagePath('%bad%','cmd'));
});
test('local upload preserves bytes and creates private files without overwriting',async()=>{
 const dest=imageDestination({kind:'local'});const data=Buffer.from([137,80,78,71,0,1]);
 try{await saveImage({kind:'local'},dest,data);assert.deepEqual(await fs.readFile(dest),data);if(process.platform!=='win32'){assert.equal((await fs.stat(dest)).mode&0o777,0o600);assert.equal((await fs.stat(path.dirname(dest))).mode&0o777,0o700);}await assert.rejects(saveImage({kind:'local'},dest,data));}finally{await fs.rm(path.dirname(dest),{recursive:true,force:true});}
});
test('remote upload streams bytes through stdin and creates private target files',async()=>{
 const core=require('../electron/core.cjs');const original=core.remote;const target=imageDestination({kind:'ssh'});const png=Buffer.from('private-image-bytes');
 core.remote=async(connection,command,options)=>{assert.equal(command.includes(png.toString()),false);assert.deepEqual(options.input,png);return core.execute('/bin/bash',['-lc',command],options);};
 try{await saveImage({kind:'ssh'},target,png);assert.deepEqual(await fs.readFile(target),png);assert.equal((await fs.stat(target)).mode&0o777,0o600);assert.equal((await fs.stat(path.dirname(target))).mode&0o777,0o700);}finally{core.remote=original;await fs.rm(path.dirname(target),{recursive:true,force:true});}
});

const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('./core.cjs');
const MAX_IMAGE_BYTES=10*1024*1024;
function validateImage(buffer){if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_IMAGE_BYTES)throw Error('Clipboard image must be a nonempty PNG no larger than 10 MiB.');}
function imageDestination(connection,uuid=crypto.randomUUID()){
 if(!/^[a-f0-9-]{36}$/.test(uuid))throw Error('Invalid image identifier.');
 return (connection.kind==='local'?path.join(os.tmpdir(),`hrig-image-${uuid}`,'image.png'):`/tmp/hrig-image-${uuid}/image.png`);
}
const remoteProgram=`import os,sys,stat,re,time,shutil
p=sys.argv[1]
root=os.path.dirname(p)
for name in os.listdir('/tmp'):
 if not re.fullmatch(r'hrig-image-[a-f0-9-]{36}',name): continue
 old='/tmp/'+name
 try:
  info=os.lstat(old)
  if stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and time.time()-info.st_mtime>86400: shutil.rmtree(old)
 except OSError: pass
os.mkdir(root,0o700)
try:
 data=sys.stdin.buffer.read(10485761)
 if not data or len(data)>10485760: raise ValueError('Image exceeds size limit')
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as out: out.write(data)
except:
 shutil.rmtree(root)
 raise
`;
async function saveImage(connection,target,buffer){
 validateImage(buffer);
 if(connection.kind!=='local'){
  await core.remote(connection,`python3 -c ${core.quote(remoteProgram)} ${core.quote(target)}`,{input:buffer});return;
 }
 const base=os.tmpdir();
 for(const name of await fs.readdir(base)){
  if(!/^hrig-image-[a-f0-9-]{36}$/.test(name))continue;
  const entry=path.join(base,name);
  try{const s=await fs.lstat(entry);if(s.isDirectory()&&!s.isSymbolicLink()&&(typeof process.getuid!=='function'||s.uid===process.getuid())&&Date.now()-s.mtimeMs>86400000)await fs.rm(entry,{recursive:true});}catch{}
 }
 await fs.mkdir(path.dirname(target),{mode:0o700});
 try{await fs.writeFile(target,buffer,{mode:0o600,flag:'wx'});}catch(e){await fs.rm(path.dirname(target),{recursive:true,force:true});throw e;}
}
function quotedImagePath(value,shell='posix'){
 if(shell==='cmd'){if(/[%!\r\n"]/.test(value))throw Error('This temp path cannot be safely inserted into Command Prompt.');return '"'+value+'"';}
 return shell==='powershell'?"'"+value.replace(/'/g,"''")+"'":core.quote(value);}
module.exports={MAX_IMAGE_BYTES,validateImage,imageDestination,saveImage,quotedImagePath};

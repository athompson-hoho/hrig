const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {plainTerminalStream,createTerminalLogs}=require('../electron/terminal-logging.cjs');
test('strips split CSI, OSC, DCS and cursor controls without retaining payloads',()=>{
 const source='hello\x1b[31m red\x1b[0m\x1b]52;c;secret\x07\x1bPpayload\x1b\\\r\b\x00\nend';
 for(let split=0;split<=source.length;split++){const strip=plainTerminalStream();assert.equal(strip(source.slice(0,split))+strip(source.slice(split)),'hello red\nend');}
});
test('off by default, appends sanitized output, drains stop, enforces file bound',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hrig-log-'));const file=path.join(dir,'out.log');
 try{await fs.writeFile(file,'before\n');const logs=createTerminalLogs({maxBytes:30});
 logs.append('a','ignored');assert.equal(logs.state('a').active,false);
 await logs.start('a',file);logs.append('a','\x1b[31mhello\x1b[0m\n');await logs.stop('a');
 logs.append('a','ignored');assert.equal(await fs.readFile(file,'utf8'),'before\nhello\n');
 await logs.start('a',file);logs.append('a','x'.repeat(30));await logs.stop('a');assert.match(logs.state('a').error,/limit/);
 assert.equal(await fs.readFile(file,'utf8'),'before\nhello\n');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('write failures stop recording with visible state and close the file',async()=>{
 let closed=false;const states=[];
 const logs=createTerminalLogs({notify:s=>states.push(s),io:{open:async()=>({stat:async()=>({isFile:()=>true,size:0}),writeFile:async()=>{throw Error('disk full');},close:async()=>{closed=true;}})}});
 await logs.start('a','chosen');logs.append('a','hello');await logs.stop('a');assert.equal(closed,true);assert.match(logs.state('a').error,/disk full/);assert.ok(states.some(s=>!s.active&&s.error));
});
test('slow disk queue is bounded and closes after draining accepted data',async()=>{
 let release;const gate=new Promise(r=>release=r);let text='';
 const logs=createTerminalLogs({maxPending:4,io:{open:async()=>({stat:async()=>({isFile:()=>true,size:0}),writeFile:async value=>{await gate;text+=value;},close:async()=>{}})}});
 await logs.start('a','chosen');logs.append('a','1234');logs.append('a','5');assert.equal(logs.state('a').active,false);assert.match(logs.state('a').error,/keep up/);release();await logs.stop('a');assert.equal(text,'1234');
});
test('malformed control strings recover without silently discarding later output',()=>{
 const strip=plainTerminalStream();strip('a\x1b]0;'+ 'x'.repeat(4097));assert.equal(strip('\nline2\n'),'\nline2\n');
 const again=plainTerminalStream();assert.equal(again('a\x1b\nb'),'a\nb');
 const nested=plainTerminalStream();assert.equal(nested('x\x1b[\x1b[31mred'),'xred');
 const restart=plainTerminalStream();restart('\x1b]bad');assert.equal(restart('\x1b[31mred'),'red');
});

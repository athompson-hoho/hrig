const test=require('node:test');const assert=require('node:assert/strict');const {sanitizeOrca}=require('../electron/accounts.cjs');
test('account discovery whitelists display metadata and respects local/WSL/SSH scope',()=>{
 const value={result:{codex:{accounts:[{id:'one',email:'account@example.test',managedHomeRuntime:'host',token:'never-return',home:'/private',auth:{secret:'never-return'}},{id:'two',managedHomeRuntime:'wsl',wslDistro:'Ubuntu'},null]},claude:{accounts:[]}}};
 const local=sanitizeOrca(value,{kind:'local'});assert.equal(local[0].hostMatch,true);assert.equal(local[1].hostMatch,false);assert.equal(JSON.stringify(local).includes('never-return'),false);assert.equal(JSON.stringify(local).includes('/private'),false);
 assert.equal(sanitizeOrca(value,{kind:'wsl',distro:'Ubuntu'})[1].hostMatch,true);assert.equal(sanitizeOrca(value,{kind:'wsl',distro:'Debian'})[1].hostMatch,false);assert.ok(sanitizeOrca(value,{kind:'ssh'}).every(a=>!a.hostMatch));
 assert.deepEqual(sanitizeOrca({}, {kind:'local'}),[]);
});

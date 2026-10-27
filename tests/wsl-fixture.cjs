const crypto = require("node:crypto");
const core = require("../electron/core.cjs");

// A test-only CLI implementing the documented OpenRig JSON boundary. The WSL
// transport, filesystem, ConPTY and tmux session underneath it are all real.
async function createWslFixture() {
  const connections = await core.detectConnections();
  const distro = connections.find((c) => c.kind === "wsl");
  if (!distro) return null;
  const name = "hrig-test-" + crypto.randomUUID().slice(0, 8);
  const root = "/tmp/" + name;
  const session = name + "@fixture";
  const connection = {
    ...distro,
    id: name,
    name: "WSL transport fixture",
    root,
    rigBinary: root + "/rig-fixture",
  };
  const script = `#!/usr/bin/env python3
import json,sys,os
root=os.path.dirname(__file__)
def value(flag,default=''):
 return sys.argv[sys.argv.index(flag)+1] if flag in sys.argv else default
if '--help' in sys.argv: print('--json --delete --snapshot --cwd --existing --plan --non-interruptive --source --destination --summary --body --to')
elif sys.argv[1]=='--version': print('0.6.14-test-fixture')
elif sys.argv[1]=='ps':
 session=open(root+'/session.txt').read().strip() if os.path.exists(root+'/session.txt') else ${JSON.stringify(session)}
 print(json.dumps([{'rigId':'test-rig','rigName':'fixture','logicalId':'builder','runtime':'test-shell','canonicalSessionName':session,'sessionStatus':'running','needsAttention':os.path.exists(root+'/attention')}] if '--nodes' in sys.argv else [{'rigId':'test-rig','name':'fixture','nodeCount':1,'status':'running'}]))
elif sys.argv[1]=='specs':
 if '--kind' in sys.argv and value('--kind')=='agent': print(json.dumps([{'id':name,'name':name,'kind':'agent','sourcePath':root+'/'+name+'/agent.yaml','summary':'Fixture '+name} for name in ['implementer','reviewer','qa','orchestrator','researcher','planner','product-designer']]))
 else: print(json.dumps([{'name':'starter','kind':'rig'}] if sys.argv[2]=='ls' else {'name':'starter','seats':['builder']}))
elif sys.argv[1] in ['up','down']:
 with open(root+'/actions.jsonl','a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')
 print(json.dumps({'preview':'--plan' in sys.argv,'operation':sys.argv[1],'name':sys.argv[2], 'deleted':'--delete' in sys.argv and not os.path.exists(root+'/block-delete'), 'deleteBlocked':os.path.exists(root+'/block-delete'), 'errors':['Fixture preflight blocked'] if '--plan' in sys.argv and os.path.exists(root+'/block-plan') else []}))
elif sys.argv[1]=='send':
 with open(root+'/sent.jsonl','a') as f: f.write(json.dumps(sys.argv[2:])+'\\n')
 print('Delivered by test fixture')
elif sys.argv[1]=='queue':
 if '--rig' in sys.argv: raise Exception('queue list does not support --rig')
 if sys.argv[2]=='create':
  row={'qitemId':'created-task','subject':value('--summary'),'body':value('--body'),'state':'pending','destinationSession':value('--destination')}
  with open(root+'/task.json','w') as f: json.dump(row,f)
  print(json.dumps(row))
 elif sys.argv[2]=='show': print(json.dumps({'qitemId':sys.argv[3],'body':'Fixture task details','state':'pending'}))
 elif sys.argv[2]=='handoff': print(json.dumps({'qitemId':sys.argv[3],'destinationSession':value('--to')}))
 else:
  rows=[{'qitemId':'test-task','subject':'Review the transport fixture','state':'pending','destinationSession':'builder@fixture'}]
  if os.path.exists(root+'/task.json'): rows.append(json.load(open(root+'/task.json')))
  print(json.dumps(rows))
else: raise Exception('Unsupported test fixture command')
`;
  const setup = `import os,base64
root=${JSON.stringify(root)}
os.mkdir(root)
with open(root+'/rig-fixture','wb') as f: f.write(base64.b64decode('${Buffer.from(script).toString("base64")}'))
os.chmod(root+'/rig-fixture',0o700)
with open(root+'/hello.py','w') as f: f.write('message = "Hello from WSL"\\n')
`;
  await core.remote(
    connection,
    `python3 -c ${core.quote(setup)} && tmux new-session -d -s ${core.quote(session)} -c ${core.quote(root)} 'bash --noprofile --norc'`,
  );
  return {
    connection,
    root,
    session,
    async cleanup() {
      await core
        .remote(connection, `tmux kill-session -t ${core.quote("=" + session)}`)
        .catch(() => {});
      // The unique, explicitly named fixture directory is the sole cleanup target.
      await core
        .remote(
          connection,
          `python3 -c ${core.quote(`import shutil; shutil.rmtree(${JSON.stringify(root)})`)}`,
        )
        .catch(() => {});
    },
  };
}
module.exports = { createWslFixture };

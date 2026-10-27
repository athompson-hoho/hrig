// Only documented noninteractive adapters are eligible for direct execution.
// Prompt input travels over stdin, never through shell interpolation.
const runner = `import os,sys,json,shutil,subprocess,signal
a=json.load(sys.stdin)
commands={'codex':['codex','--ask-for-approval','never','exec','--sandbox','read-only','--ephemeral','--skip-git-repo-check','-'], 'claude-code':['claude','-p','--output-format','json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence']}
if a['op']=='providers':
 out=[]
 for key,args in commands.items():
  installed=bool(shutil.which(args[0])); status='missing'
  if installed:
   try:
    check=subprocess.run([args[0]]+(['login','status'] if key=='codex' else ['auth','status']),capture_output=True,text=True,timeout=8)
    status='authenticated' if check.returncode==0 else 'unverified'
   except (OSError,subprocess.TimeoutExpired): status='unverified'
  out.append({'id':key,'installed':installed,'status':status})
 print(json.dumps({'providers':out})); sys.exit(0)
if a.get('provider') not in commands: raise RuntimeError('Choose Codex or Claude Code for direct assessment')
root=os.path.realpath(os.path.expanduser(a['root']))
if not os.path.isdir(root): raise RuntimeError('Project folder does not exist')
env=os.environ.copy()
for key in ('OPENRIG_SESSION_NAME','RIGGED_SESSION_NAME','CLAUDECODE'): env.pop(key,None)
p=subprocess.Popen(commands[a['provider']],cwd=root,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
try: out,err=p.communicate(a['prompt'],timeout=150)
except subprocess.TimeoutExpired:
 os.killpg(p.pid,signal.SIGKILL); p.communicate(); raise RuntimeError('Assessment timed out after 150 seconds. Retry or use the portable prompt.')
if p.returncode: raise RuntimeError('Provider assessment failed. Check sign-in and CLI compatibility, or use the portable prompt.')
if len(out)>200000: raise RuntimeError('Provider response exceeded the assessment limit')
if a['provider']=='claude-code':
 response=json.loads(out)
 if response.get('is_error'): raise RuntimeError('Claude assessment failed; check provider access')
 out=response.get('result','')
print(json.dumps({'content':out}))`;
module.exports = { runner };

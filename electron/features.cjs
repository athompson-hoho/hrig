const core = require("./core.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const teamAssessment = require("./team-assessment.cjs");
const contentSearch = require("./content-search.cjs");

async function assessTeam(connection, request) {
  core.validateConnection(connection);
  if (request.op === "accounts")
    return require("./accounts.cjs").discover(connection, () => assessmentProvider(connection, { op: "providers" }));
  if (request.op === "providers") return assessmentProvider(connection, request);
  const catalog = await rigAction(connection, { op: "agents" });
  const agents = Array.isArray(catalog)
    ? catalog
    : catalog.entries || catalog.items || [];
  if (request.op === "import")
    return teamAssessment.validateRecommendation(request.content, agents);
  if (
    !["brief", "run"].includes(request.op) ||
    typeof request.root !== "string" ||
    !request.root.trim() ||
    typeof request.goal !== "string" ||
    !request.goal.trim() ||
    request.goal.length > 4000 ||
    typeof request.constraints !== "string" ||
    request.constraints.length > 4000
  )
    throw new Error(
      "Provide a project folder, goal and constraints under 4,000 characters.",
    );
  if (request.answers !== undefined && (!Array.isArray(request.answers) || request.answers.length > 3 || request.answers.some(a => !a || typeof a.question !== "string" || a.question.length > 4000 || typeof a.answer !== "string" || a.answer.length > 4000)))
    throw new Error("Provide at most three answers under 4,000 characters each.");
  const accountBudgets = (await import("./runtime-preferences.mjs")).normalizeMonthlyBudgets(request.accountBudgets);
  const tuning = teamAssessment.validateTuning(request, agents);
  const context = await python(
    connection,
    `import os,sys,json,platform,shutil
a=json.load(sys.stdin)
root=os.path.realpath(os.path.expanduser(a['root']))
if not os.path.isdir(root): raise RuntimeError('Project folder does not exist')
memory={}
try:
 for line in open('/proc/meminfo'):
  key,_,value=line.partition(':')
  if key in ('MemTotal','MemAvailable'): memory[key+'KiB']=int(value.split()[0])
except OSError: pass
names=[]
with os.scandir(root) as entries:
 for entry in entries:
  if len(names)>=100: break
  if not entry.name.startswith('.') and entry.name not in ('node_modules','vendor','dist','build'): names.append(entry.name)
manifest={}
try:
 target=os.path.realpath(os.path.join(root,'package.json'))
 if os.path.commonpath([root,target])==root and os.path.getsize(target)<65536:
  with open(target) as f: package=json.load(f)
  manifest={'dependencyNames':sorted(set(package.get('dependencies',{}))|set(package.get('devDependencies',{})))[:100],'scriptNames':sorted(package.get('scripts',{}))[:40]}
except (OSError,ValueError,TypeError,AttributeError): pass
print(json.dumps({'root':root,'platform':platform.system(),'architecture':platform.machine(),'logicalCpus':os.cpu_count(),'memory':memory,'providerExecutables':{n:bool(shutil.which(n)) for n in ('codex','claude','grok','antigravity')},'topLevelEntries':sorted(names),'entryLimit':100,'package.json':manifest}))`,
    { root: request.root },
  );
  const accountAvailability = await require("./accounts.cjs").discover(connection, () => assessmentProvider(connection, { op: "providers" }));
  const prompt = teamAssessment.buildPrompt(
      { ...context, accountAvailability: { monthlyPlanUsd: accountBudgets, budgetSource: "operator-provided preference; not detected quota", providers: accountAvailability.providers, checkedAt: accountAvailability.checkedAt, warning: accountAvailability.warning, note: "Recommend authenticated runtimes on this host. Managed Orca accounts do not establish CLI access. Never infer quota or context availability from authentication." } },
      {
        root: request.root,
        goal: request.goal,
        constraints: request.constraints,
        work: request.work,
        answers: request.answers || [],
        ...tuning,
      },
      agents,
    );
  if (request.op === "run") {
    const result = await assessmentProvider(connection, { op: "run", root: request.root, provider: request.provider, prompt });
    return { prompt, ...teamAssessment.validateRecommendation(result.content, agents) };
  }
  return { prompt };
}

async function assessmentProvider(connection, request) {
  if (!["providers", "run"].includes(request.op) || (request.op === "run" && !["codex", "claude-code"].includes(request.provider)))
    throw new Error("Choose a supported assessment provider.");
  const source = require("./assessment-provider.cjs").runner;
  const program = "import base64;exec(base64.b64decode(" + JSON.stringify(Buffer.from(source).toString("base64")) + "))";
  return core.parseJson(await core.remote(connection, NVM + `python3 -c ${core.quote(program)}`, { input: JSON.stringify(request), timeout: 165000 }));
}

// Program source is encoded; request payloads travel on stdin, not command lines.
async function python(connection, source, request, executionOptions = {}) {
  const program =
    "import base64;exec(base64.b64decode(" +
    JSON.stringify(Buffer.from(source).toString("base64")) +
    "))";
  const output = await core.remote(
    connection,
    `python3 -c ${core.quote(program)}`,
    { input: JSON.stringify(request), ...executionOptions },
  );
  if (output && typeof output === "object" && output.aborted === true) {
    const matches = [];
    const timedOutFiles = [];
    let timedOutFileCount = 0;
    for (const line of String(output.stdout || "").split(/\r?\n/)) {
      try {
        const event = JSON.parse(line);
        if (event?.event === "match") matches.push(event.match);
        if (event?.event === "file-timeout") {
          timedOutFileCount++;
          if (timedOutFiles.length < 20 && typeof event.path === "string") timedOutFiles.push(event.path);
        }
      } catch {}
    }
    return { matches, truncated: true, reason: "cancelled", timedOutFiles, timedOutFileCount };
  }
  return core.parseJson(output);
}
const NVM =
  'HRIG_RIG_PATH=$(command -v rig 2>/dev/null || true); if ! command -v node >/dev/null 2>&1 || [ -z "$HRIG_RIG_PATH" ] || [ "${HRIG_RIG_PATH#/mnt/}" != "$HRIG_RIG_PATH" ]; then if [ -s "$HOME/.nvm/nvm.sh" ]; then export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" --no-use; nvm use --silent default >/dev/null 2>&1 || true; fi; fi; unset HRIG_RIG_PATH; ';
function rigCommand(connection, args) {
  return (
    NVM +
    core.quote(connection.rigBinary || "rig") +
    " " +
    args.map(core.quote).join(" ")
  );
}
async function runRig(connection, args, timeout = 25000, root, captureStderr = false) {
  core.validateConnection(connection);
  if (connection.kind === "local" && process.platform==='win32')
    throw new Error("Choose a WSL or SSH connection for OpenRig.");
  const t = core.transport(
    connection,
    "unset OPENRIG_SESSION_NAME RIGGED_SESSION_NAME; " +
      NVM +
      "exec python3 -c " +
      core.quote(
        "import os,json,sys\nr=json.load(sys.stdin)\na=r['args']\na[0]=os.path.expanduser(a[0])\nif r.get('root'): os.chdir(os.path.realpath(os.path.expanduser(r['root'])))\nfor i in range(len(a)-1):\n if a[i]=='--cwd': a[i+1]=os.path.realpath(os.path.expanduser(a[i+1]))\nos.execvp(a[0],a)",
      ),
  );
  return core.execute(t.file, t.args, {
    timeout,
    captureStderr,
    input: JSON.stringify({ args: [connection.rigBinary || "rig", ...args], root }),
  });
}
async function diagnose(connection) {
  core.validateConnection(connection);
  if (connection.kind === "local" && process.platform==='win32')
    return {
      checks: [
        {
          name: "Windows workspace",
          ok: true,
          detail: "Files, Git and PowerShell are available locally.",
        },
        {
          name: "OpenRig host",
          ok: false,
          detail: "Select WSL or SSH to connect to Linux OpenRig.",
        },
      ],
      healthy: false,
    };
  const source = `import os,sys,json,subprocess,shutil
out=[]
for name,args in [('Node.js',['node','--version']),('OpenRig',[${JSON.stringify(connection.rigBinary || "rig")},'--version']),('tmux',['tmux','-V']),('Python 3',['python3','--version'])]:
 exe=shutil.which(args[0])
 try:
  r=subprocess.run(args,capture_output=True,text=True,timeout=12)
  linux=not (exe or '').startswith('/mnt/')
  out.append({'name':name,'ok':r.returncode==0 and linux,'detail':(exe or 'Not found')+' — '+(r.stdout or r.stderr).strip()[:400]})
 except Exception as e: out.append({'name':name,'ok':False,'detail':str(e)[:400]})
print(json.dumps({'checks':out,'healthy':all(i['ok'] for i in out)}))`;
  const program =
    "import base64;exec(base64.b64decode(" +
    JSON.stringify(Buffer.from(source).toString("base64")) +
    "))";
  try {
    const report = core.parseJson(
      await core.remote(connection, NVM + `python3 -c ${core.quote(program)}`),
    );
    try {
      const inventory = core.normalizeInventory(
        core.parseJson(await runRig(connection, ["ps", "--json"])),
        [],
      );
      report.checks.push({
        name: "OpenRig daemon",
        ok: true,
        detail: `${inventory.rigs.length} rigs discovered`,
      });
    } catch (e) {
      report.checks.push({
        name: "OpenRig daemon",
        ok: false,
        detail: e.message,
      });
      report.healthy = false;
    }
    return report;
  } catch (e) {
    return {
      healthy: false,
      checks: [
        {
          name: "Connection / Python",
          ok: false,
          detail:
            e.message +
            "\nCheck SSH authentication, Python 3, and the connection target.",
        },
      ],
    };
  }
}
const EDIT_PY = `import os,sys,json,base64,hashlib,re,subprocess
a=json.load(sys.stdin)
if not isinstance(a.get('root'),str) or not a['root']: raise Exception('Invalid project path')
root=os.path.realpath(os.path.expanduser(a['root']))
target=os.path.realpath(os.path.join(root,a.get('path','')))
if os.path.commonpath([root,target])!=root: raise Exception('The file is outside the project folder')
op=a['op']
def read(p):
 if os.path.getsize(p)>2000000: raise Exception('File exceeds 2 MB')
 data=open(p,'rb').read()
 if b'\\0' in data: raise Exception('Binary files cannot be edited')
 return {'content':data.decode('utf-8'),'revision':hashlib.sha256(data).hexdigest()}
if op=='read':
 if not os.path.isdir(root): raise Exception('Project folder does not exist')
 if not os.path.isdir(os.path.dirname(target)): raise Exception('Parent folder does not exist')
 try: result=read(target)
 except FileNotFoundError:
  if a.get('allowMissing') is not True: raise
  result={'missing':True}
 print(json.dumps(result))
elif op=='inspect':
 size=os.path.getsize(target)
 if not os.path.isfile(target): raise Exception('Not a regular file.')
 with open(target,'rb') as f: head=f.read(8192)
 ext=target.lower().rsplit('.',1)[-1]
 mime=''
 if head.startswith(b'\\x89PNG\\r\\n\\x1a\\n'): mime='image/png'
 elif head.startswith(b'\\xff\\xd8\\xff'): mime='image/jpeg'
 elif head[:4]==b'GIF8' and head[4:5] in (b'7',b'9') and head[5:6]==b'a': mime='image/gif'
 elif head[:4]==b'RIFF' and head[8:12]==b'WEBP': mime='image/webp'
 elif head[:2]==b'BM' and ext=='bmp': mime='image/bmp'
 elif head[:4]==b'\\x00\\x00\\x01\\x00' and ext=='ico': mime='image/x-icon'
 def hexrows(b):
  out=[]
  for i in range(0,len(b),16):
   c=b[i:i+16];h=' '.join('%02x'%x for x in c);t=''.join(chr(x) if 32<=x<127 else '.' for x in c)
   out.append('%08x  %s  %s'%(i,h.ljust(47),t))
  return '\\n'.join(out)
 if mime and size<=4000000:
  with open(target,'rb') as f: data=f.read(4000000)
  print(json.dumps({'kind':'image','size':size,'mime':mime,'dataUrl':'data:'+mime+';base64,'+base64.b64encode(data).decode()}))
 elif mime: print(json.dumps({'kind':'binary','size':size,'mime':mime,'hex':hexrows(head[:512]),'note':'Image is too large to preview.'}))
 elif b'\\0' in head: print(json.dumps({'kind':'binary','size':size,'hex':hexrows(head[:512])}))
 elif size>2000000:
  with open(target,'rb') as f: raw=f.read(262144)
  text=raw.decode('utf-8','replace').rstrip('\\ufffd')
  cut=text.rfind('\\n')
  if cut>len(text)/2: text=text[:cut]
  print(json.dumps({'kind':'large-text','size':size,'text':text,'shownBytes':len(text.encode('utf-8'))}))
 else: print(json.dumps({'kind':'text','size':size}))
elif op=='save':
 current=read(target)
 if current['revision']!=a['revision']: raise Exception('CONFLICT: File changed on disk. Reload or compare before saving.')
 data=a['content'].encode('utf-8')
 with open(target,'wb') as f: f.write(data)
 print(json.dumps({'saved':True,'revision':hashlib.sha256(data).hexdigest()}))
elif op=='create':
 if not a.get('path'): raise Exception('Enter a filename')
 with open(target,'x',encoding='utf-8') as f: f.write(a.get('content',''))
 print(json.dumps({'created':True}))
elif op=='rename':
 dest=os.path.realpath(os.path.join(root,a['destination']))
 if os.path.commonpath([root,dest])!=root: raise Exception('Destination is outside the project folder')
 if os.path.exists(dest): raise Exception('Destination already exists')
 os.rename(target,dest);print(json.dumps({'renamed':True}))
elif op=='searchText':
 import time
 out=[];scanned=0;reason='';timed_out_files=[];timed_out_file_count=0;query=a.get('query','');o=a.get('options')
 if not query: raise Exception('Enter search text')
 low=query.lower();pattern=None;started=time.monotonic();budget=(o or {}).get('budgetMs');budget_per_file=(o or {}).get('budgetPerFileMs') or 0;budget_max=(o or {}).get('maxBudgetMs') or budget;cap=(o or {}).get('maxFiles') or 20000;file_ms=(o or {}).get('fileMs') or 2000
 if o is not None and (o.get('regex') or o.get('wholeWord')):
  src=query if o.get('regex') else re.escape(query)
  if o.get('wholeWord'): src=r'(?<!\\w)(?:'+src+r')(?!\\w)'
  try: pattern=re.compile(src,re.IGNORECASE)
  except re.error as e: raise Exception('Invalid regular expression: '+str(e)[:160])
 inc=(o or {}).get('include') or [];exc=(o or {}).get('exclude') or []
 import signal
 st={'late':False,'re':False,'file_deadline':None,'file_timed_out':False}
 class Budget(BaseException): pass
 class FileBudget(BaseException): pass
 def arm():
  if budget is None or not hasattr(signal,'setitimer'): return
  elapsed=(time.monotonic()-started)*1000
  remain=max(budget-elapsed,1)
  if st['re'] and st['file_deadline'] is not None:
   remain=min(remain,max((st['file_deadline']-time.monotonic())*1000,1))
  signal.setitimer(signal.ITIMER_REAL,remain/1000.0)
 def alarm(sig,frm):
  current=time.monotonic();elapsed=(current-started)*1000
  if st['re'] and st['file_deadline'] is not None and current>=st['file_deadline'] and elapsed<budget:
   st['file_timed_out']=True
   raise FileBudget()
  if elapsed>=budget:
   st['late']=True
   if st['re']: raise Budget()
  else: arm()
 if budget is not None and hasattr(signal,'setitimer'):
  signal.signal(signal.SIGALRM,alarm);arm()
 def spent(): return budget is not None and (st['late'] or (time.monotonic()-started)*1000>=budget)
 def nm(pat,name):
  p=n=0;star=-1;mark=0
  while n<len(name):
   if p<len(pat) and pat[p]=='*': star=p;p+=1;mark=n
   elif p<len(pat) and (pat[p]=='?' or pat[p]==name[n]): p+=1;n+=1
   elif star>=0: p=star+1;mark+=1;n=mark
   else: return False
  while p<len(pat) and pat[p]=='*': p+=1
  return p==len(pat)
 def pm(segs,parts):
  p=n=0;star=-1;mark=0
  while n<len(parts):
   if p<len(segs) and segs[p]=='**': star=p;p+=1;mark=n
   elif p<len(segs) and nm(segs[p],parts[n]): p+=1;n+=1
   elif star>=0: p=star+1;mark+=1;n=mark
   else: return False
  while p<len(segs) and segs[p]=='**': p+=1
  return p==len(segs)
 def gh(g,parts):
  if not g['a']: return any(nm(g['s'][0],x) for x in parts)
  return any(pm(g['s'],parts[:k]) for k in range(1,len(parts)+1))
 def allowed(rel):
  parts=rel.split('/')
  return (not inc or any(gh(g,parts) for g in inc)) and not any(gh(g,parts) for g in exc)
 def hit(text):
  if not pattern: return low in text.lower()
  st['re']=True
  st['file_deadline']=time.monotonic()+file_ms/1000.0
  try:
   arm()
   return bool(pattern.search(text[:1000]))
  except FileBudget: return False
  except Budget: return False
  finally:
   st['re']=False;st['file_deadline']=None
   if budget is not None and hasattr(signal,'setitimer'): arm()
 def emit(kind,**values):
  if (o or {}).get('streamProgress'): print(json.dumps({'event':kind,**values}),flush=True)
 def add_match(row): out.append(row);emit('match',match=row)
 for folder,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in ['.git','node_modules','dist','.venv','.next','release'] and not os.path.islink(os.path.join(folder,d))]
  for name in files:
   scanned+=1;p=os.path.join(folder,name)
   if budget is not None:
    budget=min(budget_max,budget+budget_per_file)
    if st['late'] and (time.monotonic()-started)*1000<budget: st['late']=False
    arm()
   if spent(): reason='time';break
   if os.path.islink(p): continue
   rel=os.path.relpath(p,root).replace(os.sep,'/')
   st['file_timed_out']=False
   try:
    content=read(p)['content'] if allowed(rel) else ''
    for line,text in enumerate(content.splitlines(),1):
     if spent(): reason='time';break
     if hit(text): add_match({'path':rel,'line':line,'text':text[:250]})
     if st['file_timed_out']: break
     if len(out)>=200: break
   except (OSError,UnicodeError,Exception): pass
   if st['file_timed_out']:
    timed_out_file_count+=1
    if len(timed_out_files)<20: timed_out_files.append(rel)
    emit('file-timeout',path=rel)
   if reason or len(out)>=200 or scanned>=cap: break
  if reason or len(out)>=200 or scanned>=cap: break
 if budget is not None and hasattr(signal,'setitimer'): signal.setitimer(signal.ITIMER_REAL,0)
 if st['late'] and not reason: reason='time'
 reason=reason or ('matches' if len(out)>=200 else 'files' if scanned>=cap else '')
 print(json.dumps(out if o is None else {'matches':out,'truncated':bool(reason or timed_out_file_count),'reason':reason,'scanned':scanned,'timedOutFiles':timed_out_files,'timedOutFileCount':timed_out_file_count}))
`;
function revision(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
async function edit(connection, a, hooks = {}) {
  if (!a || !["read", "inspect", "save", "create", "rename", "searchText"].includes(a.op))
    throw new Error("Unsupported editor operation.");
  if (typeof a.root !== "string" || typeof (a.path || "") !== "string")
    throw new Error("Invalid project path.");
  if (
    ["save", "create"].includes(a.op) &&
    (typeof a.content !== "string" ||
      Buffer.byteLength(a.content, "utf8") > 2000000)
  )
    throw new Error("Content must be text under 2 MB.");
  if (
    a.op === "searchText" &&
    (typeof a.query !== "string" || !a.query || a.query.length > 300)
  )
    throw new Error("Enter search text under 300 characters.");
  const search =
    a.op === "searchText"
      ? contentSearch.prepare(a, connection.kind !== "local", hooks)
      : null;
  if (connection.kind !== "local") {
    const request =
      search && !search.legacy
        ? {
            ...a,
            options: {
              ...search.options,
              ...(hooks.signal ? { streamProgress: true } : {}),
            },
          }
        : a;
    return python(connection, EDIT_PY, request, hooks.signal
      ? { signal: hooks.signal, returnOnAbort: true, timeout: contentSearch.LIMITS.MAX_BUDGET_MS + 30000 }
      : {});
  }
  const target = await core.localPath(
    a.root,
    a.path,
    ["create"].includes(a.op) || (a.op === "read" && a.allowMissing === true),
  );
  if (a.op === "inspect")
    return require("./file-inspect.cjs").inspectLocal(fs, target, a.path);
  if (a.op === "read") {
    let data;
    try {
      const stat = await fs.stat(target);
      if (stat.size > 2000000) throw new Error("File exceeds 2 MB");
      data = await fs.readFile(target);
    } catch (error) {
      if (a.allowMissing === true && error.code === "ENOENT")
        return { missing: true };
      throw error;
    }
    if (data.includes(0)) throw new Error("Binary files cannot be edited");
    return { content: data.toString("utf8"), revision: revision(data) };
  }
  if (a.op === "save") {
    const current = await fs.readFile(target);
    if (revision(current) !== a.revision)
      throw new Error(
        "CONFLICT: File changed on disk. Reload or compare before saving.",
      );
    await fs.writeFile(target, a.content);
    return { saved: true, revision: revision(a.content) };
  }
  if (a.op === "create") {
    await fs.writeFile(target, a.content, { flag: "wx" });
    return { created: true };
  }
  if (a.op === "rename") {
    if (typeof a.destination !== "string" || !a.destination)
      throw new Error("Enter a destination filename");
    const dest = await core.localPath(a.root, a.destination, true);
    try {
      await fs.access(dest);
      throw new Error("Destination already exists");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await fs.rename(target, dest);
    return { renamed: true };
  }
  if (a.op === "searchText") {
    const results = [];
    const budget = contentSearch.createBudget(
      hooks.now || Date.now,
      search.budgetMs,
      hooks.maxBudgetMs || contentSearch.LIMITS.MAX_BUDGET_MS,
    );
    const maxFiles = hooks.maxFiles || contentSearch.LIMITS.MAX_FILES;
    const budgetPerFile = hooks.budgetPerFileMs ?? contentSearch.LIMITS.BUDGET_PER_FILE_MS;
    let count = 0;
    let timedOut = false;
    let canceled = false;
    let timedOutFileCount = 0;
    const timedOutFiles = [];
    const isCanceled = () => Boolean(hooks.signal?.aborted);
    const addResult = (match) => {
      results.push(match);
      if (typeof hooks.onMatch === "function") hooks.onMatch(match);
    };
    const result = (reason) => ({
      matches: results,
      truncated: Boolean(reason || timedOutFileCount),
      reason,
      scanned: count,
      timedOutFiles,
      timedOutFileCount,
    });
    const noteTimedOutFile = (relative) => {
      timedOutFileCount++;
      if (timedOutFiles.length < 20) timedOutFiles.push(relative);
    };
    const scan = async (folder, depth = 0) => {
      if (depth > contentSearch.LIMITS.MAX_DEPTH || isCanceled()) return;
      for (const e of await fs
        .readdir(folder, { withFileTypes: true })
        .catch(() => [])) {
        if (isCanceled()) { canceled = true; return; }
        if (budget.expired()) {
          timedOut = true;
          return;
        }
        if (
          e.isSymbolicLink() ||
          [
            ".git",
            "node_modules",
            "dist",
            ".next",
            ".venv",
            "release",
          ].includes(e.name)
        )
          continue;
        const full = path.join(folder, e.name);
        if (e.isDirectory()) await scan(full, depth + 1);
        else {
          count++;
          budget.extend(budgetPerFile);
          const rel = path.relative(target, full).replaceAll("\\", "/");
          try {
            if (search.allows(rel) && (await fs.stat(full)).size <= 2000000) {
              if (isCanceled()) { canceled = true; return; }
              const data = await fs.readFile(full, { signal: hooks.signal });
              if (isCanceled()) { canceled = true; return; }
              if (!data.includes(0)) {
                const text = data.toString("utf8");
                const lines = text.split(/\r?\n/);
                if (search.scan) {
                  const hits = search.scan(
                    text,
                    200 - results.length,
                    Math.min(hooks.fileMs || contentSearch.LIMITS.FILE_MS, budget.remaining()),
                  );
                  if (hits === null) {
                    if (budget.expired()) timedOut = true;
                    else noteTimedOutFile(rel);
                  }
                  else
                    for (const i of hits)
                      addResult({
                        path: rel,
                        line: i + 1,
                        text: lines[i].slice(0, 250),
                      });
                } else
                  for (const [i, line] of lines.entries()) {
                    if (isCanceled()) { canceled = true; break; }
                    if (budget.expired()) {
                      timedOut = true;
                      break;
                    }
                    if (search.test(line))
                      addResult({
                        path: rel,
                        line: i + 1,
                        text: line.slice(0, 250),
                      });
                    if (results.length >= 200) break;
                  }
              }
            }
          } catch (error) {
            if (isCanceled() || error?.name === "AbortError") canceled = true;
          }
        }
        if (timedOut || canceled || count >= maxFiles || results.length >= 200) return;
      }
    };
    await scan(target);
    if (search.legacy) return results;
    const reason = canceled || isCanceled()
      ? "cancelled"
      : timedOut
      ? "time"
      : results.length >= 200
        ? "matches"
        : count >= maxFiles
          ? "files"
          : "";
    return result(reason);
  }
}
const relaunchSession = require("./session-relaunch.cjs").createSessionRelaunch({ inventory: c => core.inventory(c), runRig, parseJson: core.parseJson });
async function rigAction(connection, a) {
  if (["relaunchPlan", "relaunch"].includes(a.op)) return relaunchSession(connection, a);
  const text = (v) => {
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v.length > 50000 ||
      v.includes("\0")
    )
      throw new Error("Invalid or missing command value");
    return v;
  };
  const name = a.name ? text(a.name) : "";
  if (name.startsWith("-") || String(a.id || "").startsWith("-"))
    throw new Error("A rig name or task ID cannot start with a dash.");
  let args;
  switch (a.op) {
    case "agents":
      args = ["specs", "ls", "--kind", "agent", "--json"];
      break;
    case "delete": {
      if (!name || a.confirmation !== name)
        throw new Error("Type the rig name to confirm deletion.");
      const current = await core.inventory(connection);
      const rig = current.rigs.find((r) => r.id === a.id);
      if (!rig || rig.name !== name)
        throw new Error(
          "The rig changed or no longer exists. Refresh and select it again.",
        );
      args = ["down", text(a.id), "--delete", "--snapshot", "--json"];
      break;
    }
    case "specs":
      args = ["specs", "ls", "--kind", "rig", "--json"];
      break;
    case "specPreview":
      args = ["specs", "preview", text(a.name), "--kind", "rig", "--json"];
      break;
    case "plan":
      args = [
        "up",
        text(a.name),
        "--cwd",
        text(a.root),
        "--plan",
        "--json",
        ...(a.existing ? ["--existing"] : []),
      ];
      break;
    case "start":
      if (a.confirmation !== name)
        throw new Error("Type the rig name to confirm launch.");
      args = [
        "up",
        text(a.name),
        "--cwd",
        text(a.root),
        "--json",
        ...(a.existing ? ["--existing"] : []),
      ];
      break;
    case "stop":
      if (a.confirmation !== name)
        throw new Error("Type the rig name to confirm stopping its seats.");
      args = ["down", text(a.name), "--snapshot", "--json"];
      break;
    case "taskShow":
      args = ["queue", "show", text(a.id), "--full", "--json"];
      break;
    case "taskCreate":
      args = [
        "queue",
        "create",
        "--source",
        "hrig-desktop",
        "--destination",
        text(a.destination),
        "--summary",
        text(a.title),
        "--body",
        text(a.body),
        "--json",
      ];
      break;
    case "taskHandoff":
      args = [
        "queue",
        "handoff",
        text(a.id),
        "--to",
        text(a.destination),
        "--summary",
        text(a.title),
        "--json",
      ];
      break;
    default:
      throw new Error("Unsupported OpenRig action.");
  }
  // Verify the installed CLI advertises required flags before any mutation.
  if (["start", "stop", "delete", "taskCreate", "taskHandoff"].includes(a.op)) {
    const help = await runRig(connection, [
      args[0],
      ...(args[0] === "queue" ? [args[1]] : []),
      "--help",
    ]);
    for (const flag of args.filter((v) => v.startsWith("--")))
      if (!help.includes(flag))
        throw new Error(
          `Installed OpenRig does not advertise ${flag}. Update OpenRig or use its CLI.`,
        );
  }
  const output = await runRig(
    connection,
    args,
    ["start", "stop", "delete"].includes(a.op) ? 180000 : 30000,
  );
  if (a.op === "delete") {
    const result = core.parseJson(output);
    if (!result.deleted || result.deleteBlocked || result.errors?.length)
      throw new Error(
        "OpenRig did not fully delete the rig: " + JSON.stringify(result),
      );
    return result;
  }
  try {
    return core.parseJson(output);
  } catch {
    return { output };
  }
}
const designPreviews = new Map();
const designFiles = new Map();
async function designRig(connection, a) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(a.name || ""))
    throw new Error(
      "Use a lowercase rig name starting with a letter, up to 48 letters, digits or hyphens.",
    );
  if (typeof a.goal !== "string" || !a.goal.trim() || a.goal.length > 4000)
    throw new Error("Describe the goal in 1 to 4,000 characters.");
  if (a.yolo !== undefined && typeof a.yolo !== "boolean") throw new Error("YOLO selection must be a boolean.");
  if (!["preview", "launch"].includes(a.op))
    throw new Error("Unsupported design action.");
  if (!Array.isArray(a.seats) || !a.seats.length || a.seats.length > 6)
    throw new Error("Choose between one and six seats.");
  if (a.op === "launch" && a.confirmation !== a.name)
    throw new Error("Type the rig name to confirm launch.");
  const inventory = await core.inventory(connection);
  if (inventory.rigs.some((r) => r.name === a.name))
    throw new Error(
      "A rig with this name already exists. Choose another name to keep it intact.",
    );
  const catalog = await rigAction(connection, { op: "agents" });
  const agents = Array.isArray(catalog)
    ? catalog
    : catalog.entries || catalog.items || [];
  const ids = new Set();
  const members = a.seats.map((s) => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(s.id || "") || ids.has(s.id))
      throw new Error(
        "Seat IDs must be unique lowercase names, starting with a letter.",
      );
    ids.add(s.id);
    if (!["codex", "claude-code"].includes(s.runtime))
      throw new Error("Select a supported runtime.");
    const agent = agents.find((row) => row.id === s.agentId);
    const source = agent?.resolvedSourcePath || agent?.sourcePath;
    if (
      typeof source !== "string" ||
      !source.startsWith("/") ||
      source.includes("\0")
    )
      throw new Error("Select an installed agent for every seat.");
    return {
      id: s.id,
      agent_ref:
        "path:" +
        (/\/agent\.ya?ml$/.test(source) ? path.posix.dirname(source) : source),
      profile: "default",
      runtime: s.runtime,
      cwd: ".",
    };
  });
  await core.fileOperation(connection, { op: "list", root: a.root, path: "" });
  const spec = {
    version: "0.2",
    name: a.name,
    summary: a.goal.trim() + teamAssessment.handoffSummary(a.seats),
    ...(a.yolo === true ? { permission_policy: "builtin:yolo" } : {}),
    pods: [
      {
        id: "team",
        label: "Team",
        members,
        edges: members.slice(1).map((s) => ({
          kind: "collaborates_with",
          from: members[0].id,
          to: s.id,
        })),
      },
    ],
    edges: [],
  };
  const content = JSON.stringify(spec, null, 2) + "\n";
  const filename = "hrig-" + a.name + ".yaml";
  const key = JSON.stringify([connection, a.root, filename]);
  const previousPreview = designPreviews.get(a.previewToken);
  const owner = designFiles.get(key);
  const designId =
    typeof a.designId === "string" && /^[a-f0-9-]{36}$/.test(a.designId)
      ? a.designId
      : null;
  if (
    a.op === "launch" &&
    (!previousPreview ||
      previousPreview.key !== key ||
      previousPreview.content !== content)
  )
    throw new Error("Preview this exact design before launching.");
  // Exclusive creation keeps existing designs intact. Identical previews can be retried.
  try {
    await edit(connection, {
      op: "create",
      root: a.root,
      path: filename,
      content,
    });
  } catch (error) {
    const previous = await edit(connection, {
      op: "read",
      root: a.root,
      path: filename,
    }).catch(() => null);
    if (previous?.content !== content) {
      if (
        a.op !== "preview" ||
        !(
          (previousPreview?.key === key &&
            previousPreview.content === previous?.content) ||
          (designId &&
            owner?.id === designId &&
            owner.content === previous?.content)
        )
      )
        throw error;
      await edit(connection, {
        op: "save",
        root: a.root,
        path: filename,
        content,
        revision: previous.revision,
      });
    }
  }
  if (designId) {
    if (designFiles.size >= 100)
      designFiles.delete(designFiles.keys().next().value);
    designFiles.set(key, { id: designId, content });
  }
  const resolved = await python(
    connection,
    `import os,json,sys
a=json.load(sys.stdin)
print(json.dumps(os.path.join(os.path.realpath(os.path.expanduser(a['root'])),a['filename'])))`,
    { root: a.root, filename },
  );
  const args = [
    "up",
    resolved,
    "--cwd",
    a.root,
    "--json",
    ...(a.op === "preview" ? ["--plan"] : []),
    ...(a.yolo === true ? ["--non-interruptive"] : []),
  ];
  const help = await runRig(connection, ["up", "--help"]);
  for (const flag of args.filter((v) => v.startsWith("--")))
    if (!help.includes(flag))
      throw new Error("Installed OpenRig does not advertise " + flag);
  const result = core.parseJson(await runRig(connection, args, 180000));
  if (result.ok === false || result.error || result.errors?.length)
    throw new Error(
      "OpenRig could not accept this design: " + JSON.stringify(result),
    );
  if (a.previewToken) designPreviews.delete(a.previewToken);
  const previewToken = crypto.randomUUID();
  if (a.op === "preview") {
    if (designPreviews.size >= 100)
      designPreviews.delete(designPreviews.keys().next().value);
    designPreviews.set(previewToken, { key, content });
  }
  return { path: resolved, spec, result, previewToken };
}
async function ports(connection) {
  if (connection.kind === "local" && process.platform==='win32') {
    const output = await core.execute("netstat.exe", ["-ano", "-p", "tcp"]);
    return [
      ...new Set(
        output
          .split("\n")
          .filter((l) => l.includes("LISTENING"))
          .map((l) => Number(l.trim().split(/\s+/)[1]?.split(":").pop()))
          .filter((p) => p > 0),
      ),
    ]
      .sort((a, b) => a - b)
      .map((port) => ({ port }));
  }
  if(connection.kind==='local' && process.platform==='darwin') {
    const output=await core.execute('/usr/sbin/lsof',['-nP','-iTCP','-sTCP:LISTEN','-Fn'],{acceptExitCodes:[1]});
    return [...new Set(output.split('\n').filter(l=>l.startsWith('n')).map(l=>Number(l.match(/:(\d+)$/)?.[1])).filter(p=>p>0))].sort((a,b)=>a-b).map(port=>({port}));
  }
  return python(
    connection,
    `import subprocess,json,re
r=subprocess.run(['ss','-ltnH'],capture_output=True,text=True,check=True)
ports=set()
for line in r.stdout.splitlines():
 parts=line.split()
 if len(parts)>3:
  m=re.search(r':(\\d+)$',parts[3])
  if m: ports.add(int(m.group(1)))
print(json.dumps([{'port':p} for p in sorted(ports)]))`,
    {},
  );
}
// Only folders belonging to currently managed seats are exposed.
async function projects(connection) {
  if (connection.kind === "local" && process.platform==='win32') return [];
  const inventory = await core.inventory(connection);
  return python(
    connection,
    `import json,sys,subprocess,os
request=json.load(sys.stdin)
r=subprocess.run(['tmux','list-panes','-a','-F','#{session_name}\\t#{pane_current_path}'],capture_output=True,text=True)
if r.returncode:
 if 'no server running' in r.stderr or 'no sessions' in r.stderr or 'error connecting' in r.stderr:
  print('[]'); sys.exit(0)
 raise RuntimeError(r.stderr.strip() or 'Cannot read session folders')
seats={s['session']:s for s in request['seats'] if s.get('session')}
folders={}
for line in r.stdout.splitlines():
 session,sep,folder=line.partition('\\t')
 seat=seats.get(session)
 if not sep or not seat or not os.path.isdir(folder): continue
 folder=os.path.realpath(folder)
 row=folders.setdefault(folder,{'path':folder,'name':os.path.basename(folder) or folder,'rigs':[]})
 rig={'id':seat.get('rigId') or seat.get('rigName'),'name':seat.get('rigName') or seat.get('rigId')}
 if rig not in row['rigs']: row['rigs'].append(rig)
print(json.dumps(sorted(folders.values(),key=lambda row:row['path'])))`,
    inventory,
  );
}
module.exports = {
  assessTeam,
  designRig,
  projects,
  python,
  rigCommand,
  runRig,
  diagnose,
  edit,
  EDIT_PY,
  rigAction,
  ports,
};

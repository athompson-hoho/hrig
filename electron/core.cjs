const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { execFile } = require("node:child_process");

function quote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function validateConnection(value) {
  if (!value || !["local", "wsl", "ssh"].includes(value.kind))
    throw new Error("Choose a local, WSL, or SSH connection.");
  if (typeof value.id !== "string" || !value.id || value.id.length > 150)
    throw new Error("Invalid connection ID.");
  if (
    value.kind === "ssh" &&
    (typeof value.host !== "string" ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:[\]-]*$/.test(value.host))
  )
    throw new Error("Enter an SSH config alias or user@hostname.");
  if (
    value.kind === "wsl" &&
    (typeof value.distro !== "string" ||
      !value.distro ||
      /[\r\n\0]/.test(value.distro))
  )
    throw new Error("Choose a WSL distribution.");
  if (
    value.port &&
    (!Number.isInteger(Number(value.port)) ||
      Number(value.port) < 1 ||
      Number(value.port) > 65535)
  )
    throw new Error("SSH port must be between 1 and 65535.");
  if (
    value.rigBinary &&
    (typeof value.rigBinary !== "string" || /[\r\n\0]/.test(value.rigBinary))
  )
    throw new Error("Invalid OpenRig executable path.");
  return value;
}
function transport(connection, command, interactive = false) {
  validateConnection(connection);
  if (connection.kind === "local") {
    if (process.platform === "win32")
      return { file: process.env.ComSpec || "powershell.exe", args: [] };
    return { file: "/bin/bash", args: ["-lc", command] };
  }
  if (connection.kind === "wsl")
    return {
      file: "wsl.exe",
      args: ["-d", connection.distro, "--exec", "bash", "-lc", command],
    };
  const args = [
    "-o",
    "ConnectTimeout=12",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
  ];
  if (!interactive) args.push("-o", "BatchMode=yes");
  if (connection.port) args.push("-p", String(connection.port));
  if (interactive) args.push("-tt");
  args.push(connection.host, `bash -lc ${quote(command)}`);
  return { file: process.platform === "win32" ? "ssh.exe" : "ssh", args };
}
function execute(file, args, options = {}) {
  const { input, acceptExitCodes = [], captureStderr = false, exitResult = false, ...executionOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
        ...executionOptions,
      },
      (error, stdout, stderr) => {
        const raw = (
          stderr ||
          stdout ||
          error?.message ||
          "Command failed"
        ).trim();
        const message = raw.startsWith("Traceback")
          ? raw
              .split("\n")
              .filter((line) => line.length < 600)
              .slice(-10)
              .join("\n")
          : raw;
        if (exitResult && (!error || (Number.isInteger(error.code) && !error.killed && !error.signal)))
          resolve({ stdout, stderr, code: error ? error.code : 0 });
        else if (error && (!acceptExitCodes.includes(error.code) || stderr.trim()))
          reject(new Error(message.slice(-2500)));
        else resolve(captureStderr ? { stdout, stderr } : stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}
async function remote(connection, command, options = {}) {
  const { file, args } = transport(connection, command);
  return execute(file, args, options);
}
function parseJson(stdout) {
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const lines = clean.split("\n");
    for (let i = 0; i < lines.length; i++) {
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {}
    }
    throw new Error(
      "OpenRig returned an unrecognized response. Check the executable path and OpenRig version.",
    );
  }
}
function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["nodes", "rigs", "items", "data", "entries", "results"])
    if (Array.isArray(value?.[key])) return value[key];
  throw new Error(
    "Unsupported OpenRig JSON schema. Expected an array of rigs or seats.",
  );
}
function normalizeInventory(rigData, nodeData) {
  const rigs = rows(rigData).map((r) => ({
    id: r.rigId || r.id || r.name,
    name: r.rigName || r.name,
    status: r.status || "unknown",
    nodeCount: r.nodeCount ?? 0,
  }));
  const seats = rows(nodeData).map((n) => ({
    id: `${n.rigId || n.rigName}:${n.logicalId}`,
    rigId: n.rigId,
    rigName: n.rigName,
    name: n.logicalId,
    pod: n.podNamespace || n.podId || "",
    runtime: n.runtime || "agent",
    model: n.model || "",
    session: n.canonicalSessionName || null,
    status:
      n.needsAttention ||
      n.agentActivity?.state === "needs_input" ||
      ["failed", "attention_required"].includes(n.startupStatus)
        ? "attention"
        : n.sessionStatus === "running" ||
            n.sessionStatus === "attached" ||
            n.sessionStatus === "detached"
          ? n.agentActivity?.state === "running" || n.terminalActive === true
            ? "working"
            : n.agentActivity?.state === "idle" || n.terminalActive === false
              ? "idle"
              : "running"
          : n.sessionStatus || "unknown",
    activity: n.activityState?.display || n.agentActivity?.reason || "",
    error: n.latestError || "",
    workCount: n.assignedWorkCount || 0,
  }));
  return { rigs, seats, sampledAt: new Date().toISOString() };
}
async function inventory(connection) {
  validateConnection(connection);
  if (connection.kind === "local" && process.platform === "win32")
    throw new Error(
      "OpenRig runs in WSL or on an SSH host. Add a connection to discover rigs. Local mode supports files, Git, and PowerShell.",
    );
  const { runRig } = require("./features.cjs");
  const [rigs, nodes] = await Promise.all([
    runRig(connection, ["ps", "--json"]),
    runRig(connection, ["ps", "--nodes", "--all-rigs", "--json"]),
  ]);
  return normalizeInventory(parseJson(rigs), parseJson(nodes));
}
function sessionCommand(session) {
  if (
    typeof session !== "string" ||
    !session ||
    session.length > 500 ||
    /[\r\n\0]/.test(session)
  )
    throw new Error("Invalid terminal session.");
  // '=' requests an exact session match; attach never creates or restarts a seat.
  return `exec tmux attach-session -t ${quote("=" + session)}`;
}
function normalizeQueue(data, rigName) {
  return rows(data)
    .filter(
      (item) =>
        !rigName ||
        item.rigName === rigName ||
        [
          item.destinationSession,
          item.destination,
          item.sourceSession,
          item.source,
        ].some(
          (address) =>
            typeof address === "string" &&
            address.slice(address.indexOf("@") + 1) === rigName,
        ),
    )
    .map((item) => ({
      ...item,
      id: item.qitemId || item.id,
      title:
        item.subject ||
        item.summary ||
        item.bodyPreview ||
        item.title ||
        item.qitemId ||
        item.id ||
        "Task",
      status: item.state || item.status || "unknown",
      destination:
        item.destinationSession ||
        item.destination ||
        item.owner ||
        "Unassigned",
    }));
}
async function queue(connection, rigName) {
  validateConnection(connection);
  if (connection.kind === "local" && process.platform === "win32") return [];
  // queue list has no --rig flag. Read a bounded cross-rig window and filter
  // its canonical seat addresses without assuming the desktop is an agent.
  const data = parseJson(
    await require("./features.cjs").runRig(connection, [
      "queue",
      "list",
      "--all-rigs",
      "--json",
      "--limit",
      "1000",
    ]),
  );
  return normalizeQueue(data, rigName);
}
async function localPath(root, relative = "", allowMissing = false) {
  if (typeof root !== "string" || !root)
    throw new Error("Open a project folder first.");
  const base = await fs.realpath(root);
  const candidate = path.resolve(base, relative);
  let target;
  try {
    target = await fs.realpath(candidate);
  } catch (error) {
    if (!allowMissing || error.code !== "ENOENT") throw error;
    target = path.join(
      await fs.realpath(path.dirname(candidate)),
      path.basename(candidate),
    );
  }
  const rel = path.relative(base, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
    throw new Error("The file is outside the project folder.");
  return target;
}
async function readGitInfo(root) {
  const env = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
  const run = args => execute("git", ["-C", root, ...args], { env, exitResult: true });
  const fail = () => { throw new Error("Git information is unavailable."); };
  const text = r => r.stdout.replace(/\r?\n$/, "");
  const safe = s => typeof s === "string" && !!s && !/[\x00-\x1f\x7f]/.test(s);
  const validOid = s => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
  const inside = await run(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) {
    if (inside.code === 128 && /^fatal: not a git repository(?:\s|\()/i.test(inside.stderr.trim())) return { state: "not-repository", root };
    return fail();
  }
  if (text(inside) === "false") return { state: "not-repository", root };
  if (text(inside) !== "true") return fail();
  const resolve = ref => run(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  const identity = async () => {
    const symbolic = await run(["symbolic-ref", "--quiet", "HEAD"]);
    if (![0, 1].includes(symbolic.code) || (symbolic.code === 1 && (symbolic.stdout || symbolic.stderr))) return fail();
    const ref = symbolic.code === 0 ? text(symbolic) : null;
    if (ref !== null && (!safe(ref) || !ref.startsWith("refs/heads/") || ref === "refs/heads/")) return fail();
    const head = await resolve("HEAD");
    if (head.code !== 0) {
      if (!ref || head.code !== 1) return fail();
      const exists = await run(["show-ref", "--exists", ref]);
      if (exists.code !== 2) return fail();
      return { head: "unborn", branch: ref.slice(11), comparison: "none" };
    }
    const oid = text(head);
    if (!validOid(oid)) return fail();
    if (!ref) return { head: "detached", oid, comparison: "none" };
    const mapping = await run(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(upstream)", ref]);
    if (mapping.code !== 0) return fail();
    const rows = mapping.stdout.replace(/\r?\n$/, "").split("\n").map(row => row.split("\0")).filter(row => row[0] === ref);
    if (rows.length !== 1 || rows[0].length !== 3 || rows[0][1] !== oid) return fail();
    const upstream = rows[0][2];
    if (upstream && (!safe(upstream) || !upstream.startsWith("refs/"))) return fail();
    let upstreamOid;
    if (upstream) {
      const result = await resolve(upstream);
      if (result.code === 0) { upstreamOid = text(result); if (!validOid(upstreamOid)) return fail(); }
      else if (result.code !== 1) return fail();
    }
    return { head: "attached", branch: ref.slice(11), oid, comparison: upstream ? "unknown" : "none", ...(upstream ? { upstream } : {}), ...(upstreamOid ? { upstreamOid } : {}) };
  };
  const before = await identity();
  const result = { state: "repository", root, ...before };
  delete result.upstreamOid;
  if (before.upstreamOid) {
    const count = await run(["rev-list", "--left-right", "--count", `${before.oid}...${before.upstreamOid}`]);
    if (count.code === 0) {
      const match = /^(\d+)\s+(\d+)\r?\n?$/.exec(count.stdout);
      if (!match) return fail();
      const ahead = Number(match[1]), behind = Number(match[2]);
      if (![ahead, behind].every(Number.isSafeInteger)) return fail();
      Object.assign(result, { comparison: "known", ahead, behind });
    }
  }
  if (JSON.stringify(before) !== JSON.stringify(await identity())) return fail();
  return result;
}
const PYTHON_FILES = `import os,sys,json,base64,subprocess
a=json.load(sys.stdin)
root=os.path.realpath(os.path.expanduser(a['root']))
target=os.path.realpath(os.path.join(root,a.get('path','')))
if os.path.commonpath([root,target])!=root: raise Exception('The file is outside the project folder')
op=a['op']
def git_run(args):
 try: return subprocess.run(['git','-C',root]+args,capture_output=True,env=dict(os.environ,LC_ALL='C',**({'GIT_OPTIONAL_LOCKS':'0'} if op in ['git','gitInfo'] else {})))
 except FileNotFoundError:
  print('Git is not installed on this machine. Install Git on the project host.',file=sys.stderr);sys.exit(1)
def git_fail(result):
 detail=result.stderr.decode('utf-8',errors='replace').strip() or 'Git command failed'
 print('Git: '+detail,file=sys.stderr);sys.exit(1)
if op=='list':
 out=[]
 for e in os.scandir(target):
  if e.name in ['.git','node_modules','.next','dist','.venv']: continue
  if e.is_symlink(): continue
  out.append({'name':e.name,'path':os.path.relpath(e.path,root).replace(os.sep,'/'),'directory':e.is_dir()})
 print(json.dumps(sorted(out,key=lambda e:(not e['directory'],e['name'].lower()))[:600]))
elif op=='read':
 if os.path.getsize(target)>2000000: raise Exception('File is larger than 2 MB')
 with open(target,encoding='utf-8') as f: content=f.read()
 if '\\0' in content: raise Exception('Binary files cannot be edited')
 print(json.dumps({'content':content}))
elif op=='write':
 with open(target,'w',encoding='utf-8') as f: f.write(a['content'])
 print(json.dumps({'saved':True}))
elif op=='gitInfo':
 import re
 def fail(): raise Exception('Git information is unavailable.')
 def text(r): return re.sub(r'\\r?\\n$','',r.stdout.decode('utf-8'))
 def safe(s): return bool(s) and not re.search(r'[\\x00-\\x1f\\x7f]',s)
 def valid_oid(s): return re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})',s) is not None
 def resolve(ref): return git_run(['rev-parse','--verify','--quiet','--end-of-options',ref+'^{commit}'])
 def identity():
  symbolic=git_run(['symbolic-ref','--quiet','HEAD'])
  if symbolic.returncode not in [0,1] or (symbolic.returncode==1 and (symbolic.stdout or symbolic.stderr)): fail()
  ref=text(symbolic) if symbolic.returncode==0 else None
  if ref is not None and (not safe(ref) or not ref.startswith('refs/heads/') or ref=='refs/heads/'): fail()
  head=resolve('HEAD')
  if head.returncode!=0:
   if not ref or head.returncode!=1: fail()
   if git_run(['show-ref','--exists',ref]).returncode!=2: fail()
   return dict(head='unborn',branch=ref[11:],comparison='none')
  oid=text(head)
  if not valid_oid(oid): fail()
  if not ref: return dict(head='detached',oid=oid,comparison='none')
  mapping=git_run(['for-each-ref','--format=%(refname)%00%(objectname)%00%(upstream)',ref])
  if mapping.returncode!=0: fail()
  rows=[row.split('\\0') for row in text(mapping).split('\\n') if row.split('\\0')[0]==ref]
  if len(rows)!=1 or len(rows[0])!=3 or rows[0][1]!=oid: fail()
  upstream=rows[0][2]
  if upstream and (not safe(upstream) or not upstream.startswith('refs/')): fail()
  out=dict(head='attached',branch=ref[11:],oid=oid,comparison='unknown' if upstream else 'none')
  if upstream:
   out['upstream']=upstream
   resolved=resolve(upstream)
   if resolved.returncode==0:
    upstream_oid=text(resolved)
    if not valid_oid(upstream_oid): fail()
    out['upstreamOid']=upstream_oid
   elif resolved.returncode!=1: fail()
  return out
 inside=git_run(['rev-parse','--is-inside-work-tree'])
 if inside.returncode!=0:
  if inside.returncode==128 and re.match(rb'^fatal: not a git repository(?:\\s|\\()',inside.stderr.strip(),re.I): print(json.dumps(dict(state='not-repository',root=root)));sys.exit(0)
  fail()
 if text(inside)=='false': print(json.dumps(dict(state='not-repository',root=root)));sys.exit(0)
 if text(inside)!='true': fail()
 before=identity()
 out=dict(state='repository',root=root,**before)
 out.pop('upstreamOid',None)
 if 'upstreamOid' in before:
  counts=git_run(['rev-list','--left-right','--count',before['oid']+'...'+before['upstreamOid']])
  if counts.returncode==0:
   match=re.fullmatch(rb'(\\d+)\\s+(\\d+)\\r?\\n?',counts.stdout)
   if not match: fail()
   ahead,behind=map(int,match.groups())
   if ahead>9007199254740991 or behind>9007199254740991: fail()
   out.update(comparison='known',ahead=ahead,behind=behind)
 if before!=identity(): fail()
 print(json.dumps(out))
elif op=='git':
 r=git_run(['rev-parse','--is-inside-work-tree'])
 if r.returncode!=0:
  if b'not a git repository' in r.stderr.lower(): print(json.dumps({'raw':'','isRepository':False,'root':root}));sys.exit(0)
  git_fail(r)
 if r.stdout.strip()!=b'true': print(json.dumps({'raw':'','isRepository':False,'root':root}));sys.exit(0)
 p=git_run(['rev-parse','--show-prefix'])
 if p.returncode!=0: git_fail(p)
 prefix=p.stdout.decode('utf-8')
 prefix=prefix[:-2] if prefix.endswith('\\r\\n') else prefix[:-1] if prefix.endswith('\\n') else prefix
 r=git_run(['status','--porcelain=v1','-z','--untracked-files=normal'])
 if r.returncode!=0: git_fail(r)
 print(json.dumps({'raw':r.stdout.decode('utf-8'),'isRepository':True,'root':root,'projectPrefix':prefix}))
elif op=='diff':
 r=git_run(['diff','--no-ext-diff','HEAD','--',a['path']])
 if r.returncode!=0: git_fail(r)
 print(json.dumps({'diff':r.stdout.decode('utf-8')}))
elif op=='original':
 r=subprocess.run(['git','-C',root,'show','HEAD:'+a['path']],capture_output=True)
 print(json.dumps({'content':r.stdout.decode('utf-8') if r.returncode==0 else ''}))
elif op=='search':
 out=[]
 scanned=0
 query=a.get('query','').lower()
 for folder,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in ['.git','node_modules','.next','dist','.venv','release'] and not os.path.islink(os.path.join(folder,d))]
  for name in files:
   scanned+=1
   full=os.path.join(folder,name)
   rel=os.path.relpath(full,root).replace(os.sep,'/')
   if query in rel.lower() and not os.path.islink(full): out.append({'name':name,'path':rel,'directory':False})
   if scanned>=20000 or len(out)>=100: break
  if scanned>=20000 or len(out)>=100: break
 print(json.dumps(out))
`;
async function fileOperation(connection, request) {
  validateConnection(connection);
  if (request.op === "quickOpen") return require("./navigation.cjs").quickOpen(connection, request, {remote, quote, parseJson, localPath});
  if (
    !["list", "read", "write", "git", "gitInfo", "diff", "original", "search"].includes(
      request.op,
    )
  )
    throw new Error("Unsupported file operation.");
  if (
    request.op === "search" &&
    (typeof request.query !== "string" || request.query.length > 300)
  )
    throw new Error("Invalid file search.");
  if (
    typeof request.root !== "string" ||
    typeof (request.path ?? "") !== "string"
  )
    throw new Error("Invalid project path.");
  if (
    request.op === "write" &&
    (typeof request.content !== "string" ||
      Buffer.byteLength(request.content, "utf8") > 2000000)
  )
    throw new Error("File content must be text under 2 MB.");
  if (connection.kind !== "local") {
    return parseJson(
      await remote(connection, `python3 -c ${quote(PYTHON_FILES)}`, {
        input: JSON.stringify(request),
      }),
    );
  }
  const target = await localPath(
    request.root,
    request.path,
    ["original", "diff"].includes(request.op),
  );
  if (request.op === "gitInfo") return readGitInfo(target);
  if (request.op === "search") {
    const results = [];
    let scanned = 0;
    const scan = async (folder, depth = 0) => {
      if (depth > 25 || scanned >= 20000 || results.length >= 100) return;
      const entries = await fs
        .readdir(folder, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          [
            ".git",
            "node_modules",
            ".next",
            "dist",
            ".venv",
            "release",
          ].includes(entry.name)
        )
          continue;
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await scan(full, depth + 1);
        else {
          scanned++;
          const nativeRelative = path.relative(target, full);
          const relative = process.platform === "win32" ? nativeRelative.replaceAll("\\", "/") : nativeRelative;
          if (relative.toLowerCase().includes(request.query.toLowerCase()))
            results.push({
              name: entry.name,
              path: relative,
              directory: false,
            });
        }
        if (scanned >= 20000 || results.length >= 100) break;
      }
    };
    await scan(target);
    return results;
  }
  if (request.op === "list") {
    const entries = await fs.readdir(target, { withFileTypes: true });
    const canonicalRoot = await fs.realpath(request.root);
    return entries
      .filter(
        (e) =>
          !e.isSymbolicLink() &&
          ![".git", "node_modules", "dist", ".venv", ".next"].includes(e.name),
      )
      .map((e) => ({
        name: e.name,
        path: process.platform === "win32"
          ? path.relative(canonicalRoot, path.join(target, e.name)).replaceAll("\\", "/")
          : path.relative(canonicalRoot, path.join(target, e.name)),
        directory: e.isDirectory(),
      }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 600);
  }
  if (request.op === "read") {
    if ((await fs.stat(target)).size > 2000000)
      throw new Error("File is larger than 2 MB.");
    const content = await fs.readFile(target, "utf8");
    if (content.includes("\0"))
      throw new Error("Binary files cannot be edited.");
    return { content };
  }
  if (request.op === "write") {
    await fs.writeFile(target, request.content, "utf8");
    return { saved: true };
  }
  if (request.op === "git") {
    const env = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
    let inside;
    try {
      inside = await execute(
        "git",
        ["-C", target, "rev-parse", "--is-inside-work-tree"],
        { env },
      );
    } catch (error) {
      if (/not a git repository/i.test(error.message))
        return { raw: "", isRepository: false, root: target };
      throw error;
    }
    if (inside.trim() !== "true")
      return { raw: "", isRepository: false, root: target };
    return {
      isRepository: true,
      root: target,
      projectPrefix: (await execute("git", ["-C", target, "rev-parse", "--show-prefix"], { env })).replace(/\r?\n$/, ""),
      raw: await execute(
        "git",
        [
          "-C",
          target,
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=normal",
        ],
        { env },
      ),
    };
  }
  if (request.op === "diff")
    return {
      diff: await execute("git", [
        "-C",
        request.root,
        "diff",
        "--no-ext-diff",
        "HEAD",
        "--",
        request.path,
      ]),
    };
  if (request.op === "original") {
    try {
      return {
        content: await execute("git", [
          "-C",
          request.root,
          "show",
          `HEAD:${request.path}`,
        ]),
      };
    } catch {
      return { content: "" };
    }
  }
}
function countedGitStatus(raw) {
  if (typeof raw !== "string" || (raw && !raw.endsWith("\0"))) throw new Error("Malformed Git status.");
  if (!raw) return { entries: [], omittedPaths: 0 };
  const fields = raw.split("\0");
  fields.pop();
  const entries = [];
  let omittedPaths = 0;
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (!/^(?:[ MADRCT]{2}|DD|AU|UD|UA|DU|AA|UU|\?\?)$/.test(status) || status === "  " || entry[2] !== " " || !file)
      { omittedPaths++; continue; }
    if (/[RC]/.test(status) && !fields[++i]) { omittedPaths++; continue; }
    entries.push({ path: file, status: status.trim() });
  }
  return { entries, omittedPaths };
}
function parseGitStatus(raw) {
  return countedGitStatus(raw).entries;
}
async function gitStatus(connection, root) {
  const result = await fileOperation(connection, { op: "git", root, path: "" });
  if (!result || typeof result.isRepository !== "boolean" || typeof result.root !== "string" || !result.root)
    throw new Error("Malformed Git status.");
  if (result.isRepository) {
    const prefix = result.projectPrefix;
    if (typeof prefix !== "string" || (prefix && (!prefix.endsWith("/") ||
      prefix.includes("\0") || prefix.slice(0, -1).split("/").some(part => !part || part === "." || part === ".."))))
      throw new Error("Malformed Git status.");
  }
  const { entries, omittedPaths } = countedGitStatus(result.raw);
  return {
    isRepository: result.isRepository !== false,
    root: result.root || root,
    ...(result.isRepository !== false ? { projectPrefix: result.projectPrefix } : {}),
    entries,
    ...(omittedPaths ? { omittedPaths } : {}),
  };
}
async function detectConnections() {
  const found = [
    {
      id: "local",
      name: "This computer",
      kind: "local",
      root: process.platform === "win32" ? process.cwd() : os.homedir(),
    },
  ];
  if (process.platform === "win32")
    try {
      const data = await execute("wsl.exe", ["--list", "--quiet"], {
        encoding: "utf16le",
        timeout: 8000,
      });
      for (const distro of data
        .replace(/\0/g, "")
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("docker-")))
        found.push({
          id: `wsl-${distro}`,
          name: distro,
          kind: "wsl",
          distro,
          root: "~",
        });
    } catch {}
  try {
    const data = await fs.readFile(
      path.join(os.homedir(), ".ssh", "config"),
      "utf8",
    );
    for (const line of data.split("\n")) {
      const match = line.match(/^\s*Host\s+(.+?)\s*$/i);
      if (!match) continue;
      for (const host of match[1]
        .split(/\s+/)
        .filter((h) => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(h)))
        found.push({
          id: `ssh-${host}`,
          name: host,
          kind: "ssh",
          host,
          root: "~",
        });
    }
  } catch {}
  return found;
}
module.exports = {
  gitStatus,
  queue,
  normalizeQueue,
  quote,
  validateConnection,
  transport,
  execute,
  remote,
  parseJson,
  rows,
  normalizeInventory,
  inventory,
  sessionCommand,
  localPath,
  fileOperation,
  parseGitStatus,
  detectConnections,
};

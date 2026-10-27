const core = require("./core.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

// Program source is encoded; request payloads travel on stdin, not command lines.
async function python(connection, source, request) {
  const program =
    "import base64;exec(base64.b64decode(" +
    JSON.stringify(Buffer.from(source).toString("base64")) +
    "))";
  return core.parseJson(
    await core.remote(connection, `python3 -c ${core.quote(program)}`, {
      input: JSON.stringify(request),
    }),
  );
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
async function runRig(connection, args, timeout = 25000) {
  core.validateConnection(connection);
  if (connection.kind === "local")
    throw new Error("Choose a WSL or SSH connection for OpenRig.");
  const t = core.transport(
    connection,
    "unset OPENRIG_SESSION_NAME RIGGED_SESSION_NAME; " +
      NVM +
      "exec python3 -c " +
      core.quote(
        "import os,json,sys\na=json.load(sys.stdin)\na[0]=os.path.expanduser(a[0])\nfor i in range(len(a)-1):\n if a[i]=='--cwd': a[i+1]=os.path.realpath(os.path.expanduser(a[i+1]))\nos.execvp(a[0],a)",
      ),
  );
  return core.execute(t.file, t.args, {
    timeout,
    input: JSON.stringify([connection.rigBinary || "rig", ...args]),
  });
}
async function diagnose(connection) {
  core.validateConnection(connection);
  if (connection.kind === "local")
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
a=json.load(sys.stdin);root=os.path.realpath(os.path.expanduser(a['root']))
target=os.path.realpath(os.path.join(root,a.get('path','')))
if os.path.commonpath([root,target])!=root: raise Exception('The file is outside the project folder')
op=a['op']
def read(p):
 if os.path.getsize(p)>2000000: raise Exception('File exceeds 2 MB')
 data=open(p,'rb').read()
 if b'\\0' in data: raise Exception('Binary files cannot be edited')
 return {'content':data.decode('utf-8'),'revision':hashlib.sha256(data).hexdigest()}
if op=='read': print(json.dumps(read(target)))
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
 out=[];scanned=0;query=a.get('query','').lower()
 if not query: raise Exception('Enter search text')
 for folder,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in ['.git','node_modules','dist','.venv','.next','release'] and not os.path.islink(os.path.join(folder,d))]
  for name in files:
   scanned+=1;p=os.path.join(folder,name)
   if os.path.islink(p): continue
   try:
    content=read(p)['content']
    for line,text in enumerate(content.splitlines(),1):
     if query in text.lower(): out.append({'path':os.path.relpath(p,root).replace(os.sep,'/'),'line':line,'text':text[:250]})
     if len(out)>=200: break
   except (OSError,UnicodeError,Exception): pass
   if len(out)>=200 or scanned>=20000: break
  if len(out)>=200 or scanned>=20000: break
 print(json.dumps(out))
`;
function revision(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
async function edit(connection, a) {
  if (!a || !["read", "save", "create", "rename", "searchText"].includes(a.op))
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
  if (connection.kind !== "local") return python(connection, EDIT_PY, a);
  const target = await core.localPath(
    a.root,
    a.path,
    ["create"].includes(a.op),
  );
  if (a.op === "read") {
    const stat = await fs.stat(target);
    if (stat.size > 2000000) throw new Error("File exceeds 2 MB");
    const data = await fs.readFile(target);
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
    let count = 0;
    const scan = async (folder, depth = 0) => {
      if (depth > 25) return;
      for (const e of await fs
        .readdir(folder, { withFileTypes: true })
        .catch(() => [])) {
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
          try {
            if ((await fs.stat(full)).size <= 2000000) {
              const data = await fs.readFile(full);
              if (!data.includes(0))
                for (const [i, line] of data
                  .toString("utf8")
                  .split(/\r?\n/)
                  .entries()) {
                  if (line.toLowerCase().includes(a.query.toLowerCase()))
                    results.push({
                      path: path.relative(target, full).replaceAll("\\", "/"),
                      line: i + 1,
                      text: line.slice(0, 250),
                    });
                  if (results.length >= 200) break;
                }
            }
          } catch {}
        }
        if (count >= 20000 || results.length >= 200) return;
      }
    };
    await scan(target);
    return results;
  }
}
async function rigAction(connection, a) {
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
  if (["start", "stop", "taskCreate", "taskHandoff"].includes(a.op)) {
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
    ["start", "stop"].includes(a.op) ? 180000 : 30000,
  );
  try {
    return core.parseJson(output);
  } catch {
    return { output };
  }
}
async function ports(connection) {
  if (connection.kind === "local") {
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
module.exports = {
  python,
  rigCommand,
  runRig,
  diagnose,
  edit,
  rigAction,
  ports,
};

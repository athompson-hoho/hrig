const { spawn, execFile } = require("node:child_process");
function safePlan(value) {
  if (typeof value !== "string") return null;
  const known = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    prostandard: "Pro",
    promax: "Pro Max",
    max: "Max",
    max5x: "Max 5x",
    max20x: "Max 20x",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Education",
    education: "Education",
    apikey: "API key",
  };
  return known[value.toLowerCase().replace(/[\s_-]+/g, "")] || null;
}
function codexPlan({
  spawnProcess = spawn,
  execFileProcess = execFile,
  platform = process.platform,
  timeout = 4500,
} = {}) {
  return new Promise((resolve) => {
    let done = false,
      buffer = "";
    const windows = platform === "win32";
    const child = spawnProcess(
      windows ? process.env.ComSpec || "cmd.exe" : "codex",
      windows ? ["/d", "/s", "/c", "codex app-server"] : ["app-server"],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    const timer = setTimeout(() => finish(null), timeout);
    function finish(plan) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.destroy();
      if (windows && child.pid)
        execFileProcess(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          () => {},
        );
      else child.kill();
      resolve(safePlan(plan));
    }
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 131072) return finish(null);
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        let message;
        try {
          message = JSON.parse(buffer.slice(0, end));
        } catch {}
        buffer = buffer.slice(end + 1);
        if (message?.id === 1) {
          if (message.error) return finish(null);
          child.stdin.write(
            JSON.stringify({ method: "initialized", params: {} }) +
              "\n" +
              JSON.stringify({
                method: "account/read",
                params: { refreshToken: false },
                id: 2,
              }) +
              "\n",
          );
        } else if (message?.id === 2)
          return finish(
            message.result?.account?.planType || message.result?.account?.type,
          );
      }
    });
    child.stdin.write(
      JSON.stringify({
        method: "initialize",
        params: { clientInfo: { name: "hrig", version: "0.13.0" } },
        id: 1,
      }) + "\n",
    );
  });
}
const PYTHON_CODEX_PLAN = `
def codex_plan():
 import threading,queue,time
 p=None
 try:
  p=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True)
  rows=queue.Queue();deadline=time.monotonic()+4.5
  def read():
   for line in p.stdout:
    if len(line)>131072: break
    try: rows.put(json.loads(line))
    except ValueError: pass
  threading.Thread(target=read,daemon=True).start()
  def send(value): p.stdin.write(json.dumps(value)+'\\n');p.stdin.flush()
  send({'method':'initialize','params':{'clientInfo':{'name':'hrig','version':'0.13.0'}},'id':1})
  while time.monotonic()<deadline:
   row=rows.get(timeout=max(0.01,deadline-time.monotonic()))
   if row.get('id')==1:
    if row.get('error'): return None
    send({'method':'initialized','params':{}});send({'method':'account/read','params':{'refreshToken':False},'id':2})
   elif row.get('id')==2:
    account=(row.get('result') or {}).get('account') or {}
    return account.get('planType') or account.get('type')
 except Exception: return None
 finally:
  if p:
   try: os.killpg(p.pid,signal.SIGKILL)
   except OSError: pass
   p.wait()
`;
module.exports = { codexPlan, safePlan, PYTHON_CODEX_PLAN };

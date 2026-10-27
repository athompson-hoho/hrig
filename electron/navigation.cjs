const fs = require("node:fs/promises");
const path = require("node:path");
const EXCLUDED = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "dist-mobile",
  ".venv",
  "release",
]);

async function scanProject(
  root,
  query,
  { budget = 20000, maxDepth = 25, maxResults = 100 } = {},
) {
  root = await fs.realpath(root);
  const { fuzzyScore } = await import("./fuzzy.mjs");
  if (!(await fs.stat(root)).isDirectory())
    throw Error("Choose a project folder, not a file.");
  let entries = 0,
    files = 0,
    partial = false,
    matches = 0;
  const best = [];
  const order = (a, b) =>
    b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  async function walk(folder, depth) {
    if (depth > maxDepth) {
      partial = true;
      return;
    }
    const canonical = await fs.realpath(folder).catch(() => null);
    const relative = canonical && path.relative(root, canonical);
    if (
      !canonical ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    ) {
      partial = true;
      return;
    }
    let children;
    try {
      children = await fs.readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (depth === 0) throw error;
      partial = true;
      return;
    }
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      if (child.isSymbolicLink() || EXCLUDED.has(child.name)) continue;
      if (entries >= budget) {
        partial = true;
        return;
      }
      entries++;
      const full = path.join(folder, child.name);
      if (child.isDirectory()) await walk(full, depth + 1);
      else if (child.isFile()) {
        files++;
        const relative = path.relative(root, full).replaceAll("\\", "/");
        const score = fuzzyScore(relative, query);
        if (score !== null) {
          matches++;
          best.push({
            name: child.name,
            path: relative,
            directory: false,
            score,
          });
          best.sort(order);
          if (best.length > maxResults) best.pop();
        }
      }
      if (entries >= budget) {
        partial = true;
        return;
      }
    }
  }
  await walk(root, 0);
  return {
    files: best,
    matches,
    scannedFiles: files,
    scannedEntries: entries,
    partial,
    limited: matches > maxResults,
  };
}

// Keep ranking equivalent to fuzzy.mjs; parity is checked against a real Python scan.
const PYTHON_QUICK_OPEN = `import os,sys,json
sys.stdin.reconfigure(encoding="utf-8")
a=json.load(sys.stdin)
root=os.path.realpath(os.path.expanduser(a['root']))
if not os.path.isdir(root): raise Exception('Choose a project folder, not a file.')
with os.scandir(root): pass
needle=''.join(c for c in a['query'].strip().replace('\\\\','/').lower() if not c.isspace())
excluded={'.git','node_modules','.next','dist','dist-mobile','.venv','release'}
budget=a.get('budget',20000);max_depth=a.get('maxDepth',25);max_results=a.get('maxResults',100)
entries=0;files=0;partial=False;matches=0;best=[]
def score(value):
 text=value.replace('\\\\','/').lower()
 if not needle: return 0
 previous=-1;total=0
 for char in needle:
  index=text.find(char,previous+1)
  if index<0: return None
  total+=10
  if index==previous+1: total+=12
  if index==0 or text[index-1] in '/_- .': total+=18
  total-=min(50,index-previous-1)
  previous=index
 if needle in text: total+=120
 if text.rsplit('/',1)[-1].startswith(needle): total+=150
 return total-min(100,len(text)/6)
def walk(folder,depth):
 global entries,files,partial,matches,best
 if depth>max_depth: partial=True;return
 if os.path.commonpath([root,os.path.realpath(folder)])!=root: partial=True;return
 try:
  with os.scandir(folder) as scan: children=sorted(scan,key=lambda e:e.name)
 except OSError:
  if depth==0: raise
  partial=True;return
 for child in children:
  if child.is_symlink() or child.name in excluded: continue
  if entries>=budget: partial=True;return
  entries+=1
  if child.is_dir(follow_symlinks=False): walk(child.path,depth+1)
  elif child.is_file(follow_symlinks=False):
   files+=1
   relative=os.path.relpath(child.path,root).replace(os.sep,'/')
   value=score(relative)
   if value is not None:
    matches+=1;best.append({'name':child.name,'path':relative,'directory':False,'score':value})
    best.sort(key=lambda e:(-e['score'],e['path']));best=best[:max_results]
  if entries>=budget: partial=True;return
walk(root,0)
print(json.dumps({'files':best,'matches':matches,'scannedFiles':files,'scannedEntries':entries,'partial':partial,'limited':matches>max_results}))
`;
async function quickOpen(
  connection,
  request,
  { remote, quote, parseJson, localPath },
) {
  if (
    typeof request.root !== "string" ||
    !request.root ||
    request.root.length > 4096 ||
    request.root.includes("\0")
  )
    throw Error("Invalid project folder.");
  if (
    typeof request.query !== "string" ||
    request.query.length > 300 ||
    request.query.includes("\0")
  )
    throw Error("Quick Open search must be text under 300 characters.");
  if (connection.kind === "local")
    return scanProject(await localPath(request.root, ""), request.query);
  return parseJson(
    await remote(connection, `python3 -c ${quote(PYTHON_QUICK_OPEN)}`, {
      input: JSON.stringify({ root: request.root, query: request.query }),
    }),
  );
}
module.exports = { scanProject, quickOpen, PYTHON_QUICK_OPEN };

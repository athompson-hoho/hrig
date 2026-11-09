// The actual-core inert fixture is also consumed by the real UI integration tests.
// Importing it must not register this file's unrelated TAP targets.
const test = require.main === module ? require('node:test').test : () => {};
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the existing service, with every host dependency inert. No real Git,
// environment values, or project filesystem are consulted by the service.
function localGit({ raw = ' M nested project/needle.ts\0', prefix = 'nested project/\n', fail, inside = 'true\n' } = {}) {
  const calls = [], module = { exports: {} };
  const canonical = '/synthetic-canonical/project';
  const dependencies = {
    'node:path': path,
    'node:os': { homedir: () => '/synthetic-home' },
    'node:fs/promises': { async realpath(value) {
      assert.ok(['/synthetic-alias', canonical].includes(value));
      return canonical;
    } },
    'node:child_process': { execFile(file, args, options, callback) {
      assert.equal(file, 'git', 'only captured synthetic Git reads');
      calls.push({ file, args: [...args], options });
      let stdout;
      if (fail && args.includes(fail)) { callback(new Error('synthetic Git failure'), '', 'synthetic Git failure'); return { stdin: { on() {}, end() {} } }; }
      if (args.includes('--is-inside-work-tree')) stdout = inside;
      else if (args.includes('--show-prefix')) stdout = prefix;
      else {
        assert.deepEqual(Array.from(args.slice(2)), ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
        stdout = raw;
      }
      callback(null, stdout, '');
      return { stdin: { on() {}, end(input) { assert.equal(input, undefined); } } };
    } },
  };
  vm.runInNewContext(fs.readFileSync('electron/core.cjs', 'utf8'), {
    module, Buffer, process: { platform: 'linux', env: {} },
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `unexpected service dependency ${id}`);
      return dependencies[id];
    },
  }, { filename: 'electron/core.cjs' });
  return { calls, canonical, core: module.exports };
}

async function ordinaryStatus(h, t) {
  const result = await h.core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias');
  assert.equal(result.isRepository, true);
  assert.equal(result.root, h.canonical);
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), [{ path: 'nested project/needle.ts', status: 'M' }]);
  assert.ok(h.calls.some(call => call.args.includes('status')));
  t.diagnostic('Positive setup: actual core.gitStatus returned the expected ordinary modified record under inert fs/execFile.');
  return result;
}

test('actual Git status supplies proven projectPrefix after an ordinary successful read', async t => {
  const h = localGit(), result = await ordinaryStatus(h, t);
  assert.equal(result.projectPrefix, 'nested project/', 'successful repository status must carry the Git-supplied projectPrefix');
});

test('actual parser refuses malformed overall framing while preserving destinations and spaces', () => {
  const { core } = localGit();
  // L-03 now counts individual row refusals; only the overall stream stays fatal.
  for (const raw of [null, {}, ' M a'])
    assert.throws(() => core.parseGitStatus(raw), /Malformed/);
  assert.deepEqual(JSON.parse(JSON.stringify(core.parseGitStatus('R  new name\0old name\0?? dir/\0AD gone\0'))),
    [{ path: 'new name', status: 'R' }, { path: 'dir/', status: '??' }, { path: 'gone', status: 'AD' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(core.parseGitStatus(''))), []);
});

test('actual local Git preserves prefix spaces, refuses prefix failure and distinguishes nonrepository', async () => {
  const h = localGit({ prefix: ' spaced /\r\n' });
  assert.equal((await h.core.gitStatus({ id: 's', kind: 'local' }, '/synthetic-alias')).projectPrefix, ' spaced /');
  await assert.rejects(localGit({ fail: '--show-prefix' }).core.gitStatus({ id: 's', kind: 'local' }, '/synthetic-alias'), /synthetic Git failure/);
  const n = localGit({ inside: 'false\n' });
  assert.equal((await n.core.gitStatus({ id: 's', kind: 'local' }, '/synthetic-alias')).isRepository, false);
  assert.equal(n.calls.length, 1);
});

// AST extraction evaluates only the actual literal. Python imports are replaced
// before exec; every path and subprocess operation is an inert assertion stub.
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync('electron/core.cjs', 'utf8');
const ast = ts.createSourceFile('core.cjs', source, ts.ScriptTarget.Latest, true);
let python;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'PYTHON_FILES')
    python = vm.runInNewContext(node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const runner = `import sys,json,types,io,contextlib
cfg=json.loads(sys.argv[1])
calls=[]
fakeos=types.ModuleType('os')
fakeos.environ={}
fakeos.path=types.SimpleNamespace(realpath=lambda p:'/canonical/project',expanduser=lambda p:p,join=lambda *p:'/joined',commonpath=lambda p:'/canonical/project')
sub=types.ModuleType('subprocess')
def run(argv,**kw):
 assert argv[:3]==['git','-C','/canonical/project']
 assert kw=={'capture_output':True,'env':{'LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}}
 calls.append(argv)
 if '--is-inside-work-tree' in argv: out=b'true\\n';err=b'';code=0
 elif '--show-prefix' in argv: out=b' nested /\\r\\n';err=b'';code=0
 else:
  assert argv[3:]==['status','--porcelain=v1','-z','--untracked-files=normal']
  out=b' M  nested /x\\0';err=b'';code=0
 if cfg.get('fail') and '--show-prefix' in argv: code=1;err=b'synthetic prefix failure'
 if cfg.get('nonrepo') and '--is-inside-work-tree' in argv: code=1;err=b'not a git repository'
 return types.SimpleNamespace(returncode=code,stdout=out,stderr=err)
sub.run=run
sys.modules['os']=fakeos
sys.modules['subprocess']=sub
sys.stdin=io.StringIO(json.dumps({'op':'git','root':'/alias','path':''}))
out=io.StringIO();err=io.StringIO();exitcode=0
try:
 with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err): exec(cfg['python'],{})
except SystemExit as e: exitcode=e.code
print(json.dumps({'output':out.getvalue(),'error':err.getvalue(),'exit':exitcode,'calls':calls}))
`;
function runPython(options = {}) {
  assert.equal(typeof python, 'string');
  const result = spawnSync('python3', ['-c', runner, JSON.stringify({ python, ...options })], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('actual generated Python Git branch executes canonical prefix and lock-suppressed reads', () => {
  const result = runPython();
  assert.equal(result.exit, 0);
  assert.equal(result.calls.length, 3);
  assert.equal(JSON.parse(result.output).projectPrefix, ' nested /');
  assert.equal(JSON.parse(result.output).raw, ' M  nested /x\0');
  assert.equal(runPython({ fail: true }).exit, 1);
  const nonrepo = runPython({ nonrepo: true });
  assert.equal(nonrepo.calls.length, 1);
  assert.equal(JSON.parse(nonrepo.output).isRepository, false);
});

test('actual SSH and WSL transport send the real generated Python and exact inert request', async () => {
  for (const connection of [{ id: 's', kind: 'ssh', host: 'synthetic', port: 2222 }, { id: 'w', kind: 'wsl', distro: 'Synthetic' }]) {
    const calls = [], module = { exports: {} };
    vm.runInNewContext(source, { module, Buffer, process: { platform: 'linux', env: {} }, require(id) {
      if (id === 'node:path') return path;
      if (id === 'node:os') return {};
      if (id === 'node:fs/promises') return {};
      assert.equal(id, 'node:child_process');
      return { execFile(file, args, options, callback) {
        calls.push({ file, args, options });
        callback(null, JSON.stringify({ raw: ' M x\0ZZ unsupported\0', root: '/canonical/project', projectPrefix: '', isRepository: true }), '');
        return { stdin: { on() {}, end(input) { calls.at(-1).input = input; } } };
      } };
    } });
    const result = await module.exports.gitStatus(connection, '/alias');
    assert.equal(result.projectPrefix, '');
    assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), [{ path: 'x', status: 'M' }]);
    assert.equal(result.omittedPaths, 1, 'both actual SSH and WSL responses use the shared counted parser');
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.file, connection.kind === 'wsl' ? 'wsl.exe' : 'ssh');
    assert.ok(call.args.at(-1).includes('python3 -c'));
    assert.ok(call.args.at(-1).includes('GIT_OPTIONAL_LOCKS'));
    assert.deepEqual(JSON.parse(call.input), { op: 'git', root: '/alias', path: '' });
    assert.equal(call.options.maxBuffer, 8 * 1024 * 1024);
    assert.equal(call.options.timeout, 25000);
  }
});

test('actual Git status uses one canonical cwd for every read', async t => {
  const h = localGit();
  await ordinaryStatus(h, t);
  assert.ok(h.calls.every(call => call.args[0] === '-C' && call.args[1] === h.canonical),
    'inside, prefix and status must all use the canonical project cwd');
});

test('actual Git status suppresses optional index writes for every read', async t => {
  const h = localGit();
  await ordinaryStatus(h, t);
  assert.ok(h.calls.every(call => call.options.env.GIT_OPTIONAL_LOCKS === '0'),
    'all Git reads must set GIT_OPTIONAL_LOCKS=0');
});

// L-03, lead qitem-20261109074420-981c5b52d1b2b947 supersedes the
// earlier whole-snapshot refusal for an unsupported individual porcelain row.
test('partial Git status keeps recognized rows and counts an unsupported individual row', async t => {
  await ordinaryStatus(localGit(), t);
  const h = localGit({ raw: ' M nested project/needle.ts\0ZZ unsupported.ts\0 A nested project/added.ts\0' });
  const outcome = await h.core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias')
    .then(value => ({ value }), error => ({ error: error.message }));
  assert.equal(outcome.error, undefined, 'an unsupported individual row must not discard recognized Git status');
  const result = outcome.value;
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), [
    { path: 'nested project/needle.ts', status: 'M' },
    { path: 'nested project/added.ts', status: 'A' },
  ]);
  assert.equal(result.omittedPaths, 1, 'the actual shared API carries the exact omitted-row count');
});

test('partial Git status counts an all-unsupported stream instead of treating it as clean', async t => {
  await ordinaryStatus(localGit(), t);
  const h = localGit({ raw: 'ZZ unsupported.ts\0' });
  const outcome = await h.core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias')
    .then(value => ({ value }), error => ({ error: error.message }));
  assert.equal(outcome.error, undefined, 'individual unsupported rows produce partial status, not an overall error');
  const result = outcome.value;
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), []);
  assert.equal(result.omittedPaths, 1, 'an empty partial snapshot retains its uncertainty count');
});

module.exports = { localGit };

test('actual counted parser skips logical bad rows without shifting valid destinations', async () => {
  const cases = [
    [' M valid\0ZZ unknown\0 A added\0', [['valid', 'M'], ['added', 'A']], 1],
    [' M valid\0\0?? extra\0', [['valid', 'M'], ['extra', '??']], 1],
    [' M valid\0M! bad\0 Mxa\0 M \0', [['valid', 'M']], 3],
    [' M valid\0R  missing-source\0', [['valid', 'M']], 1],
    [' M valid\0R  missing-source\0\0 A added\0', [['valid', 'M'], ['added', 'A']], 1],
    ['R  new name\0old name\0?? dir/\0', [['new name', 'R'], ['dir/', '??']], 0],
    ['   unsupported\0', [], 1],
    ['', [], 0],
  ];
  for (const [raw, expected, omitted] of cases) {
    const { core } = localGit({ raw, prefix: '' });
    const result = await core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias');
    assert.deepEqual(JSON.parse(JSON.stringify(result.entries)), expected.map(([path, status]) => ({ path, status })));
    assert.equal(result.omittedPaths || 0, omitted);
    assert.deepEqual(JSON.parse(JSON.stringify(core.parseGitStatus(raw))), JSON.parse(JSON.stringify(result.entries)),
      'existing exported array parser remains compatible with the counted shared service');
  }
});

test('actual shared status refuses malformed prefix provenance for every consumer', async () => {
  for (const prefix of ['../\n', '/absolute/\n', 'a//\n', 'missing-slash\n']) {
    const h = localGit({ prefix });
    await assert.rejects(h.core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias'),
      /Malformed Git status/, 'overall prefix failure must not become a partial/clean Changes response');
  }
});

// L-02: execute the actual local listing branch with only inert filesystem calls.
test('odd listing backend preserves literal POSIX backslash identity and Windows separators', async t => {
  async function list(platform, root, relative, names) {
    const fakePath = platform === 'win32' ? path.win32 : path.posix;
    const module = { exports: {} }, calls = [];
    const target = fakePath.resolve(root, relative);
    vm.runInNewContext(source, { module, Buffer, process: { platform, env: {} }, require(id) {
      if (id === 'node:path') return fakePath;
      if (id === 'node:os') return { homedir: () => root };
      if (id === 'node:child_process') return { execFile() { assert.fail('listing never invokes a host process'); } };
      assert.equal(id, 'node:fs/promises');
      return {
        async realpath(value) { assert.ok([root, target].includes(value)); return value; },
        async readdir(value, options) {
          assert.equal(value, target); assert.equal(options.withFileTypes, true); calls.push(value);
          return names.map(name => ({ name, isSymbolicLink: () => false, isDirectory: () => false }));
        },
      };
    } });
    const result = await module.exports.fileOperation({ id: 'synthetic', kind: 'local' },
      { op: 'list', root, path: relative });
    assert.equal(calls.length, 1);
    return JSON.parse(JSON.stringify(result));
  }
  const windows = await list('win32', 'C:\\Synthetic', 'folder', ['ordinary.ts']);
  assert.equal(windows[0].path, 'folder/ordinary.ts', 'ordinary Windows separators remain normalized');
  const posix = await list('linux', '/synthetic-list', '', ['ordinary.ts', 'literal\\name.ts']);
  assert.ok(posix.some(e => e.path === 'ordinary.ts'), 'actual inert POSIX listing returns an ordinary sibling');
  t.diagnostic('Positive setup: actual local listing executed with inert paths, Dirents and one read on each platform.');
  assert.ok(posix.some(e => e.path === 'literal\\name.ts'), 'literal POSIX backslash must not become a directory separator');
});

test('odd prefix actual Git accepts literal POSIX colon and backslash directories', async t => {
  await ordinaryStatus(localGit(), t);
  for (const prefix of ['project:dir/', 'literal\\directory/']) {
    const h = localGit({ prefix: prefix + '\n', raw: ` M ${prefix}needle.ts\0` });
    const outcome = await h.core.gitStatus({ id: 'synthetic', kind: 'local' }, '/synthetic-alias')
      .then(value => ({ value }), error => ({ error: error.message }));
    assert.equal(outcome.error, undefined, 'repo-relative POSIX prefix must not inherit Windows filename restrictions');
    assert.equal(outcome.value.projectPrefix, prefix);
    assert.equal(outcome.value.entries[0].path, prefix + 'needle.ts');
  }
});

// Same actual service for the root-requested list/search/read composition check.
// Every filesystem call is synthetic; no host path or process is consulted.
function localFiles(root = '/synthetic-compose') {
  const module = { exports: {} }, calls = [];
  const names = ['ordinary.ts', 'literal\\name.ts'];
  const allowed = new Set([root, ...names.map(name => path.posix.join(root, name))]);
  const files = {
    async realpath(value) { assert.ok(allowed.has(value), 'only the exact synthetic root/file identity is accessed'); return value; },
    async readdir(value, options) {
      assert.equal(value, root); assert.equal(options.withFileTypes, true); calls.push(['list', value]);
      return names.map(name => ({ name, isDirectory: () => false, isSymbolicLink: () => false }));
    },
    async stat(value) { assert.ok(allowed.has(value) && value !== root); calls.push(['stat', value]); return { size: 32 }; },
    async readFile(value, encoding) {
      assert.ok(allowed.has(value) && value !== root); assert.equal(encoding, 'utf8');
      calls.push(['read', value]); return `synthetic:${path.posix.basename(value)}`;
    },
  };
  vm.runInNewContext(source, { module, Buffer, process: { platform: 'linux', env: {} }, require(id) {
    if (id === 'node:path') return path.posix;
    if (id === 'node:os') return { homedir: () => root };
    if (id === 'node:fs/promises') return files;
    assert.equal(id, 'node:child_process');
    return { execFile() { assert.fail('synthetic file navigation never invokes a host process'); } };
  } });
  return { core: module.exports, calls, root };
}
module.exports.localFiles = localFiles;

test('odd composition actual core preserves the same literal identity through list search and read', async t => {
  const h = localFiles(), owner = { id: 'synthetic', kind: 'local' };
  const listed = await h.core.fileOperation(owner, { op: 'list', root: h.root, path: '' });
  assert.ok(listed.some(e => e.path === 'ordinary.ts'), 'ordinary actual list positive');
  assert.ok(listed.some(e => e.path === 'literal\\name.ts'));
  const matches = await h.core.fileOperation(owner, { op: 'search', root: h.root, path: '', query: 'literal' });
  assert.deepEqual(JSON.parse(JSON.stringify(matches.map(e => e.path))), ['literal\\name.ts']);
  const read = await h.core.fileOperation(owner, { op: 'read', root: h.root, path: matches[0].path });
  assert.equal(read.content, 'synthetic:literal\\name.ts');
  assert.deepEqual(h.calls.filter(([op]) => op === 'read'), [['read', h.root + '/literal\\name.ts']]);
  t.diagnostic('GREEN composition evidence: actual list/search/read shared one literal POSIX file identity under inert filesystem containment.');
});

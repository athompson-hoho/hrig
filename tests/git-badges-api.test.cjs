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

test('actual parser rejects malformed framing while preserving destinations and spaces', () => {
  const { core } = localGit();
  for (const raw of [null, {}, ' M a', ' M a\0\0', 'ZZ a\0', '   a\0', 'M! a\0', ' Mxa\0', ' M \0', 'R  new\0', 'R  new\0\0'])
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
        callback(null, JSON.stringify({ raw: ' M x\0', root: '/canonical/project', projectPrefix: '', isRepository: true }), '');
        return { stdin: { on() {}, end(input) { calls.at(-1).input = input; } } };
      } };
    } });
    const result = await module.exports.gitStatus(connection, '/alias');
    assert.equal(result.projectPrefix, '');
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

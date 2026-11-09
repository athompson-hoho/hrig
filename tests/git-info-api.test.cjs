const test = require.main === module ? require('node:test').test : () => {};
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Actual core, with synthetic paths and inert process/filesystem boundaries.
function metadataCore(respond, canonicalRoot = '/synthetic canonical/project') {
  const module = { exports: {} }, calls = [];
  const root = canonicalRoot;
  const oid = 'a'.repeat(40), upstreamOid = 'b'.repeat(40);
  const dependencies = {
    'node:path': path.posix,
    'node:os': { homedir: () => '/synthetic-home' },
    'node:fs/promises': {
      async realpath(value) {
        assert.ok(['/synthetic-alias', root, root + '/ordinary.ts'].includes(value));
        return value === '/synthetic-alias' ? root : value;
      },
      async stat(value) { assert.equal(value, root + '/ordinary.ts'); return { size: 18 }; },
      async readFile(value, encoding) {
        assert.equal(value, root + '/ordinary.ts'); assert.equal(encoding, 'utf8');
        return 'ordinary synthetic';
      },
    },
    'node:child_process': { execFile(file, args, options, callback) {
      assert.equal(file, 'git');
      assert.deepEqual(Array.from(args.slice(0, 2)), ['-C', root]);
      assert.equal(options.env.LC_ALL, 'C');
      assert.equal(options.env.GIT_OPTIONAL_LOCKS, '0');
      const argv = Array.from(args.slice(2)); calls.push(argv);
      if (respond) {
        const result = respond(argv, calls.length);
        if (result) {
          callback(result.code ? Object.assign(new Error('synthetic Git failure'), { code: result.code }) : null,
            result.stdout || '', result.stderr || '');
          return { stdin: { on() {}, end() {} } };
        }
      }
      let stdout;
      if (argv.join(' ') === 'rev-parse --is-inside-work-tree') stdout = 'true\n';
      else if (argv.join(' ') === 'symbolic-ref --quiet HEAD') stdout = 'refs/heads/topic\n';
      else if (argv[0] === 'for-each-ref') stdout = `refs/heads/topic\0${oid}\0refs/remotes/origin/topic\n`;
      else if (argv[0] === 'rev-parse' && argv.at(-1) === 'HEAD^{commit}') stdout = oid + '\n';
      else if (argv[0] === 'rev-parse' && argv.at(-1) === 'refs/remotes/origin/topic^{commit}') stdout = upstreamOid + '\n';
      else if (argv[0] === 'rev-list') {
        assert.deepEqual(argv, ['rev-list', '--left-right', '--count', `${oid}...${upstreamOid}`]);
        stdout = '3\t1\n';
      } else assert.fail(`Unexpected synthetic metadata command: ${argv.join(' ')}`);
      callback(null, stdout, '');
      return { stdin: { on() {}, end(input) { assert.equal(input, undefined); } } };
    } },
  };
  vm.runInNewContext(fs.readFileSync('electron/core.cjs', 'utf8'), {
    module, Buffer, process: { platform: 'linux', env: {} },
    require(id) { assert.ok(Object.hasOwn(dependencies, id)); return dependencies[id]; },
  }, { filename: 'electron/core.cjs' });
  return { core: module.exports, calls, root, oid, upstreamOid,
    connection: Object.freeze({ id: 'synthetic', kind: 'local', root: '/synthetic-alias' }) };
}

async function ordinaryRead(h) {
  const value = await h.core.fileOperation(h.connection,
    { op: 'read', root: '/synthetic-alias', path: 'ordinary.ts' });
  assert.equal(value.content, 'ordinary synthetic');
}

test('actual core ordinary file read remains a positive control', async () => {
  await ordinaryRead(metadataCore());
});

test('actual core gitInfo returns attached branch and asymmetric immutable comparison', async t => {
  const h = metadataCore(); await ordinaryRead(h);
  t.diagnostic('Positive control: unchanged actual core ordinary read returned synthetic content.');
  const outcome = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' })
    .then(value => ({ value }), error => ({ error: error.message }));
  assert.equal(outcome.error, undefined, 'metadata operation must be supported after an ordinary existing read');
  assert.deepEqual(JSON.parse(JSON.stringify(outcome.value)), {
    state: 'repository', root: h.root, head: 'attached', branch: 'topic', oid: h.oid,
    comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 3, behind: 1,
  });
});

module.exports = { metadataCore, ordinaryRead };

test('actual local gitInfo refuses ambiguous bare context rather than claiming no repository', async () => {
  const h = metadataCore(argv => argv.join(' ') === 'rev-parse --is-inside-work-tree'
    ? { stdout: 'false\n' } : undefined);
  await ordinaryRead(h);
  const outcome = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' })
    .then(value => ({ value }), error => ({ error: error.message }));
  assert.equal(outcome.error, 'Git information is unavailable.',
    'false is compatible with bare Git context and cannot positively prove absence');
  assert.equal(h.calls.length, 1, 'ambiguous context terminates without a status scan');
});

test('actual generated Python gitInfo executes bounded canonical metadata reads', () => {
  const ts = require('typescript');
  const ast = ts.createSourceFile('core.cjs', fs.readFileSync('electron/core.cjs', 'utf8'), ts.ScriptTarget.Latest, true);
  let python;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'PYTHON_FILES') python = vm.runInNewContext(n.initializer.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const runner = `import sys,json,types,io,contextlib
source=json.loads(sys.argv[1])
calls=[]
fakeos=types.ModuleType('os')
fakeos.environ={}
fakeos.path=types.SimpleNamespace(realpath=lambda p:'/canonical/nested project',expanduser=lambda p:p,join=lambda *p:'/joined',commonpath=lambda p:'/canonical/nested project')
sub=types.ModuleType('subprocess')
def run(argv,**kw):
 assert argv[:3]==['git','-C','/canonical/nested project']
 assert kw=={'capture_output':True,'env':{'LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}}
 args=argv[3:];calls.append(args)
 if args==['rev-parse','--is-inside-work-tree']: out=b'true\\n'
 elif args==['symbolic-ref','--quiet','HEAD']: out=b'refs/heads/topic\\n'
 elif args==['for-each-ref','--format=%(refname)%00%(objectname)%00%(upstream)','refs/heads/topic']: out=b'refs/heads/topic\\0'+b'a'*40+b'\\0refs/remotes/origin/topic\\n'
 elif args==['rev-parse','--verify','--quiet','--end-of-options','HEAD^{commit}']: out=b'a'*40+b'\\n'
 elif args==['rev-parse','--verify','--quiet','--end-of-options','refs/remotes/origin/topic^{commit}']: out=b'b'*40+b'\\n'
 else:
  assert args==['rev-list','--left-right','--count','a'*40+'...'+'b'*40]
  out=b'3\\t1\\n'
 return types.SimpleNamespace(returncode=0,stdout=out,stderr=b'')
sub.run=run
sys.modules['os']=fakeos;sys.modules['subprocess']=sub
sys.stdin=io.StringIO(json.dumps(dict(op='gitInfo',root='/alias')))
out=io.StringIO()
with contextlib.redirect_stdout(out): exec(source,{})
print(json.dumps(dict(value=json.loads(out.getvalue()),calls=calls)))
`;
  const r = require('node:child_process').spawnSync('python3', ['-c', runner, JSON.stringify(python)], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(result.value, { state: 'repository', root: '/canonical/nested project', head: 'attached', branch: 'topic', oid: 'a'.repeat(40), comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 3, behind: 1 });
  assert.equal(result.calls.length, 10);
});

// One independently authored command transcript feeds both actual implementations.
// It permits no filesystem, status scan, shell command, or host environment read.
function pythonTranscript(script, root, legacy = false) {
  const ts = require('typescript');
  const ast = ts.createSourceFile('core.cjs', fs.readFileSync('electron/core.cjs', 'utf8'), ts.ScriptTarget.Latest, true);
  let source;
  const visit = n => { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'PYTHON_FILES') source = vm.runInNewContext(n.initializer.getText(ast)); ts.forEachChild(n, visit); };
  visit(ast);
  const runner = `import sys,json,types,io,contextlib
source,script,root,legacy=json.loads(sys.argv[1])
calls=[]
fakeos=types.ModuleType('os');fakeos.environ={}
fakeos.path=types.SimpleNamespace(realpath=lambda p:root,expanduser=lambda p:p,join=lambda *p:root,commonpath=lambda p:root)
sub=types.ModuleType('subprocess')
def run(argv,**kw):
 assert argv[:3]==['git','-C',root]
 assert kw==dict(capture_output=True,env=dict(LC_ALL='C',GIT_OPTIONAL_LOCKS='0'))
 args=argv[3:]
 if legacy and ('--end-of-options' in args or '--exists' in args): return types.SimpleNamespace(returncode=129,stdout=b'',stderr=b'usage: git: unknown option')
 entry=script[len(calls)];calls.append(args)
 assert args==entry['args'],(args,entry)
 if entry.get('missing'): raise FileNotFoundError()
 return types.SimpleNamespace(returncode=entry.get('code',0),stdout=entry.get('stdout','').encode(),stderr=entry.get('stderr','').encode())
sub.run=run;sys.modules['os']=fakeos;sys.modules['subprocess']=sub
sys.stdin=io.StringIO(json.dumps(dict(op='gitInfo',root='/alias')))
out=io.StringIO();err=io.StringIO();value=None;error=None
try:
 with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err): exec(source,{})
except SystemExit as e:
 if e.code: error='Git information is unavailable.'
except Exception as e: error=str(e)
if not error: value=json.loads(out.getvalue())
print(json.dumps(dict(value=value,error=error,calls=calls)))
`;
  const result = require('node:child_process').spawnSync('python3', ['-c', runner, JSON.stringify([source, script, root, legacy])], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const inside = { args: ['rev-parse', '--is-inside-work-tree'], stdout: 'true\n' };
const sym = { args: ['symbolic-ref', '--quiet', 'HEAD'], stdout: 'refs/heads/topic\n' };
const head = { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'HEAD^{commit}'], stdout: A + '\n' };
const map = { args: ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)', 'refs/heads/topic'], stdout: `refs/heads/topic\0${A}\0refs/remotes/origin/topic\n` };
const up = { args: ['rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/remotes/origin/topic^{commit}'], stdout: B + '\n' };
const count = { args: ['rev-list', '--left-right', '--count', A + '...' + B], stdout: '3\t1\n' };
const attached = [sym, head, map, up];
const none = [sym, head, { ...map, stdout: `refs/heads/topic\0${A}\0\n` }];
const detached = [{ ...sym, code: 1, stdout: '' }, head];
const unborn = [sym, { ...head, code: 1, stdout: '' }, { args: ['show-ref', '--exists', 'refs/heads/topic'], code: 2 }];
const gone = [sym, head, map, { ...up, code: 1, stdout: '' }];
const repo = { state: 'repository', head: 'attached', branch: 'topic', oid: A };
const matrices = [
  ['known zero', [inside, ...attached, { ...count, stdout: '0\t0\n' }, ...attached], { ...repo, comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 0, behind: 0 }],
  ['safe count boundary', [inside, ...attached, { ...count, stdout: '9007199254740991\t1\n' }, ...attached], { ...repo, comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: Number.MAX_SAFE_INTEGER, behind: 1 }],
  ['no configured upstream', [inside, ...none, ...none], { ...repo, comparison: 'none' }],
  ['configured upstream gone', [inside, ...gone, ...gone], { ...repo, comparison: 'unknown', upstream: 'refs/remotes/origin/topic' }],
  ['comparison command failed', [inside, ...attached, { ...count, code: 128, stdout: '', stderr: 'unsupported' }, ...attached], { ...repo, comparison: 'unknown', upstream: 'refs/remotes/origin/topic' }],
  ['proven detached', [inside, ...detached, ...detached], { state: 'repository', head: 'detached', oid: A, comparison: 'none' }],
  ['independently proven unborn', [inside, ...unborn, ...unborn], { state: 'repository', head: 'unborn', branch: 'topic', comparison: 'none' }],
  ['positive absence', [{ ...inside, code: 128, stdout: '', stderr: 'fatal: not a git repository (or any parent)' }], { state: 'not-repository' }],
  ['bare false ambiguous', [{ ...inside, stdout: 'false\n' }], null],
  ['permission error', [{ ...inside, code: 128, stdout: '', stderr: 'fatal: permission denied' }], null],
  ['missing Git', [{ ...inside, missing: true }], null],
  ['symbolic exit128', [inside, { ...sym, code: 128, stdout: '', stderr: 'broken' }], null],
  ['symbolic exit1 needs commit', [inside, detached[0], { ...head, code: 1, stdout: '' }], null],
  ['show-ref exit1 is error not unborn', [inside, ...unborn.slice(0, 2), { ...unborn[2], code: 1 }], null],
  ['unsupported show-ref is not unborn', [inside, ...unborn.slice(0, 2), { ...unborn[2], code: 129 }], null],
  ['sibling full ref is not exact', [inside, sym, head, { ...map, stdout: `refs/heads/topic-other\0${A}\0\n` }], null],
  ['sibling and exact mapping select exact', [inside, sym, head, { ...none[2], stdout: `refs/heads/topic-other\0${B}\0\n${none[2].stdout}` }, ...none], { ...repo, comparison: 'none' }],
  ['control-bearing branch', [inside, { ...sym, stdout: 'refs/heads/top\tic\n' }], null],
  ['control-bearing upstream', [inside, sym, head, { ...map, stdout: `refs/heads/topic\0${A}\0refs/remotes/ori\tgin\n` }], null],
  ['HEAD changed during final check', [inside, ...attached, count, sym, { ...head, stdout: B + '\n' }, map], null],
  ['symbolic branch changed during final check', [inside, ...attached, count, { ...sym, stdout: 'refs/heads/other\n' }, head, { ...map, args: [...map.args.slice(0, 2), 'refs/heads/other'] }], null],
  ['upstream changed during final check', [inside, ...attached, count, sym, head, map, { ...up, stdout: A + '\n' }], null],
  ...['', '-1\t2\n', '1.5\t2\n', '1\t2\t3\n', '9007199254740992\t0\n', '1e2\t0\n'].map(stdout => [`malformed count ${JSON.stringify(stdout)}`, [inside, ...attached, { ...count, stdout }], null]),
];
for (const [name, script, expected] of matrices) test(`actual local and Python metadata: ${name}`, async () => {
  const root = '/canonical/nested spaced:legal\\name';
  let cursor = 0;
  const h = metadataCore(argv => {
    const step = script[cursor++]; assert.ok(step, 'bounded scripted command count'); assert.deepEqual(argv, step.args);
    return step.missing ? { code: 'ENOENT', stderr: 'synthetic absent executable' } : step;
  }, root);
  const local = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' }).then(value => ({ value }), error => ({ error: error.message }));
  const python = pythonTranscript(script, root);
  assert.equal(cursor, script.length); assert.equal(python.calls.length, script.length); assert.ok(cursor <= 10);
  if (expected) {
    assert.deepEqual(local.value === undefined ? undefined : JSON.parse(JSON.stringify(local.value)), { ...expected, root });
    assert.deepEqual(python.value, { ...expected, root });
  } else {
    assert.ok(local.error, 'local failure cannot become metadata');
    assert.equal(python.error, 'Git information is unavailable.');
  }
});

for (const [name, original, expected] of [
  ['attached', [inside, ...attached, count, ...attached], { ...repo, comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 3, behind: 1 }],
  ['zero', [inside, ...attached, { ...count, stdout: '0\t0\n' }, ...attached], { ...repo, comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 0, behind: 0 }],
  ['unborn', [inside, ...unborn, ...unborn], { state: 'repository', head: 'unborn', branch: 'topic', comparison: 'none' }],
]) test(`legacy host actual local and Python supports ${name} without newer flags`, async () => {
  const root = '/legacy canonical';
  const script = original.map(step => ({ ...step, args: step.args[0] === 'show-ref' ? ['show-ref', '--verify', '--quiet', 'refs/heads/topic'] : step.args.filter(a => a !== '--end-of-options'), ...(step.args[0] === 'show-ref' ? { code: 1 } : {}) }));
  let cursor = 0;
  const h = metadataCore(args => {
    if (args.includes('--end-of-options') || args.includes('--exists')) return { code: 129, stderr: 'usage: git: unknown option' };
    const step = script[cursor++]; assert.deepEqual(args, step.args); return step;
  }, root);
  await ordinaryRead(h);
  const local = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' }).then(value => ({ value }), error => ({ error: error.message }));
  const python = pythonTranscript(script, root, true);
  assert.deepEqual(local.value === undefined ? undefined : JSON.parse(JSON.stringify(local.value)), { ...expected, root }, 'supported legacy commands must yield actual local metadata');
  assert.deepEqual(python.value, { ...expected, root }, 'actual Python legacy metadata must succeed');
  assert.equal(cursor, script.length);
});
test('actual local and Python required command usage returns closed unsupported reason', async () => {
  const root = '/unsupported canonical', script = [inside, { ...sym, code: 129, stdout: '', stderr: 'usage: git symbolic-ref: unsupported option PRIVATE_CANARY' }];
  let i = 0; const h = metadataCore(args => { const step = script[i++]; assert.deepEqual(args, step.args); return step; }, root);
  await ordinaryRead(h);
  const local = await h.core.fileOperation(h.connection, { op: 'gitInfo', root: '/synthetic-alias' }).then(value => ({ value }), error => ({ error: error.message }));
  const python = pythonTranscript(script, root);
  const expected = { state: 'unavailable', root, reason: 'unsupported-git' };
  assert.deepEqual(local.value === undefined ? undefined : JSON.parse(JSON.stringify(local.value)), expected, 'unsupported required command needs fixed explicit reason');
  assert.deepEqual(python.value, expected);
});

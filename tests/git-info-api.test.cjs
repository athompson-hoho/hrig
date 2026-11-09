const test = require.main === module ? require('node:test').test : () => {};
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Actual core, with synthetic paths and inert process/filesystem boundaries.
function metadataCore(respond) {
  const module = { exports: {} }, calls = [];
  const root = '/synthetic canonical/project';
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

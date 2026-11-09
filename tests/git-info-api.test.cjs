const test = require.main === module ? require('node:test').test : () => {};
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Actual core, with synthetic paths and inert process/filesystem boundaries.
function metadataCore() {
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

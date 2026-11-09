const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the existing service, with every host dependency inert. No real Git,
// environment values, or project filesystem are consulted by the service.
function localGit() {
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
      if (args.includes('--is-inside-work-tree')) stdout = 'true\n';
      else if (args.includes('--show-prefix')) stdout = 'nested project/\n';
      else {
        assert.deepEqual(Array.from(args.slice(2)), ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
        stdout = ' M nested project/needle.ts\0';
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

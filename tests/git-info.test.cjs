const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/git-info.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: subject });
const { projectGitInfo: project, describeGitInfo: describe } = subject;
const plain = v => JSON.parse(JSON.stringify(v));
const known = { state: 'repository', root: '/canonical', head: 'attached', branch: 'topic', oid: 'a'.repeat(40), comparison: 'known', upstream: 'refs/remotes/origin/topic', ahead: 3, behind: 1 };
module.exports = { known };
const cases = [
  [{ state: 'checking' }, 'Checking Git…', 'Checking Git information for the selected workspace.'],
  [{ state: 'unavailable' }, 'Git unavailable', 'Git information is unavailable. Open Files and use Refresh files to check again.'],
  [{ state: 'not-repository', root: '/canonical' }, 'No Git repository', 'This workspace is not in a Git repository.'],
  [known, 'topic ↑3 ↓1', 'Branch topic. Upstream refs/remotes/origin/topic. 3 commits ahead and 1 commit behind refs/remotes/origin/topic.'],
  [{ ...known, comparison: 'none', upstream: undefined, ahead: undefined, behind: undefined }, 'topic · no upstream', 'Branch topic. No upstream is configured; ahead and behind counts are unavailable.'],
  [{ ...known, comparison: 'unknown', ahead: undefined, behind: undefined }, 'topic · comparison unavailable', 'Branch topic. Upstream refs/remotes/origin/topic. Ahead and behind counts are unavailable from local Git information.'],
  [{ state: 'repository', root: '/canonical', head: 'detached', oid: 'b'.repeat(64), comparison: 'none' }, 'Detached HEAD', 'Detached HEAD; no branch is checked out. Ahead and behind counts are unavailable.'],
  [{ state: 'repository', root: '/canonical', head: 'unborn', branch: 'topic', comparison: 'none' }, 'topic · no commits', 'Branch topic has no commits. Ahead and behind counts are unavailable.'],
];
for (const [input, summary, meaning] of cases) test(`finite Git copy: ${summary}`, () => {
  const snapshot = ['checking', 'unavailable'].includes(input.state) ? input : project(Object.freeze(input));
  assert.equal(describe(snapshot).summary, summary);
  assert.equal(describe(snapshot).detail, `Open source control. ${meaning}${input.state === 'repository' ? ' Local Git snapshot; no remote fetch. Open Files and use Refresh files to check again.' : ''}`);
});
test('pure comparison preserves zero safe limits and exact Unicode identity without mutation', () => {
  for (const n of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const input = Object.freeze({ ...known, branch: ' e\u0301/分支<&> '.repeat(30), ahead: n, behind: n });
    assert.deepEqual(plain(project(input)), input);
    const copy = describe(project(input));
    assert.equal(copy.summary, `${input.branch} ↑${n} ↓${n}`);
    assert.ok(copy.detail.includes(`Branch ${input.branch}.`));
    assert.ok(copy.detail.includes(`${n} ${n === 1 ? 'commit' : 'commits'} ahead`));
  }
});
test('pure metadata rejects missing unsafe control-bearing and contradictory envelopes', () => {
  const invalid = [null, undefined, [], {}, { ...known, root: '' }, { ...known, oid: 'a' },
    ...[null, undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'].flatMap(n => [{ ...known, ahead: n }, { ...known, behind: n }]),
    ...['', '\n', 'a\0b', 'a\x7fb'].flatMap(v => [{ ...known, branch: v }, { ...known, upstream: v }]),
    { ...known, comparison: 'none' }, { ...known, comparison: 'unknown' },
    { ...known, head: 'unborn' }, { ...known, head: 'detached' },
    { ...known, state: 'not-repository' }];
  for (const input of invalid) assert.deepEqual(plain(project(input)), { state: 'unavailable' });
  assert.equal(project({ ...known, comparison: 'unknown', upstream: undefined, ahead: undefined, behind: undefined }).comparison, 'unknown');
});

test('pure unsupported reason is closed and completed snapshot copy is explicitly not live', () => {
  const value = { state: 'unavailable', root: '/canonical', reason: 'unsupported-git' };
  assert.deepEqual(plain(project(value)), value);
  const copy = describe(project(value));
  assert.equal(copy.summary, 'Git unsupported');
  assert.match(copy.detail, /Git on this host does not support the required metadata commands\./);
  for (const result of [known, value, { state: 'not-repository', root: '/canonical' }]) {
    assert.ok(describe(project(result)).detail.includes('Snapshot, not live. Terminal checkouts or commits need Refresh files.'));
  }
  for (const extra of [{ reason: 'PRIVATE_CANARY' }, { branch: 'topic' }, { ahead: 0 }, { head: 'attached' }]) assert.deepEqual(plain(project({ ...value, ...extra })), { state: 'unavailable' });
});

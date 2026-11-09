const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/git-badges.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: subject });
const { projectGitStatus, gitCounts, gitRowRecords, gitRecordText } = subject;
const plain = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const snapshot = (entries = [], projectPrefix = '') => freeze({ isRepository: true, root: '/canonical', projectPrefix, entries });

// Expected letters and complete descriptions are authored independently of the mapper.
const meanings = [
  ['M', 'M', 'Modified'], ['A', 'A', 'Added'], ['D', 'D', 'Deleted'],
  ['R', 'M', 'Renamed; destination only'], ['C', 'M', 'Copied; destination only'], ['T', 'M', 'Type changed'],
  ['??', '?', 'Untracked'],
  ['MM', 'M', 'Modified; Modified'], ['MA', 'A', 'Modified; Added'], ['MD', 'D', 'Modified; Deleted'],
  ['MR', 'M', 'Modified; Renamed; destination only'], ['MC', 'M', 'Modified; Copied; destination only'], ['MT', 'M', 'Modified; Type changed'],
  ['AM', 'A', 'Added; Modified'], ['AA', 'M', 'Conflict: both added'], ['AD', 'D', 'Added; Deleted'],
  ['AR', 'A', 'Added; Renamed; destination only'], ['AC', 'A', 'Added; Copied; destination only'], ['AT', 'A', 'Added; Type changed'],
  ['DM', 'D', 'Deleted; Modified'], ['DA', 'D', 'Deleted; Added'], ['DD', 'M', 'Conflict: both deleted'],
  ['DR', 'D', 'Deleted; Renamed; destination only'], ['DC', 'D', 'Deleted; Copied; destination only'], ['DT', 'D', 'Deleted; Type changed'],
  ['RM', 'M', 'Renamed; destination only; Modified'], ['RA', 'A', 'Renamed; destination only; Added'], ['RD', 'D', 'Renamed; destination only; Deleted'],
  ['RR', 'M', 'Renamed; destination only; Renamed; destination only'], ['RC', 'M', 'Renamed; destination only; Copied; destination only'], ['RT', 'M', 'Renamed; destination only; Type changed'],
  ['CM', 'M', 'Copied; destination only; Modified'], ['CA', 'A', 'Copied; destination only; Added'], ['CD', 'D', 'Copied; destination only; Deleted'],
  ['CR', 'M', 'Copied; destination only; Renamed; destination only'], ['CC', 'M', 'Copied; destination only; Copied; destination only'], ['CT', 'M', 'Copied; destination only; Type changed'],
  ['TM', 'M', 'Type changed; Modified'], ['TA', 'A', 'Type changed; Added'], ['TD', 'D', 'Type changed; Deleted'],
  ['TR', 'M', 'Type changed; Renamed; destination only'], ['TC', 'M', 'Type changed; Copied; destination only'], ['TT', 'M', 'Type changed; Type changed'],
  ['AU', 'M', 'Conflict: added by us'], ['UD', 'M', 'Conflict: deleted by them'], ['UA', 'M', 'Conflict: added by them'],
  ['DU', 'M', 'Conflict: deleted by us'], ['UU', 'M', 'Conflict: both modified'],
];
for (const [status, letter, description] of meanings) {
  test(`pure mapping ${status} preserves its winning letter and complete meaning`, () => {
    const input = snapshot([{ path: 'src/Name with spaces.ts', status }]);
    const before = JSON.stringify(input);
    assert.deepEqual(plain(projectGitStatus(input)), { state: 'ready', records: [
      { path: 'src/Name with spaces.ts', status, letter, description, directory: false, covering: false },
    ] });
    assert.deepEqual(plain(projectGitStatus(input)), plain(projectGitStatus(input)), 'repeated frozen input is deterministic');
    assert.equal(JSON.stringify(input), before);
  });
}

test('pure projection requires explicit valid provenance and distinguishes nonrepository', () => {
  for (const value of [undefined, null, [], {}, { isRepository: 'true' },
    { isRepository: true, root: '/x', entries: [] },
    ...[null, 0, {}, 'nested', '/nested/', '../', './', 'a//', 'a/../', 'a\\b/', 'C:/', 'a\n/'].map(projectPrefix => ({ isRepository: true, root: '/x', entries: [], projectPrefix })),
    ...['', null, 0].map(root => ({ isRepository: true, root, entries: [], projectPrefix: '' })),
    { isRepository: true, root: '/x', entries: {}, projectPrefix: '' }]) {
    assert.deepEqual(plain(projectGitStatus(freeze(value))), { state: 'unavailable' });
  }
  assert.deepEqual(plain(projectGitStatus(snapshot())), { state: 'ready', records: [] });
  assert.deepEqual(plain(projectGitStatus(freeze({ isRepository: false }))), { state: 'not-repository' });
});

test('pure nested prefix preserves exact spaces case and separator boundaries', () => {
  const input = snapshot([
    { path: ' spaced /Nested/ File.ts ', status: 'M' },
    { path: ' spaced /nested/wrong-case', status: 'A' },
    { path: ' spaced /Nested-other/wrong-boundary', status: 'D' },
    { path: 'other/outside', status: '??' },
  ], ' spaced /Nested/');
  assert.deepEqual(plain(projectGitStatus(input)), { state: 'ready', records: [
    { path: ' File.ts ', status: 'M', letter: 'M', description: 'Modified', directory: false, covering: false },
  ] });
  assert.deepEqual(plain(projectGitStatus(snapshot([{ path: 'outside/file', status: 'M' }], 'project/'))), { state: 'ready', records: [] });
});

test('pure aggregate and covering records remain explicit without invented child statuses', () => {
  const result = projectGitStatus(snapshot([{ path: 'parent/', status: '??' },
    { path: 'parent/project/new/', status: '??' }, { path: 'parent/project/gone', status: 'D' },
    { path: 'parent/project/omitted/deep', status: 'A' }], 'parent/project/'));
  assert.deepEqual(plain(result), { state: 'ready', records: [
    { path: 'parent/', status: '??', letter: '?', description: 'Untracked directory; contents not individually reported', directory: true, covering: true },
    { path: 'new/', status: '??', letter: '?', description: 'Untracked directory; contents not individually reported', directory: true, covering: false },
    { path: 'gone', status: 'D', letter: 'D', description: 'Deleted', directory: false, covering: false },
    { path: 'omitted/deep', status: 'A', letter: 'A', description: 'Added', directory: false, covering: false },
  ] });
  freeze(result.records);
  assert.deepEqual(plain(gitRowRecords(result.records, 'new/child', false)), []);
  assert.deepEqual(plain(gitRowRecords(result.records, 'parent', true)), []);
  assert.deepEqual(plain(gitRowRecords(result.records, 'new', true)), [plain(result.records[1])]);
  assert.deepEqual(plain(gitRowRecords(result.records, 'omitted', true)), [plain(result.records[3])]);
  assert.equal(gitRecordText(result.records[0]), 'Reported untracked ancestor directory: parent/. Covers this project; individual file statuses are not reported.');
  assert.equal(gitRecordText(result.records[1]), 'new/ — Untracked directory; contents not individually reported (Git code: ??).');
  assert.equal(gitRecordText(result.records[2]), 'gone — Deleted (Git code: D). Reported path; no file-open action.');
});

test('pure validation rejects malformed records even outside the project before a false zero', () => {
  const invalid = [null, {}, { path: 'outside/file', status: null },
    ...['', ' ', ' M', 'M ', 'ZZ', 'U', 'MU', '???', 'MMM', '!!', 'm'].map(status => ({ path: 'outside/file', status })),
    ...['', '/', '/absolute', '../escape', './file', 'a/../file', 'a//file', 'a\\file', 'C:/file', 'a\0file', 'a\nfile', 'a\x7ffile'].map(path => ({ path, status: 'M' })),
    { path: 'outside/dir/', status: 'M' }, { path: 'project/', status: 'M' }];
  for (const entry of invalid) assert.deepEqual(plain(projectGitStatus(snapshot([entry], 'project/'))), { state: 'unavailable' }, JSON.stringify(entry));
});

test('pure duplicate records count once and conflicts invalidate even out of scope', () => {
  const duplicate = snapshot([{ path: 'same', status: 'AD' }, { path: 'same', status: 'AD' }]);
  const result = projectGitStatus(duplicate);
  assert.equal(result.records.length, 1);
  assert.deepEqual(plain(gitCounts(result.records)), [{ letter: 'D', count: 1 }]);
  for (const projectPrefix of ['', 'project/']) assert.deepEqual(plain(projectGitStatus(snapshot([
    { path: 'outside/file', status: 'A' }, { path: 'outside/file', status: 'M' },
  ], projectPrefix))), { state: 'unavailable' });
});

test('pure root and ancestor sets use M A D ? order and one winning count per record', () => {
  const result = projectGitStatus(snapshot([{ path: 'src/a', status: '??' }, { path: 'src/b', status: 'AD' },
    { path: 'src/c', status: 'A' }, { path: 'src/d', status: 'RM' }, { path: 'src/e', status: 'UU' },
    { path: 'src-other/f', status: 'M' }]));
  freeze(result.records);
  assert.deepEqual(plain(gitCounts(result.records)), [{ letter: 'M', count: 3 }, { letter: 'A', count: 1 }, { letter: 'D', count: 1 }, { letter: '?', count: 1 }]);
  assert.deepEqual(plain(gitCounts(gitRowRecords(result.records, 'src', true))), [{ letter: 'M', count: 2 }, { letter: 'A', count: 1 }, { letter: 'D', count: 1 }, { letter: '?', count: 1 }]);
  assert.deepEqual(plain(gitRowRecords(result.records, 'src/d', false)), [plain(result.records[3])]);
  assert.equal(gitRecordText(result.records[3]), 'src/d — Renamed; destination only; Modified (Git code: RM).');
  assert.deepEqual(plain(gitCounts([])), []);
});

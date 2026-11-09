const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ts = require('typescript');
const core = require('../electron/core.cjs');
const features = require('../electron/features.cjs');
const { mountEditorPanel } = require('./helpers/editor-panel-harness.cjs');

// Selected contract: the ONLY missing-file response is { missing: true }.
// It carries no content/revision and is accepted only by diff's initial read.
const missing = { missing: true };
const head = 'committed HEAD 分支\n';
const connection = { id: 'disposable-deleted-diff', kind: 'local' };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hrig-deleted-diff-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'empty-git-config'), '');
  await fs.mkdir(path.join(root, 'empty-hooks'));
  // core.original inherits process.env. Isolate its Git config too; restore
  // every changed key after this serial test. Never inspect the owner's config.
  const isolated = { GIT_CONFIG_GLOBAL: path.join(root, 'empty-git-config'),
    GIT_CONFIG_SYSTEM: path.join(root, 'empty-git-config'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Disposable test', GIT_AUTHOR_EMAIL: 'disposable@example.invalid',
    GIT_COMMITTER_NAME: 'Disposable test', GIT_COMMITTER_EMAIL: 'disposable@example.invalid',
    GIT_CONFIG_PARAMETERS: undefined, GIT_DIR: undefined, GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined,
    GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined };
  const previous = new Map(Object.keys(isolated).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(isolated)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const git = args => {
    const result = spawnSync('git', ['-C', root, '-c', 'user.name=Disposable test',
      '-c', 'user.email=disposable@example.invalid', '-c', 'commit.gpgSign=false',
      '-c', `core.hooksPath=${path.join(root, 'empty-hooks')}`, ...args], {
      env: { ...process.env }, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `disposable Git setup: ${result.stderr}`);
    return result.stdout;
  };
  git(['init', '--template=', '.']);
  await fs.writeFile(path.join(root, 'tracked.ts'), head);
  git(['add', '--', 'tracked.ts']);
  git(['commit', '-m', 'Disposable tracked file']);
  await fs.writeFile(path.join(root, 'empty.ts'), '');
  await fs.writeFile(path.join(root, 'binary.ts'), Buffer.from([65, 0, 66]));
  await fs.writeFile(path.join(root, 'large.ts'), Buffer.alloc(2000001, 65));
  await fs.writeFile(path.join(root, 'permission.ts'), 'synthetic denied file');
  return { root, git, config: { connection, root, path: 'tracked.ts' } };
}

function mounted(t, config, diff = true) {
  const view = mountEditorPanel({ config, props: { diff } });
  t.after(() => view.unmount());
  return view;
}
async function outcome(run) {
  try { return { value: await run() }; }
  catch (error) { return { error }; }
}
async function deliver(view, index, result) {
  // Treat an actual baseline backend refusal as data, not an unhandled test
  // setup error. Never infer absence from its message or manufacture a marker.
  if (result.error) await view.reject(index, result.error);
  else await view.resolve(index, result.value);
}
async function dispatch(view, index) {
  const { owner, request } = view.requests[index];
  assert.equal(owner, view.props.config.connection);
  assert.equal(request.root, view.props.config.root);
  assert.equal(request.path, view.props.config.path);
  const result = await outcome(() => request.op === 'original'
    ? core.fileOperation(owner, request) : features.edit(owner, request));
  await deliver(view, index, result);
  return result;
}

test('deleted tracked file diff uses confirmed missing disk content and real HEAD', async t => {
  const { root, config } = await fixture(t);
  const read = extra => features.edit(connection, { op: 'read', root, path: 'tracked.ts', ...extra });
  const existing = await read();
  assert.equal(existing.content, head);
  assert.equal(typeof existing.revision, 'string');
  assert.equal((await core.fileOperation(connection, { op: 'original', root, path: 'tracked.ts' })).content, head);
  const existingView = mounted(t, config);
  await dispatch(existingView, 0); await dispatch(existingView, 1);
  assert.equal(existingView.comparison().props.modified, head);
  assert.equal(existingView.comparison().props.original, head);
  const empty = mounted(t, { ...config, path: 'empty.ts' });
  await dispatch(empty, 0); await dispatch(empty, 1);
  assert.equal(empty.comparison().props.modified, '', 'real empty file remains successful content');
  for (const filename of ['binary.ts', 'large.ts', '.']) {
    await assert.rejects(() => read({ path: filename, allowMissing: true }),
      undefined, `${filename} must remain a nonmissing failure`);
  }
  const actualReadFile = fs.readFile;
  const denied = Object.assign(Error('Permission denied; ENOENT text is not a missing-file code'), { code: 'EACCES' });
  try {
    fs.readFile = async (filename, ...args) => {
      if (filename === path.join(root, 'permission.ts')) throw denied;
      return actualReadFile(filename, ...args);
    };
    await assert.rejects(() => read({ path: 'permission.ts', allowMissing: true }),
      error => error === denied, 'actual local edit propagates typed permission failure unchanged');
  } finally { fs.readFile = actualReadFile; }
  await assert.rejects(() => read({ path: '../outside.ts', allowMissing: true }));
  await assert.rejects(() => read({ root: path.join(root, 'absent-root'), allowMissing: true }));
  await assert.rejects(() => read({ path: 'absent-parent/file.ts', allowMissing: true }),
    undefined, 'missing parent is not a confirmed missing file in an existing folder');
  await fs.unlink(path.join(root, 'tracked.ts'));
  await assert.rejects(() => read(), undefined, 'ordinary missing editor read still refuses');
  const ordinary = mounted(t, config, false);
  assert.equal(ordinary.requests[0].request.allowMissing, undefined);
  await dispatch(ordinary, 0);
  assert.ok(!ordinary.editor());
  assert.ok(ordinary.nodes().some(node => node.type === 'error-box'));
  assert.equal(ordinary.buffer(), undefined);
  const deleted = mounted(t, config);
  assert.equal(deleted.requests[0].request.op, 'read');
  assert.equal(deleted.requests[1].request.op, 'original');
  const disk = await dispatch(deleted, 0);
  const original = await dispatch(deleted, 1);
  assert.equal(original.value.content, head, 'deleted tracked path still resolves real HEAD');
  t.diagnostic('Real existing read/HEAD, mounted diff, empty file, nonmissing refusals and ordinary deleted read controls executed.');
  // Intended semantic RED at 80163e0: actual captured diff read refuses the
  // deleted file. Its caught error is compared as data at this exact assertion.
  assert.deepEqual(disk.error ? { backendRefused: true } : disk.value, missing,
    'diff initial read must return confirmed missing disk content rather than refuse a deleted tracked file');
  assert.equal(deleted.requests[0].request.allowMissing, true, 'only diff initial read opts in');
  assert.equal(deleted.comparison().props.original, head);
  assert.equal(deleted.comparison().props.modified, '');
  assert.equal(deleted.comparison().props.options.readOnly, true);
  assert.equal(deleted.buffer(), undefined, 'diff never seeds an editable buffer or save revision');
  assert.equal(deleted.draftCalls.filter(call => call.op !== 'list').length, 0);
  assert.equal(deleted.requests.length, 2, 'no recovery read/save/fallback');
  await assert.rejects(() => read({ allowMissing: 'true' }), undefined, 'local opt-in must be typed boolean true');
  await assert.rejects(() => fs.stat(path.join(root, 'tracked.ts')), { code: 'ENOENT' });
});

test('diff consumer refuses nonmissing errors and malformed missing responses', async t => {
  const config = { connection, root: '/synthetic', path: 'tracked.ts' };
  for (const message of ['Permission denied', 'Binary files cannot be edited', 'File exceeds 2 MB',
    'ENOENT mentioned by an untyped IPC failure']) {
    const view = mounted(t, config);
    await view.reject(0, Error(message)); await view.resolve(1, { content: head });
    assert.ok(!view.comparison(), 'untyped IPC failure never means empty disk');
    assert.ok(view.visibleText().includes(message));
  }
  // These shapes exercise the real consumer, not a duplicate validator.
  for (const response of [null, {}, { missing: false }, { missing: 'true' },
    { missing: true, content: 'untrusted' }, { missing: true, revision: 'invented' },
    { missing: true, truncated: true }, { content: '', revision: 'partial', truncated: true }]) {
    const view = mounted(t, config);
    await view.resolve(0, response); await view.resolve(1, { content: head });
    assert.ok(!view.comparison(), `invalid diff response: ${JSON.stringify(response)}`);
    assert.ok(view.nodes().some(node => node.type === 'error-box'));
  }
  const accepted = mounted(t, config);
  await accepted.resolve(0, missing); await accepted.resolve(1, { content: head });
  assert.equal(accepted.comparison()?.props.modified, '', 'closed missing marker is accepted by diff opening');
  assert.equal(accepted.comparison().props.original, head);
});

test('ordinary opening and confirmed reload reject missing markers without replacing edits', async t => {
  const config = { connection, root: '/synthetic', path: 'tracked.ts' };
  const opening = mounted(t, config, false);
  await opening.resolve(0, missing);
  assert.ok(!opening.editor()); assert.equal(opening.buffer(), undefined);
  const view = mounted(t, config, false);
  await view.resolve(0, { content: head, revision: 'original' });
  view.type('unsaved local'); view.focusWindow();
  assert.equal(view.requests[1].request.allowMissing, undefined);
  await view.resolve(1, { content: 'observed disk', revision: 'external' });
  const before = JSON.stringify(view.buffer()), drafts = view.draftBytes();
  view.click('Reload from disk'); view.click('Discard edits and reload');
  assert.equal(view.requests[2].request.allowMissing, undefined);
  await view.resolve(2, missing);
  assert.equal(JSON.stringify(view.buffer()), before);
  assert.equal(view.draftBytes(), drafts);
  assert.equal(view.editor().props.value, 'unsaved local');
  assert.ok(view.visibleText().includes('Your edits are preserved.'));
  assert.equal(view.requests.filter(entry => entry.request.op === 'save').length, 0);
});

test('actual EDIT_PY confirms only missing file reads and preserves strict failure parity', async t => {
  const { root } = await fixture(t);
  const source = await fs.readFile(path.join(__dirname, '../electron/features.cjs'), 'utf8');
  const ast = ts.createSourceFile('features.cjs', source, ts.ScriptTarget.Latest, true);
  let program;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'EDIT_PY')
      program = vm.runInNewContext(node.initializer.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(typeof program, 'string', 'extract actual installed-in-checkout literal, never a cloned implementation');
  // Permission is injected at the file-open boundary so this is deterministic
  // even under a privileged test runner. The production Python literal stays
  // intact and must propagate PermissionError rather than infer missingness.
  const deniedOpen = `import builtins,os
_actual_open=builtins.open
def _denied_open(p,*args,**kwargs):
 if os.path.basename(p)=='permission.ts': raise PermissionError('synthetic denied open')
 return _actual_open(p,*args,**kwargs)
builtins.open=_denied_open
`;
  const run = (extra, deny = false) => {
    const result = spawnSync('python3', ['-c', (deny ? deniedOpen : '') + program], {
      input: JSON.stringify({ op: 'read', root, path: 'tracked.ts', ...extra }),
      env: { PATH: process.env.PATH, PYTHONNOUSERSITE: '1' },
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error); assert.equal(result.signal, null);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  assert.equal(JSON.parse(run({}).stdout).content, head);
  assert.equal(JSON.parse(run({ path: 'empty.ts', allowMissing: true }).stdout).content, '');
  for (const filename of ['binary.ts', 'large.ts', '.', '../outside.ts'])
    assert.notEqual(run({ path: filename, allowMissing: true }).status, 0, 'nonmissing failure stays an error');
  const denied = run({ path: 'permission.ts', allowMissing: true }, true);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /PermissionError/, 'actual Python must propagate a nonmissing file-open failure');
  assert.notEqual(run({ root: path.join(root, 'absent-root'), allowMissing: true }).status, 0);
  assert.notEqual(run({ path: 'absent-parent/file.ts', allowMissing: true }).status, 0);
  await fs.unlink(path.join(root, 'tracked.ts'));
  assert.notEqual(run({}).status, 0, 'ordinary missing Python read refuses');
  const result = run({ allowMissing: true });
  t.diagnostic('Actual extracted EDIT_PY existing, empty, nonmissing failure and strict missing controls executed.');
  assert.deepEqual(result.status === 0 ? JSON.parse(result.stdout) : { backendRefused: true }, missing,
    'actual EDIT_PY diff opt-in must return only the confirmed missing marker');
  assert.notEqual(run({ allowMissing: 'true' }).status, 0, 'opt-in must be typed boolean true');
});

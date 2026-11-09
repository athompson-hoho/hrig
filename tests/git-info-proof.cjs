const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const cwd = path.resolve(__dirname, '..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd), 'run from checkout root');
const gsdTools = path.join(os.homedir(), '.codex/gsd-core/bin/gsd-tools.cjs');
const lib = name => require(path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`));
const { parseMustHavesBlock } = lib('frontmatter');
const { projectProhibitions } = lib('probe-core');
const { descriptorFromProjection, buildNodeTestArgs, parseNodeTestSummary,
  tapTestNames, tapFailedTestNames, isNonVacuousNodeTestPass } = lib('prohibition-enforcement');
const phase = '.planning/phases/14-e03-branch-indicator-with-ahead-behind-in-status-bar';
const planPath = `${phase}/14-02-PLAN.md`;
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
assert.equal(items.length, 1);
const prohibition = items.find(item => item.verification === 'test');
assert.equal(prohibition.statement, 'MUST NOT turn the informational status-bar Git snapshot into implicit Git network or mutation operations, seat/shell input, terminal lifecycle actions, editor/buffer writes, or navigation; only the existing explicit Source control button may open Changes.');
assert.equal(prohibition.status, 'resolved');
const descriptor = descriptorFromProjection(prohibition);
assert.deepEqual(descriptor, { kind: 'node-test', target: 'tests/git-info-prohibition.test.cjs',
  violationFixture: 'tests/fixtures/git-info-bad.cjs', cleanFixture: 'tests/fixtures/git-info-clean.cjs' });
const targetTest = 'Git metadata preserves informational authority through actual core and App';
const assertion = 'authority: metadata must not invoke forbidden API effects (including git fetch)';
const failures = [];
function assess(label, check) {
  try { check(); return { passed: true }; }
  catch (error) { failures.push(label); return { passed: false, error: error.message }; }
}
function run(args, subject, timeout = 60000) {
  // Fixed inert environment; never copy the caller's environment or owner data.
  const env = { PATH: '/usr/bin:/bin' };
  if (subject) env.GSD_PROHIB_SUBJECT = subject;
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { command: [process.execPath, ...args], subject: subject || null,
    exitCode: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '',
    error: result.error ? { code: result.error.code, message: result.error.message } : null };
}
function inspect(report, bad, label) {
  report.summary = parseNodeTestSummary(report.stdout);
  report.assessment = assess(label, () => {
    assert.equal(report.error, null, 'no spawn error or timeout');
    assert.equal(report.signal, null);
    assert.deepEqual(tapTestNames(report.stdout), [targetTest], 'exact substantive named target must execute');
    assert.match(report.stdout, /^1\.\.1$/m);
    assert.match(report.stdout, /^# skipped 0$/m);
    assert.match(report.stdout, /^# todo 0$/m);
    if (bad) {
      assert.notEqual(report.exitCode, null);
      assert.notEqual(report.exitCode, 0);
      assert.deepEqual(tapFailedTestNames(report.stdout), [targetTest]);
      assert.deepEqual(report.summary, { tests: 1, pass: 0, fail: 1, cancelled: 0 });
      assert.match(report.stdout, /code: 'ERR_ASSERTION'/);
      assert.ok(report.stdout.includes(assertion), 'actual authority assertion must fail');
      assert.match(report.stdout, /gitFetch/);
      assert.match(report.stdout, /Actual core metadata, current App branch/);
    } else {
      assert.equal(report.exitCode, 0);
      assert.equal(isNonVacuousNodeTestPass(report.stdout, descriptor.target), true);
      assert.deepEqual(report.summary, { tests: 1, pass: 1, fail: 0, cancelled: 0 });
    }
  });
  return report;
}
const identity = run([gsdTools, 'runtime-identity', '--raw']);
identity.assessment = assess('installed-identity', () => {
  assert.equal(identity.error, null);
  assert.equal(identity.exitCode, 0);
  assert.equal(JSON.parse(identity.stdout).packageName, '@opengsd/gsd-core');
});
const observations = {};
// Canonical arguments are used unchanged. Diagnostic evidence cannot upgrade
// an unavailable native runner or substitute for the independent producer.
for (const [control, subject] of [['bad', descriptor.violationFixture],
  ['clean', descriptor.cleanFixture], ['actual', undefined]]) {
  observations[control] = inspect(run(buildNodeTestArgs(descriptor), subject), control === 'bad', control);
}
const producer = run([gsdTools, 'check', 'prohibition-enforcement', '--json',
  JSON.stringify({ prohibition, check: descriptor, mode: 'autonomous' }), '--raw'], undefined, 120000);
producer.assessment = assess('installed-producer', () => {
  assert.equal(producer.error, null);
  assert.equal(producer.signal, null);
  assert.equal(producer.exitCode, 0);
  const payload = producer.payload = JSON.parse(producer.stdout);
  assert.equal(payload.status, 'green');
  assert.equal(payload.flagged, false);
  assert.equal(payload.tier, 'test');
  assert.equal(payload.located, true);
  assert.equal(payload.kind, 'node-test');
  assert.ok(payload.evidence.some(item => item.target === descriptor.target && item.kind === 'node-test'
    && item.failFirst === true && item.passed === true && item.failFirstProof === 'violation-fixture'));
});
// Every locally executed module is fingerprinted, including recursively loaded renderer dependencies.
const semantic = new Set([planPath, 'NAVIGATION.md', 'electron/core.cjs',
  'src/App.tsx', 'src/GitInfoStatus.tsx', 'src/git-info.ts', 'src/file-tree.ts',
  'tests/git-info-api.test.cjs', 'tests/git-info-app.test.cjs', 'tests/helpers/virtual-list-harness.cjs',
  descriptor.target, descriptor.violationFixture, descriptor.cleanFixture, 'tests/git-info-proof.cjs']);
function dependencies(file) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:require\(['"]|from\s+['"])(\.[^'"]+)/g)) {
    const base = path.resolve(path.dirname(file), match[1]);
    const resolved = [base, base + '.cjs', base + '.ts', base + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (resolved) { const relative = path.relative(cwd, resolved);
      if (!semantic.has(relative)) { semantic.add(relative); dependencies(relative); }
    }
  }
}
for (const file of [...semantic]) dependencies(file);
const files = [...semantic].sort();
const fingerprints = Object.fromEntries(files.map(file =>
  [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const evidencePath = `${phase}/14-02-ENFORCEMENT-EVIDENCE.json`;
// Retain earlier authentic attempts separately when regenerating the receipt.
if (fs.existsSync(evidencePath)) fs.copyFileSync(evidencePath,
  evidencePath.replace('.json', '-' + Date.now() + '.json'));
fs.writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), planPath,
  targetTest, prohibition, descriptor, assertion, fingerprints, identity, observations, producer, installedFingerprints: Object.fromEntries([gsdTools, ...fs.readdirSync(path.join(path.dirname(gsdTools), 'lib')).filter(name => name.endsWith('.cjs')).map(name => name.slice(0, -4)).map(name => path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`))].map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  status: failures.length === 0 ? "GREEN" : "UNVERIFIED", passed: failures.length === 0, failures, native: 'unobserved', performance: 'unmeasured' }, null, 2)}\n`);
assert.equal(failures.length, 0, `Proof incomplete (${failures.join(', ')}); inspect ${evidencePath}. No producer success inferred.`);
console.log(`Installed producer independently passed bad/clean/actual proof; ${evidencePath}`);

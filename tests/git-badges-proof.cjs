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
const phase = '.planning/phases/13-e02-git-status-badges-in-file-tree-m-a-d';
const planPath = `${phase}/13-02-PLAN.md`;
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
assert.equal(items.length, 1);
const prohibition = items.find(item => item.verification === 'test');
assert.equal(prohibition.statement, 'MUST NOT let informational Git badges apply obsolete or foreign endpoint-root snapshots, refetch Git when filtering/Clearing/expanding/Reveal is exercised, submit shell/seat input, mutate files/editor selection/buffers, or invoke lifecycle actions; explicit file clicks may only open their current captured target.');
assert.equal(prohibition.status, 'resolved');
const descriptor = descriptorFromProjection(prohibition);
assert.deepEqual(descriptor, { kind: 'node-test', target: 'tests/git-badges-prohibition.test.cjs',
  violationFixture: 'tests/fixtures/git-badges-bad.cjs', cleanFixture: 'tests/fixtures/git-badges-clean.cjs' });
const targetTest = 'Git badges preserve current-owner authority without navigation refetch or side effects';
const assertion = 'authority: navigation must not refetch Git';
const failures = [];
function assess(label, check) {
  try { check(); return { passed: true }; }
  catch (error) { failures.push(label); return { passed: false, error: error.message }; }
}
function run(args, subject) {
  // Fixed inert environment; never copy the caller's environment or owner data.
  const env = { PATH: '/usr/bin:/bin' };
  if (subject) env.GSD_PROHIB_SUBJECT = subject;
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 45000,
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
      assert.match(report.stdout, /operator: 'strictEqual'/);
      assert.match(report.stdout, /expected: 1/);
      assert.match(report.stdout, /actual: 2/);
      assert.match(report.stdout, /Actual Sidebar rows M\/A\/D\/\?/);
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
  JSON.stringify({ prohibition, check: descriptor, mode: 'autonomous' }), '--raw']);
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
const files = [planPath, `${phase}/13-01-PLAN.md`, 'NAVIGATION.md', 'electron/core.cjs', 'src/types.ts', 'src/styles.css', 'src/git-badges.ts',
  'tests/git-badges-consumer.test.cjs', 'tests/git-badges-api.test.cjs', 'tests/git-badges.test.cjs', 'tests/file-explorer-prohibition.test.cjs',
  'tests/file-explorer-proof.cjs', 'tests/fixtures/file-explorer-bad.cjs', 'tests/fixtures/file-explorer-clean.cjs', 'src/App.tsx', 'src/Sidebar.tsx', 'src/FileExplorer.tsx', 'src/file-tree.ts',
  'src/editor-buffers.ts', 'src/components.tsx', 'src/seat-pins.ts', 'src/seat-pods.ts', 'src/seat-sort.ts',
  'src/VirtualList.tsx', 'src/virtual-range.ts', 'src/inventory-health.ts', 'src/seat-search.ts', 'src/seat-status.ts',
  'tests/file-explorer.test.cjs', 'tests/file-explorer-app.test.cjs', 'tests/helpers/virtual-list-harness.cjs',
  descriptor.target, descriptor.violationFixture, descriptor.cleanFixture, 'tests/git-badges-proof.cjs'];
const fingerprints = Object.fromEntries(files.map(file =>
  [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const evidencePath = `${phase}/13-02-ENFORCEMENT-EVIDENCE.json`;
fs.writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), planPath,
  targetTest, prohibition, descriptor, assertion, fingerprints, identity, observations, producer, installedFingerprints: Object.fromEntries([gsdTools, ...['frontmatter', 'probe-core', 'prohibition-enforcement'].map(name => path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`))].map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  status: failures.length === 0 ? "GREEN" : "UNVERIFIED", passed: failures.length === 0, failures, native: 'unobserved', performance: 'unmeasured' }, null, 2)}\n`);
assert.equal(failures.length, 0, `Proof incomplete (${failures.join(', ')}); inspect ${evidencePath}. No producer success inferred.`);
console.log(`Installed producer independently passed bad/clean/actual proof; ${evidencePath}`);

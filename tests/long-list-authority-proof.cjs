const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const cwd = path.resolve(__dirname, '..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd), 'run from checkout root');
const gsdTools = path.join(os.homedir(), '.codex/gsd-core/bin/gsd-tools.cjs');
assert.ok(fs.existsSync(gsdTools), 'installed canonical GSD CLI required');
const lib = name => require(path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`));
const { parseMustHavesBlock } = lib('frontmatter');
const { projectProhibitions } = lib('probe-core');
const { descriptorFromProjection, parseNodeTestSummary, tapTestNames, tapFailedTestNames,
  isNonVacuousNodeTestPass, buildNodeTestArgs } = lib('prohibition-enforcement');
const phase = '.planning/phases/09-x02-virtualize-long-inventory-search-result-and-task-lists';
const planPath = `${phase}/09-03-PLAN.md`;
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
assert.equal(items.length, 1, '09-03 owns exactly one navigation authority prohibition');
const prohibition = items[0];
assert.equal(prohibition.status, 'resolved');
assert.equal(prohibition.verification, 'test');
const descriptor = descriptorFromProjection(prohibition);
assert.deepEqual(descriptor, { kind: 'node-test', target: 'tests/long-list-authority.test.cjs',
  violationFixture: 'tests/fixtures/long-list-authority-bad.cjs', cleanFixture: 'tests/fixtures/long-list-authority-clean.cjs' });
const targetTest = 'long-list navigation preserves explicit action authority';
const assertion = 'authority: navigation adds no consumer or host effects';
const failures = [];
function assess(label, check) {
  try { check(); return { passed: true }; }
  catch (error) { failures.push(label); return { passed: false, error: error.message }; }
}
function run(args, subject) {
  // Fixed inert environment also bounds what the installed producer passes to
  // its own children. Never capture an owner's environment or credentials.
  const env = { PATH: '/usr/bin:/bin' };
  if (subject) env.GSD_PROHIB_SUBJECT = subject;
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 30000,
    maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { command: [process.execPath, ...args], cwd, subject: subject || null,
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
      assert.notEqual(report.exitCode, null); assert.notEqual(report.exitCode, 0);
      assert.deepEqual(tapFailedTestNames(report.stdout), [targetTest]);
      assert.deepEqual(report.summary, { tests: 1, pass: 0, fail: 1, cancelled: 0 });
      assert.match(report.stdout, /code: 'ERR_ASSERTION'/);
      assert.ok(report.stdout.includes(assertion), 'relevant semantic assertion must fail');
      assert.match(report.stdout, /operator: 'deepStrictEqual'/);
      assert.ok(report.stdout.includes('refreshInventory'), 'observable forbidden action appears in failure');
    } else {
      assert.equal(report.exitCode, 0);
      assert.equal(isNonVacuousNodeTestPass(report.stdout, descriptor.target), true);
      assert.deepEqual(report.summary, { tests: 1, pass: 1, fail: 0, cancelled: 0 });
    }
  });
  return report;
}
const observations = {};
for (const [mode, args] of [['canonical', buildNodeTestArgs(descriptor)],
  ['diagnostic', ['--test', '--experimental-test-isolation=none', '--test-reporter=tap', '--', descriptor.target]]]) {
  observations[mode] = {};
  for (const [control, subject] of [['bad', descriptor.violationFixture], ['clean', descriptor.cleanFixture], ['actual', undefined]]) {
    observations[mode][control] = inspect(run(args, subject), control === 'bad', `${mode}:${control}`);
  }
}
// Independent installed producer invocation: supplemental reports never set
// this verdict and no injected runner replaces its real bad/clean/actual runs.
const producer = run([gsdTools, 'check', 'prohibition-enforcement', '--json',
  JSON.stringify({ prohibition, check: descriptor, mode: 'autonomous' }), '--raw']);
producer.assessment = assess('installed-producer', () => {
  assert.equal(producer.error, null); assert.equal(producer.signal, null); assert.equal(producer.exitCode, 0);
  const payload = producer.payload = JSON.parse(producer.stdout);
  assert.equal(payload.status, 'green'); assert.equal(payload.flagged, false);
  assert.equal(payload.tier, 'test'); assert.equal(payload.located, true); assert.equal(payload.kind, 'node-test');
  assert.ok(payload.evidence.some(e => e.target === descriptor.target && e.kind === 'node-test'
    && e.failFirst === true && e.passed === true && e.failFirstProof === 'violation-fixture'));
});
const git = args => {
  const result = spawnSync('git', args, { cwd, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, 'read-only candidate identity'); return result.stdout.trim();
};
const files = [planPath, 'src/virtual-range.ts', 'src/VirtualList.tsx', 'src/Sidebar.tsx', 'src/WorkbenchPanels.tsx',
  'src/TaskBoard.tsx', 'src/styles.css', 'tests/helpers/virtual-list-harness.cjs', descriptor.target,
  descriptor.violationFixture, descriptor.cleanFixture, 'tests/long-list-authority-proof.cjs', 'NAVIGATION.md'];
const candidate = { head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  status: git(['status', '--short']), sha256: Object.fromEntries(files.map(file =>
    [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) };
const evidencePath = `${phase}/09-03-ENFORCEMENT-EVIDENCE.json`;
fs.writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), candidate, planPath, targetTest,
  prohibition, descriptor, assertion, observations, producer, passed: failures.length === 0, failures,
  native: 'unobserved', performance: 'unmeasured' }, null, 2)}\n`);
assert.equal(failures.length, 0, `Proof incomplete (${failures.join(', ')}); inspect ${evidencePath}. No producer success inferred from diagnostic runs.`);
console.log(`Installed producer independently passed bad/clean/actual proof; ${evidencePath}`);

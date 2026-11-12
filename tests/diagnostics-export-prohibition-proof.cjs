const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cwd = path.resolve(__dirname, '..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd), 'run from checkout root');
const gsdTools = path.join(os.homedir(), '.codex/gsd-core/bin/gsd-tools.cjs');
assert.ok(fs.existsSync(gsdTools), 'installed canonical GSD CLI required');
const lib = name => require(path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`));
const { parseMustHavesBlock } = lib('frontmatter');
const { projectProhibitions } = lib('probe-core');
const { descriptorFromProjection, parseNodeTestSummary, tapTestNames,
  tapFailedTestNames, isNonVacuousNodeTestPass, buildNodeTestArgs } = lib('prohibition-enforcement');
const phase = '.planning/phases/08-x01-redacted-diagnostics-bundle-export';
const planPath = `${phase}/08-02-PLAN.md`;
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
assert.equal(items.length, 2, '08-02 is the canonical owner of both obligations');
const targetTest = 'diagnostics export preserves finite projection and explicit local authority';
const failures = [];
function assess(label, check) {
  try { check(); return { passed: true }; }
  catch (error) { failures.push(label); return { passed: false, error: error.message }; }
}
function run(args, subject) {
  // No inherited environment capture. The producer inherits only this fixed
  // environment, so its own childEnv copies no owner credentials or profile.
  const env = { PATH: '/usr/bin:/bin' };
  if (subject) env.GSD_PROHIB_SUBJECT = subject;
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8',
    timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { command: [process.execPath, ...args], cwd, subject: subject || null,
    exitCode: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '',
    error: result.error ? { code: result.error.code, message: result.error.message } : null };
}
function inspect(report, descriptor, bad, assertion, label) {
  report.summary = parseNodeTestSummary(report.stdout);
  report.assessment = assess(label, () => {
    assert.equal(report.error, null, 'no spawn error or timeout');
    assert.equal(report.signal, null);
    assert.deepEqual(tapTestNames(report.stdout), [targetTest], 'exact substantive named test must execute');
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
      assert.ok(report.stdout.includes(assertion.startsWith('privacy:') ? 'SYNTHETIC_PRIVATE_CANARY' : 'refreshInventory'),
        'observed forbidden content or effect must appear in assertion evidence');
    } else {
      assert.equal(report.exitCode, 0);
      assert.equal(isNonVacuousNodeTestPass(report.stdout, descriptor.target), true);
      assert.deepEqual(report.summary, { tests: 1, pass: 1, fail: 0, cancelled: 0 });
    }
  });
  return report;
}
const obligations = items.map((prohibition, index) => {
  assert.equal(prohibition.status, 'resolved'); assert.equal(prohibition.verification, 'test');
  const descriptor = descriptorFromProjection(prohibition);
  assert.deepEqual(descriptor, { kind: 'node-test', target: 'tests/diagnostics-export-prohibition.test.cjs',
    violationFixture: `tests/fixtures/diagnostics-export-prohibition-${index === 0 ? 'privacy' : 'authority'}-bad.cjs`,
    cleanFixture: 'tests/fixtures/diagnostics-export-prohibition-clean.cjs' });
  const assertion = index === 0 ? 'privacy: exported request bytes and new notices exclude synthetic private content'
    : 'authority: export adds no forbidden effects or arguments';
  const args = buildNodeTestArgs(descriptor);
  const observations = {};
  // Preserve exact producer-compatible reports AND supplemental named reports.
  // Supplemental success never replaces the installed producer's own verdict.
  for (const [mode, command] of [['canonical', args],
    ['diagnostic', ['--test', '--experimental-test-isolation=none', '--test-reporter=tap', '--', descriptor.target]]]) {
    observations[mode] = {};
    for (const [control, subject] of [['bad', descriptor.violationFixture], ['clean', descriptor.cleanFixture], ['actual', undefined]]) {
      observations[mode][control] = inspect(run(command, subject), descriptor, control === 'bad', assertion, `${index}:${mode}:${control}`);
    }
  }
  const request = { prohibition, check: descriptor, mode: 'autonomous' };
  const producer = run([gsdTools, 'check', 'prohibition-enforcement', '--json', JSON.stringify(request), '--raw']);
  producer.assessment = assess(`${index}:installed-producer`, () => {
    assert.equal(producer.error, null); assert.equal(producer.signal, null); assert.equal(producer.exitCode, 0);
    const payload = producer.payload = JSON.parse(producer.stdout);
    assert.equal(payload.status, 'green'); assert.equal(payload.flagged, false);
    assert.equal(payload.tier, 'test'); assert.equal(payload.located, true); assert.equal(payload.kind, 'node-test');
    assert.ok(payload.evidence.some(e => e.target === descriptor.target && e.kind === 'node-test'
      && e.failFirst === true && e.passed === true && e.failFirstProof === 'violation-fixture'));
  });
  return { prohibition, descriptor, assertion, observations, producer };
});
const evidencePath = `${phase}/08-02-ENFORCEMENT-EVIDENCE.json`;
fs.writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), planPath, targetTest,
  obligations, passed: failures.length === 0, failures, native: 'unobserved' }, null, 2)}\n`);
assert.equal(failures.length, 0, `Proof incomplete (${failures.join(', ')}); inspect ${evidencePath}. No producer success inferred from diagnostic runs.`);
console.log(`Both installed producers independently passed bad/clean/actual proof; ${evidencePath}`);

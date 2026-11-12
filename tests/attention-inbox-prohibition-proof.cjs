const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const cwd = path.resolve(__dirname, '..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd), 'run from checkout root');
const gsdTools = path.resolve(process.env.GSD_TOOLS || path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'gsd-core/bin/gsd-tools.cjs'));
assert.ok(fs.existsSync(gsdTools), 'installed GSD_TOOLS CLI must exist');
const lib = name => require(path.join(path.dirname(gsdTools), 'lib', `${name}.cjs`));
const { parseMustHavesBlock } = lib('frontmatter');
const { projectProhibitions, dispositionForProhibition } = lib('probe-core');
const { descriptorFromProjection, parseNodeTestSummary, tapTestNames,
  tapFailedTestNames, isNonVacuousNodeTestPass } = lib('prohibition-enforcement');
const phase = '.planning/phases/06-r06-attention-inbox-list-of-every-seat-needing-input-with-ju';
const planPath = `${phase}/06-01-PLAN.md`;
const statement = 'MUST NOT let R06 inbox automatically open a target, submit seat or shell input, answer prompts, change lifecycle, refresh inventory, or acquire direct network or timer authority; only explicit validated existing open/focus and its established attachment/focus-frame behavior are allowed. MUST NOT automatically close, reset, replace or relaunch retained owner PTYs or sessions on refusal.';
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
const matching = items.filter(item => item.statement === statement);
assert.equal(matching.length, 1, 'original plan is the single canonical owner');
const prohibition = matching[0];
assert.equal(prohibition.status, 'resolved');
assert.equal(prohibition.verification, 'test');
const descriptor = descriptorFromProjection(prohibition);
assert.deepEqual(descriptor, {
  kind: 'node-test', target: 'tests/attention-inbox-prohibition.test.cjs',
  violationFixture: 'tests/fixtures/attention-inbox-prohibition-bad.cjs',
  cleanFixture: 'tests/fixtures/attention-inbox-prohibition-clean.cjs',
});
const targetTest = 'explicit Jump and retained refusal preserve bounded authority';
const assertion = 'bounded authority: no forbidden effects or arguments';
const failures = [];
function requireEvidence(description, verify) {
  try { verify(); return { passed: true, description }; }
  catch (error) {
    failures.push(`${description}: ${error.message}`);
    return { passed: false, description, error: error.message };
  }
}
function run(args, subject) {
  const env = { ...process.env };
  // Match the installed producer's environment hygiene, and never let an
  // ambient fixture substitute for actual source in the default runner.
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  delete env.GSD_PROHIB_SUBJECT;
  if (subject) env.GSD_PROHIB_SUBJECT = subject;
  const result = spawnSync(process.execPath, args, { cwd, env,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { command: [process.execPath, ...args], cwd,
    subject: subject || null, exitCode: result.status, signal: result.signal,
    stdout: result.stdout || '', stderr: result.stderr || '',
    error: result.error ? { code: result.error.code, message: result.error.message } : null };
}
function inspect(report, bad) {
  report.targetTest = targetTest;
  report.targetFile = descriptor.target;
  report.assertion = assertion;
  report.expected = [];
  // Observed values stay verbatim in TAP; never synthesize expected proof.
  report.actual = report.stdout.match(/^  actual:\n([\s\S]*?)(?=^  operator:)/m)?.[1] || null;
  report.summary = parseNodeTestSummary(report.stdout);
  report.semanticAssessment = requireEvidence(bad ? 'bad semantic assertion RED' : 'named nonvacuous GREEN', () => {
    assert.equal(report.error, null, 'no spawn error/timeout');
    assert.equal(report.signal, null);
    assert.deepEqual(tapTestNames(report.stdout), [targetTest], 'the exact named test must execute');
    assert.match(report.stdout, /^1\.\.1$/m, 'complete TAP plan');
    assert.match(report.stdout, /^# skipped 0$/m);
    assert.match(report.stdout, /^# todo 0$/m);
    if (bad) {
      assert.notEqual(report.exitCode, 0);
      assert.notEqual(report.exitCode, null);
      assert.deepEqual(tapFailedTestNames(report.stdout), [targetTest]);
      assert.deepEqual(report.summary, { tests: 1, pass: 0, fail: 1, cancelled: 0 });
      assert.match(report.stdout, /code: 'ERR_ASSERTION'/);
      assert.match(report.stdout, /bounded authority: no forbidden effects or arguments/);
      assert.match(report.stdout, /operator: 'deepStrictEqual'/);
      assert.ok(report.actual?.includes("name: 'refreshInventory'"), 'recorded host effect is the actual assertion value');
      assert.match(report.actual, /args:/);
    } else {
      assert.equal(report.exitCode, 0);
      assert.equal(isNonVacuousNodeTestPass(report.stdout, descriptor.target), true);
      assert.deepEqual(report.summary, { tests: 1, pass: 1, fail: 0, cancelled: 0 });
    }
  });
  return report;
}
const args = ['--test', '--test-reporter=tap', '--', descriptor.target];
const bad = inspect(run(args, descriptor.violationFixture), true);
const clean = inspect(run(args, descriptor.cleanFixture), false);
const actual = inspect(run(args), false);
// Diagnostic direct runs preserve assertion-level reports on hosts whose
// nested --test runner loses named TAP. They never authorize producer success.
const diagnosticDirect = {
  bad: inspect(run([descriptor.target], descriptor.violationFixture), true),
  clean: inspect(run([descriptor.target], descriptor.cleanFixture), false),
  actual: inspect(run([descriptor.target]), false),
};
// This is a real independent invocation: no injected prover/runner or evidence.
const request = { prohibition, check: descriptor, mode: 'autonomous' };
const producer = run([gsdTools, 'check', 'prohibition-enforcement', '--json', JSON.stringify(request), '--raw']);
producer.semanticAssessment = requireEvidence('installed independent producer machine proof', () => {
  assert.equal(producer.error, null);
  assert.equal(producer.exitCode, 0);
  producer.payload = JSON.parse(producer.stdout);
  const payload = producer.payload;
  assert.equal(payload.status, 'green');
  assert.equal(payload.flagged, false);
  assert.equal(payload.tier, 'test');
  assert.equal(payload.located, true);
  assert.equal(payload.kind, 'node-test');
  assert.ok(Array.isArray(payload.evidence) && payload.evidence.length > 0);
  assert.ok(payload.evidence.some(e => e.kind === 'node-test' && e.target === descriptor.target &&
    e.failFirst === true && e.passed === true && e.failFirstProof === 'violation-fixture'));
});
const evidence = { recordedAt: new Date().toISOString(), planPath, prohibition, descriptor,
  targetTest, bad, clean, actual, diagnosticDirect, producer,
  native: 'pending', restart: 'pending', independentReverification: 'pending',
  passed: failures.length === 0, failures };
const evidencePath = `${phase}/06-01-ENFORCEMENT-EVIDENCE.json`;
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`Bad RED, clean GREEN, actual GREEN and installed producer proof passed; ${evidencePath}`);

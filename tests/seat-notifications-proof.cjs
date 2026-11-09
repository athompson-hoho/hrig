const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const cwd = path.resolve(__dirname, '..');
assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd), 'run from checkout root');
const gsdTools = path.join(os.homedir(), '.codex/gsd-core/bin/gsd-tools.cjs');
const libRoot = path.join(path.dirname(gsdTools), 'lib');
const lib = name => require(path.join(libRoot, `${name}.cjs`));
const { parseMustHavesBlock } = lib('frontmatter');
const { projectProhibitions } = lib('probe-core');
const { descriptorFromProjection, buildNodeTestArgs, parseNodeTestSummary,
  tapTestNames, tapFailedTestNames, isNonVacuousNodeTestPass } = lib('prohibition-enforcement');
const phase = '.planning/phases/16-r08-desktop-notification-on-needs-input-opt-in-seat-name-onl';
const planPath = `${phase}/16-02-PLAN.md`;
const items = projectProhibitions(parseMustHavesBlock(fs.readFileSync(planPath, 'utf8'), 'prohibitions'));
assert.equal(items.length, 1);
const prohibition = items[0];
assert.equal(prohibition.statement, 'MUST NOT expose prompt, terminal text, activity, errors, rig/host/path or other metadata in a seat needs-input notification, or use that notification to open, send input, change lifecycle or start polling; only the accepted seat name may be supplied as native content.');
assert.equal(prohibition.status, 'resolved');
assert.equal(prohibition.verification, 'test');
const descriptor = descriptorFromProjection(prohibition);
assert.deepEqual(descriptor, { kind: 'node-test', target: 'tests/seat-notifications-prohibition.test.cjs',
  violationFixture: 'tests/fixtures/seat-notifications-bad.cjs',
  cleanFixture: 'tests/fixtures/seat-notifications-clean.cjs' });
const targetTest = 'Actual App notification chain preserves seat-only privacy and no action authority';
const assertion = 'R08 privacy: every native option is exact accepted seat name plus silent only';
const positive = 'Actual silent seed, useful App/preload/trusted native positive, recovery, default-off and current-owner controls executed.';
const complete = 'Independent exact all-options, name-only IPC and zero other action assertions executed.';
const directArgs = ['--test', '--test-concurrency=2', '--test-reporter=tap', '--', descriptor.target];
const canonicalArgs = ['--test', '--test-reporter=tap', '--', descriptor.target];
assert.deepEqual(buildNodeTestArgs(descriptor), canonicalArgs, 'installed canonical one-file argv remains unchanged');
const producerArgs = [gsdTools, 'check', 'prohibition-enforcement', '--json',
  JSON.stringify({ prohibition, check: descriptor, mode: 'autonomous' }), '--raw'];

// Root alone owns the fresh sole slot and actual foreign-process guard. This
// relay is required near launch, never inferred from source inspection/time.
// Canonical effective-one exception requires root's explicit disposition after
// inspecting the target/import closure; this file does not grant that exception.
if (process.env.GSD_R08_PROOF_AUTH !== 'root-sole-slot-foreign-empty') {
  console.error('HOLD: fresh root SOLE slot / foreign guard EMPTY / load1 < 8 relay required; no children or evidence written.');
  process.exit(2);
}
assert.ok(os.loadavg()[0] < 8, 'HOLD: current load1 must remain below 8');

const failures = [];
function assess(label, check) {
  try { check(); return { passed: true }; }
  catch (error) { failures.push(label); return { passed: false, error: error.message }; }
}
function run(args, subject, timeout = 60000) {
  assert.ok(os.loadavg()[0] < 8, 'HOLD: load1 must remain below 8 before each child');
  return new Promise(resolve => {
    // No caller credentials, NODE_OPTIONS, NODE_TEST_CONTEXT or ambient subject.
    // The authorization relay is not a canonical concurrency env workaround.
    const env = { PATH: '/usr/bin:/bin' };
    if (subject) env.GSD_PROHIB_SUBJECT = subject;
    const startedAt = new Date().toISOString();
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', error = null, timedOut = false, bytes = 0;
    const stop = () => {
      if (process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const collect = key => chunk => {
      bytes += chunk.length;
      if (key === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
      if (bytes > 4 * 1024 * 1024) { error = { message: 'output limit exceeded' }; stop(); }
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', e => { error = { code: e.code, message: e.message }; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ command: [process.execPath, ...args], cwd, subject: subject || null,
        startedAt, endedAt: new Date().toISOString(), exitCode, signal, stdout, stderr, error, timedOut });
    });
  });
}
function inspect(report, bad, label) {
  report.summary = parseNodeTestSummary(report.stdout);
  report.assessment = assess(label, () => {
    assert.equal(report.error, null); assert.equal(report.signal, null); assert.equal(report.timedOut, false);
    assert.deepEqual(tapTestNames(report.stdout), [targetTest]);
    assert.match(report.stdout, /^1\.\.1$/m);
    assert.match(report.stdout, /^# skipped 0$/m); assert.match(report.stdout, /^# todo 0$/m);
    assert.ok(report.stdout.includes(positive));
    if (bad) {
      assert.notEqual(report.exitCode, null); assert.notEqual(report.exitCode, 0);
      assert.deepEqual(tapFailedTestNames(report.stdout), [targetTest]);
      assert.deepEqual(report.summary, { tests: 1, pass: 0, fail: 1, cancelled: 0 });
      assert.match(report.stdout, /code: 'ERR_ASSERTION'/);
      assert.ok(report.stdout.includes(assertion));
      assert.ok(report.stdout.includes('SYNTHETIC_PRIVATE_BODY'), 'bad must expose the synthetic body at exact-options assertion');
      assert.ok(!report.stdout.includes(complete));
    } else {
      assert.equal(report.exitCode, 0);
      assert.equal(isNonVacuousNodeTestPass(report.stdout, descriptor.target), true);
      assert.deepEqual(report.summary, { tests: 1, pass: 1, fail: 0, cancelled: 0 });
      assert.ok(report.stdout.includes(complete));
    }
  });
  return report;
}

// Source-aware semantic closure: include whole actual App/native source files
// even though the harness executes only selected AST seams. Follow local imports,
// requires, VM loadLocal/source paths and installed relative requires. Conservatively
// include installed lib/ since the CLI dispatches some modules dynamically.
function fingerprints() {
  const files = new Set();
  function visit(file) {
    const absolute = fs.realpathSync(file);
    if (files.has(absolute)) return;
    files.add(absolute);
    const source = fs.readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/(?:require\(\s*['"]|from\s+['"]|import\(\s*['"])(\.[^'"]+)/g)) {
      const base = path.resolve(path.dirname(absolute), match[1]);
      const resolved = [base, `${base}.cjs`, `${base}.js`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`,
        path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (resolved) visit(resolved);
    }
    for (const match of source.matchAll(/\b(?:loadLocal|source|load)\(['"](src\/[^'"]+)['"]\)/g))
      visit(path.join(cwd, match[1]));
  }
  for (const file of [planPath, 'SETTINGS.md', 'NAVIGATION.md', 'PRIVACY.md',
    'src/App.tsx', 'src/seat-notifications.ts', 'src/seat-pins.ts', 'src/settings.ts', 'src/types.ts',
    'electron/preload.cjs', 'electron/main.cjs', 'electron/seat-notifications.cjs',
    'tests/seat-notifications-consumer.test.cjs', 'tests/seat-notifications-native.test.cjs',
    'tests/seat-notifications.test.cjs', descriptor.target, descriptor.violationFixture,
    descriptor.cleanFixture, 'tests/seat-notifications-proof.cjs']) visit(path.join(cwd, file));
  visit(require.resolve('typescript'));
  visit(gsdTools);
  for (const name of fs.readdirSync(libRoot)) if (name.endsWith('.cjs')) visit(path.join(libRoot, name));
  return Object.fromEntries([...files].sort().map(file => [file.startsWith(cwd + path.sep)
    ? path.relative(cwd, file) : file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}

async function main() {
  const before = fingerprints();
  const identity = await run([gsdTools, 'runtime-identity', '--raw']);
  identity.assessment = assess('installed-identity', () => {
    assert.equal(identity.error, null); assert.equal(identity.exitCode, 0);
    assert.equal(identity.signal, null); assert.equal(identity.timedOut, false);
    assert.equal(JSON.parse(identity.stdout).packageName, '@opengsd/gsd-core');
  });
  assert.ok(identity.assessment.passed, 'installed identity must pass before proof runners');
  const observations = {};
  // One awaited child at a time. Imported harnesses/fixtures have no child
  // process launches; their native.flush Promise.all drains inert IPC only.
  for (const [label, subject] of [['bad', descriptor.violationFixture],
    ['clean', descriptor.cleanFixture], ['actual', undefined]]) {
    observations[label] = inspect(await run(directArgs, subject), label === 'bad', label);
  }
  // Never consume producer capacity when a direct semantic control failed.
  let producer = null;
  if (failures.length === 0) {
    producer = await run(producerArgs, undefined, 120000);
    producer.assessment = assess('installed-producer', () => {
      assert.equal(producer.error, null); assert.equal(producer.signal, null);
      assert.equal(producer.timedOut, false); assert.equal(producer.exitCode, 0);
      const payload = producer.payload = JSON.parse(producer.stdout);
      assert.equal(payload.status, 'green'); assert.equal(payload.flagged, false);
      assert.equal(payload.tier, 'test'); assert.equal(payload.located, true);
      assert.equal(payload.kind, 'node-test');
      assert.ok(payload.evidence.some(item => item.target === descriptor.target && item.kind === 'node-test'
        && item.failFirst === true && item.passed === true && item.failFirstProof === 'violation-fixture'));
    });
  }
  const after = fingerprints();
  const freshness = assess('fingerprint-stability', () => assert.deepEqual(after, before));
  const evidencePath = `${phase}/16-02-ENFORCEMENT-EVIDENCE.json`;
  if (fs.existsSync(evidencePath)) fs.copyFileSync(evidencePath,
    evidencePath.replace('.json', `-${Date.now()}.json`));
  fs.writeFileSync(evidencePath, JSON.stringify({ recordedAt: new Date().toISOString(), planPath,
    prohibition, descriptor, targetTest, assertion, directArgs, canonicalArgs, producerArgs,
    resourceRelay: 'root-sole-slot-foreign-empty', effectiveTargetWorkerBound: 1,
    resourceScope: 'Root owns actual foreign guard and explicit canonical effective-one disposition; no continuing authorization.',
    fingerprints: before, fingerprintsAfter: after, freshness, identity, observations, producer,
    status: failures.length ? 'UNVERIFIED' : 'GREEN', passed: failures.length === 0, failures,
    native: 'unobserved' }, null, 2) + '\n');
  assert.equal(failures.length, 0, `Proof incomplete: ${failures.join(', ')}; inspect ${evidencePath}`);
  console.log(`Installed R08 producer proof passed: ${evidencePath}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

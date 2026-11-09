const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { Model } = require('flexlayout-react');

// Execute the actual entry with inert module bindings. No child process,
// filesystem operation, browser, Electron or production preload can run here.
async function dispatchEntry() {
  const events = [];
  const stop = new Error('inert packaged boundary');
  const fakeFs = {
    async readFile() { events.push(['packaged-metadata-read']); return '{"executable":"inert"}'; },
    async mkdtemp() { events.push(['packaged-fixture-write']); throw stop; },
    async writeFile() { events.push(['packaged-report-write']); throw stop; },
  };
  const controlled = { async runControlledRendererBenchmark(options) {
    events.push(['controlled', options]);
    return { status: 'unavailable', samples: [], metrics: null };
  } };
  const source = fs.readFileSync('scripts/benchmark.mjs', 'utf8');
  const compiled = ts.transpileModule(source.replaceAll('import.meta.url', 'ENTRY_URL'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const scope = vm.createContext({
    exports: {}, ENTRY_URL: pathToFileURL(path.resolve('scripts/benchmark.mjs')).href,
    process: { argv: ['node', 'scripts/benchmark.mjs', '--controlled-renderer', '--samples=5'],
      platform: 'linux', arch: 'x64', versions: { node: 'synthetic' }, env: {} },
    console: { log() {} }, performance: { now: () => 10 },
    require(id) {
      if (id === 'node:fs/promises') return fakeFs;
      if (id === 'node:path') return path;
      if (id === 'node:os') return { tmpdir: () => '/synthetic' };
      if (id === 'node:module') return { createRequire: () => () => ({ cpuSample() { throw stop; } }) };
      if (id === '@playwright/test') return { _electron: { launch() { events.push('electron-launch'); throw stop; } } };
      if (id === './renderer-benchmark.mjs') return controlled;
      throw new Error('unexpected entry dependency');
    },
  });
  try { await vm.runInContext(`(async () => { ${compiled}\n })()`, scope); }
  catch (error) { if (error !== stop) throw error; }
  return events;
}

function evaluate(source, scope = {}) {
  const context = vm.createContext({ exports: {}, result: undefined, ...scope });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText, context);
  return context.result;
}

function readyConsumer() {
  const app = ts.createSourceFile('src/App.tsx', fs.readFileSync('src/App.tsx', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hosts = [], layouts = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      if (node.openingElement.attributes.properties.some(p => ts.isJsxAttribute(p)
        && p.name.getText(app) === 'data-workspace-model-ready')) hosts.push(node);
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(app) === 'Layout') layouts.push(node);
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.equal(hosts.length, 1, 'readiness belongs to one actual committed Layout host');
  assert.equal(layouts.length, 1);
  assert.ok(layouts[0].pos > hosts[0].pos && layouts[0].end < hosts[0].end);
  const marker = hosts[0].openingElement.attributes.properties.find(p => p.name?.getText(app) === 'data-workspace-model-ready');
  assert.ok(marker.initializer && ts.isJsxExpression(marker.initializer));
  const modelProp = layouts[0].attributes.properties.find(p => p.name?.getText(app) === 'model');
  const model = Model.fromJson({ layout: { type: 'row', children: [] } });
  const modelOwners = { current: new WeakMap() };
  const scope = { loaded: true, model, modelOwners, workspace: 'synthetic::界', bootError: '' };
  const markerValue = () => evaluate(`result = (${marker.initializer.expression.getText(app)});`, scope);
  assert.notEqual(String(markerValue()), 'true', 'loaded alone must not mark initial model ready');
  modelOwners.current.set(model, 'other-workspace');
  assert.notEqual(String(markerValue()), 'true', 'stale workspace ownership must not mark ready');
  modelOwners.current.set(model, scope.workspace);
  assert.equal(String(markerValue()), 'true', 'restored model committed into Layout is ready');
  assert.equal(evaluate(`result = (${modelProp.initializer.expression.getText(app)});`, scope), model);
  scope.loaded = false;
  assert.notEqual(String(markerValue()), 'true');
}

test('controlled benchmark preserves explicit authority and honest timings', async () => {
  const entryEvents = await dispatchEntry();
  assert.deepEqual(entryEvents.map(event => event[0]), ['controlled'],
    'explicit controlled mode must dispatch before packaged metadata or shell scenarios');
  assert.equal(entryEvents.length, 1, 'controlled entry cannot fall through into packaged mode');
  assert.equal(entryEvents[0][1].samples, 5);

  // Only this selected test reads GSD_PROHIB_SUBJECT. Fixtures must implement
  // the same callable production protocol, and cannot change the expectations.
  const subjectPath = process.env.GSD_PROHIB_SUBJECT || 'scripts/renderer-benchmark.mjs';
  const subject = await import(pathToFileURL(path.resolve(subjectPath)).href);
  const { runControlledRendererBenchmark, syntheticPreload, projectReport } = subject.default || subject;
  assert.equal(typeof runControlledRendererBenchmark, 'function');
  assert.equal(typeof syntheticPreload, 'function');
  assert.equal(typeof projectReport, 'function');

  const timing = evaluate(fs.readFileSync('src/startup-timing.ts', 'utf8') + '\nresult = exports;');
  const duration = timing.observeStartupDuration;
  assert.equal(typeof duration, 'function');
  for (const [start, end, expected] of [[10, 14, 4], [10, 10, 0], [10, 9, null],
    [NaN, 10, null], [10, Infinity, null], [undefined, 10, null], [10, undefined, null],
    [-Number.MAX_VALUE, Number.MAX_VALUE, null]]) {
    const completion = { completed: false };
    assert.equal(duration(completion, start, end), expected, 'finite monotonic duration semantics');
    if (expected !== null) assert.equal(duration(completion, start, end + 1), null, 'one accepted completion');
  }
  readyConsumer();

  const privateMarker = 'PRIVATE_SYNTHETIC_界_e\u0301';
  for (const scenario of ['welcome-only', 'restored-hidden']) {
    const forbidden = [], calls = [];
    const window = {};
    evaluate(`(${syntheticPreload.toString()})({scenario: ${JSON.stringify(scenario)}});`, {
      window, structuredClone, console: { log() { throw new Error('preload logging forbidden'); } },
    });
    const api = window.hrig;
    assert.ok(api, 'before-script preload installs only the inert API');
    const state = await api.loadState();
    assert.equal(state.version, 1);
    assert.ok(state.connections.every(c => c.kind === 'local' && !c.host));
    const encodedState = JSON.stringify(state);
    assert.ok(!encodedState.includes('"terminal"'), 'measurement fixtures have zero terminals');
    const tabs = Object.values(state.layouts)[0].layout.children[0].children;
    assert.deepEqual(Array.from(tabs, tab => tab.component), scenario === 'restored-hidden'
      ? ['welcome', 'editor', 'diff', 'settings'] : ['welcome'], 'exact optional component keys');
    assert.equal(await api.saveState({ privateMarker }), undefined, 'persistence is inert');
    assert.equal(api.flushState({ privateMarker }).saved, true);
    assert.equal((await api.inventory(state.connections[0])).seats.length, 0);
    assert.equal((await api.file(state.connections[0], { op: 'list', root: '/synthetic', path: '' }))[0].name, 'benchmark.ts');
    assert.equal((await api.edit(state.connections[0], { op: 'read', root: '/synthetic', path: 'benchmark.ts' })).revision, 'synthetic');
    for (const op of ['write', 'delete', 'create', 'rename', 'read界']) {
      await assert.rejects(() => api.edit(state.connections[0], { op, root: '/synthetic', path: 'benchmark.ts' }));
      await assert.rejects(() => api.file(state.connections[0], { op, root: '/synthetic', path: '' }));
    }
    await assert.rejects(() => api.edit({ ...state.connections[0], host: privateMarker }, { op: 'read', root: '/synthetic', path: 'benchmark.ts' }));
    await assert.rejects(() => api.updates({ op: 'install' }));
    for (const name of ['createTerminal', 'closeTerminal', 'writeTerminal', 'sendMessage', 'rigControl', 'unknownCapability']) {
      await assert.rejects(async () => api[name]({ secret: privateMarker }), 'deny unexpected authority');
    }
    const report = await runControlledRendererBenchmark({
      samples: 2, scenario,
      candidate: { commit: 'a'.repeat(40), dirty: false, privateMarker },
      adapter: {
        now: (() => { let time = 100; return () => time++; })(),
        async availability() { return { available: false, reason: 'runtime-unavailable', privateMarker }; },
        async createContext() { forbidden.push('context-without-runtime'); throw new Error(privateMarker); },
        recordForbidden: event => forbidden.push(event),
        record: event => calls.push(event),
      },
    });
    assert.equal(report.status, 'unavailable');
    assert.equal(report.samples.length, 0);
    assert.equal(report.metrics, null, 'absent runtime is unavailable metrics, never numeric zero');
    assert.deepEqual(forbidden, [], 'authority: no forbidden host effects');
    assert.ok(!JSON.stringify(report).includes(privateMarker), 'privacy: allowlisted actual report');
    const projected = projectReport({ ...report, privateMarker, error: new Error(privateMarker),
      environment: { platform: 'linux', arch: 'x64', node: 'synthetic', privateMarker },
      samples: [{ workspaceReadyMs: NaN }, { workspaceReadyMs: Infinity }] });
    assert.ok(!JSON.stringify(projected).includes(privateMarker), 'projection excludes private nested data');
    assert.equal(projected.metrics, null);
    assert.ok(!JSON.stringify(projected).includes('"workspaceReadyMs":0'));
  }

  // Browser-shaped inert adapter: exercise production orchestration, preload
  // ordering, selectors, routing and report acceptance without launching a
  // runtime. All clock values below are semantic test data, never measurements.
  const contexts = [], effects = [], served = [], requests = [];
  let routePaths = ['/index.html', '/assets/app.js'], requestMethod = 'GET', expectAbort = false;
  let failureMode = '';
  const builtAssets = new Map([
    ['/index.html', '<html>synthetic built entry</html>'],
    ['/assets/app.js', '// synthetic built module'],
  ]);
  const adapter = {
    now: (() => { let time = 0; return () => time += 5; })(),
    async availability() { return { available: true, browserVersion: 'synthetic-test-only' }; },
    async createContext() {
      const events = [], selectors = [];
      let routeHandler;
      const context = {
        events, selectors, closed: false,
        async addInitScript(fn, args) {
          assert.equal(typeof fn, 'function');
          const window = {};
          evaluate(`(${fn.toString()})(${JSON.stringify(args)});`, { window, structuredClone });
          assert.ok(window.hrig);
          events.push('preload');
        },
        async route(pattern, handler) { assert.equal(typeof pattern, 'string'); routeHandler = handler; },
        async routeWebSocket(pattern, handler) {
          assert.equal(pattern, '**/*');
          if (failureMode === 'websocket') handler({ close() { events.push('websocket-denied'); } });
        },
        async newPage() {
          const control = selector => ({
            async waitFor() { selectors.push(selector); },
            async click() { events.push(['activate', selector]); },
            first() { return this; },
          });
          return {
            setDefaultTimeout() {},
            on(event, handler) { if (failureMode === 'page-error' && event === 'pageerror') handler(new Error('PRIVATE_SYNTHETIC')); },
            async evaluate() { return failureMode === 'capability' ? 1 : 0; },
            async goto(url) {
              assert.ok(events.includes('preload'), 'synthetic API installed before app scripts');
              assert.equal(typeof routeHandler, 'function');
              for (const pathname of routePaths) {
                const requestUrl = new URL(pathname, url).href;
                requests.push(requestUrl);
                let fulfilled = false;
                await routeHandler({ request: () => ({ url: () => requestUrl, method: () => requestMethod }),
                  async fulfill(response) { fulfilled = true; served.push(pathname); assert.ok(response.body); },
                  async abort() { assert.ok(expectAbort, 'allowed built asset denied'); },
                  async continue() { effects.push('unconfined-network'); },
                });
                assert.equal(fulfilled, !expectAbort, 'only allowlisted built assets served');
              }
            },
            locator: control,
            getByRole: (role, options) => control(`${role}:${options.name}`),
          };
        },
        async close() { this.closed = true; },
      };
      contexts.push(context);
      return context;
    },
    recordForbidden: event => effects.push(event),
  };
  const observed = await runControlledRendererBenchmark({ samples: 2, scenario: 'restored-hidden',
    candidate: { commit: 'a'.repeat(40), dirty: false }, builtAssets, adapter });
  assert.equal(observed.status, 'available');
  assert.equal(observed.samples.length, 2);
  assert.equal(contexts.length, 2, 'fresh disposable context per sample');
  assert.ok(contexts.every(context => context.closed), 'contexts close on completion');
  assert.ok(contexts.every(context => context.selectors.some(selector => selector.includes('data-workspace-model-ready'))),
    'actual committed model selector is observed for each sample');
  assert.ok(contexts.every(context => context.events.filter(event => Array.isArray(event) && event[0] === 'activate').length >= 3),
    'first editor, Settings and revisit are separate explicit controls');
  for (const sample of observed.samples) {
    for (const key of ['workspaceReadyMs', 'editorOpenMs', 'settingsOpenMs', 'revisitMs'])
      assert.ok(Number.isFinite(sample[key]) && sample[key] >= 0, `${key}: finite monotonic accepted sample`);
  }
  assert.deepEqual(effects, [], 'authority: no forbidden host effects during actual runner');
  assert.equal(served.length, 4);
  assert.equal(requests.length, 4);

  for (const pathname of ['https://private.invalid/owner', '/electron/preload.cjs', '/assets/missing.js',
    '/assets/app.js?owner=PRIVATE_SYNTHETIC', '/assets/%2e%2e/preload.cjs']) {
    routePaths = [pathname]; expectAbort = true;
    const rejected = await runControlledRendererBenchmark({ samples: 1, scenario: 'welcome-only', builtAssets, adapter });
    assert.equal(rejected.status, 'failed', 'unexpected network or asset must fail the run');
    assert.equal(rejected.reason, 'asset-denied');
    assert.equal(rejected.samples.length, 0);
    assert.equal(rejected.metrics, null);
    assert.ok(contexts.at(-1).closed, 'failed context closes');
    assert.ok(!JSON.stringify(rejected).includes('PRIVATE_SYNTHETIC'), 'privacy: route errors are fixed labels');
  }
  routePaths = ['/index.html']; requestMethod = 'POST';
  assert.equal((await runControlledRendererBenchmark({ samples: 1, builtAssets, adapter })).reason, 'asset-denied');
  requestMethod = 'GET'; expectAbort = false;
  for (const mode of ['page-error', 'capability', 'websocket']) {
    failureMode = mode;
    const rejected = await runControlledRendererBenchmark({ samples: 1, builtAssets, adapter });
    assert.equal(rejected.status, 'failed', 'unexpected browser capability/error fails closed');
    assert.equal(rejected.metrics, null);
    assert.ok(!JSON.stringify(rejected).includes('PRIVATE_SYNTHETIC'));
    assert.ok(contexts.at(-1).closed);
  }
  failureMode = '';
  const eagerAssets = new Map([...builtAssets, ['/assets/EditorPanel-canary.js', '// synthetic eager module']]);
  routePaths = ['/index.html', '/assets/EditorPanel-canary.js'];
  const eager = await runControlledRendererBenchmark({ samples: 1, builtAssets: eagerAssets, adapter });
  assert.equal(eager.status, 'failed', 'actual module routing detects eager optional chunk before activation');
  assert.equal(eager.metrics, null);
  routePaths = ['/index.html'];
  for (const now of [() => NaN, () => Infinity, (() => { let n = 100; return () => --n; })()]) {
    const rejected = await runControlledRendererBenchmark({ samples: 1, builtAssets, adapter: { ...adapter, now } });
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.reason, 'invalid-clock', 'real runner uses production monotonic acceptance');
    assert.equal(rejected.metrics, null);
    assert.ok(contexts.at(-1).closed);
  }
  const zero = await runControlledRendererBenchmark({ samples: 1, scenario: 'welcome-only', builtAssets,
    adapter: { ...adapter, now: () => 10 } });
  assert.equal(zero.status, 'available');
  assert.equal(zero.samples[0].workspaceReadyMs, 0, 'valid same-clock zero is test data');
  for (const samples of [null, 0, -1, 21, NaN, Infinity, 1.5, '5']) {
    const before = contexts.length;
    const rejected = await runControlledRendererBenchmark({ samples, builtAssets, adapter });
    assert.equal(rejected.reason, 'invalid-input');
    assert.equal(contexts.length, before, 'invalid sample count does not create a context');
  }
  const invalidScenario = await runControlledRendererBenchmark({ samples: 1, scenario: 'restored-hidden界', builtAssets, adapter });
  assert.equal(invalidScenario.reason, 'invalid-input', 'Unicode cannot widen exact scenario equality');
  const missingAssets = await runControlledRendererBenchmark({ samples: 1, builtAssets: new Map(), adapter });
  assert.equal(missingAssets.status, 'failed');
  const thrown = await runControlledRendererBenchmark({ builtAssets, adapter: { ...adapter, async createContext() { throw new Error('PRIVATE_SYNTHETIC'); } } });
  assert.equal(thrown.status, 'failed');
  assert.equal(thrown.metrics, null);
  assert.ok(!JSON.stringify(thrown).includes('PRIVATE_SYNTHETIC'), 'privacy: exceptions never serialized');
  for (const samples of [null, {}, 'PRIVATE_SYNTHETIC', [null], [{ scenario: 'welcome-only', workspaceReadyMs: 0 }]]) {
    const projected = projectReport({ status: 'available', samples });
    assert.equal(projected.status, 'failed', 'malformed sample cannot become available measurement');
    assert.equal(projected.metrics, null);
    assert.equal(projected.sampleCount, 0);
  }
  assert.equal(projectReport(null).status, 'failed');
  assert.equal((await runControlledRendererBenchmark(null)).reason, 'invalid-input');
  const defaults = await runControlledRendererBenchmark({ scenario: 'welcome-only', builtAssets, adapter });
  assert.equal(defaults.samples.length, 5, 'bounded default uses five fresh sample contexts');
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(file, module);
  mod._compile(built.outputFiles[0].text, file);
  return mod.exports;
}

const size = load("src/terminal-size.ts");
const settings = load("src/settings.ts");
const { SIZE_INDICATOR_MS, formatSize, createSizeIndicator } = size;

// Fake clock: schedule/unschedule/advance with a test-owned notion of time.
function makeClock() {
  let now = 0;
  let nextHandle = 1;
  let timers = [];
  return {
    schedule(run, ms) {
      const handle = nextHandle++;
      timers.push({ handle, run, due: now + ms, ms });
      return handle;
    },
    unschedule(handle) {
      timers = timers.filter((t) => t.handle !== handle);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => t.due <= target)
          .sort((a, b) => a.due - b.due || a.handle - b.handle)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.due;
        due.run();
      }
      now = target;
    },
    pending: () => timers.map((t) => t.ms),
  };
}

function harness(extra = {}) {
  const clock = makeClock();
  const shown = [];
  const state = { hides: 0 };
  const indicator = createSizeIndicator({
    delayMs: 1200,
    onShow: (label) => shown.push(label),
    onHide: () => {
      state.hides += 1;
    },
    schedule: clock.schedule,
    unschedule: clock.unschedule,
    ...extra,
  });
  return { clock, shown, state, indicator };
}

test("terminal.showSizeOnResize tracer: default setting on, a real size change shows the readout and hides it 1200 ms later", () => {
  const key = "terminal.showSizeOnResize";
  assert.equal(settings.resolveSettings()[key], true);
  assert.equal(settings.resolveSettings({ [key]: false })[key], false);
  assert.equal(
    settings.resolveSettings({ [key]: false }, { [key]: true })[key],
    true,
  );
  const { clock, shown, state, indicator } = harness();
  indicator.report(80, 24);
  assert.deepEqual(shown, []);
  assert.deepEqual(clock.pending(), []);
  indicator.report(100, 30);
  assert.deepEqual(shown, ["100 x 30"]);
  assert.deepEqual(clock.pending(), [1200]);
  clock.advance(1199);
  assert.equal(state.hides, 0);
  clock.advance(1);
  assert.equal(state.hides, 1);
  assert.deepEqual(clock.pending(), []);
});

test("formatSize prints columns x rows with a lowercase x and the readout lasts 1200 ms", () => {
  assert.equal(formatSize(120, 32), "120 x 32");
  assert.equal(formatSize(80, 24), "80 x 24");
  assert.equal(formatSize(1, 1), "1 x 1");
  assert.equal(formatSize(1000, 5), "1000 x 5");
  assert.equal(SIZE_INDICATOR_MS, 1200);
});

test("the first valid report is only the baseline and a new indicator starts over", () => {
  const first = harness();
  first.indicator.report(80, 24);
  assert.deepEqual(first.shown, []);
  assert.deepEqual(first.clock.pending(), []);
  first.indicator.report(90, 24);
  assert.deepEqual(first.shown, ["90 x 24"]);
  const second = harness();
  second.indicator.report(90, 24);
  second.indicator.report(90, 24);
  assert.deepEqual(second.shown, []);
  assert.deepEqual(second.clock.pending(), []);
});

test("an unchanged size is ignored, also while visible, and never extends the display", () => {
  const { clock, shown, state, indicator } = harness();
  indicator.report(80, 24);
  indicator.report(80, 24);
  assert.deepEqual(shown, []);
  indicator.report(100, 30);
  clock.advance(700);
  indicator.report(100, 30);
  assert.deepEqual(shown, ["100 x 30"]);
  assert.deepEqual(clock.pending(), [1200]);
  clock.advance(499);
  assert.equal(state.hides, 0);
  clock.advance(1);
  assert.equal(state.hides, 1);
});

test("any changed dimension shows, compared with the previous size and not the baseline", () => {
  const { clock, shown, indicator } = harness();
  indicator.report(80, 24);
  indicator.report(80, 30);
  clock.advance(1200);
  indicator.report(90, 30);
  clock.advance(1200);
  indicator.report(80, 24);
  assert.deepEqual(shown, ["80 x 30", "90 x 30", "80 x 24"]);
});

test("a further change restarts the single 1200 ms wait", () => {
  const { clock, shown, state, indicator } = harness();
  indicator.report(80, 24);
  indicator.report(100, 30);
  clock.advance(500);
  indicator.report(110, 30);
  assert.deepEqual(shown, ["100 x 30", "110 x 30"]);
  assert.deepEqual(clock.pending(), [1200]);
  clock.advance(1199);
  assert.equal(state.hides, 0);
  clock.advance(1);
  assert.equal(state.hides, 1);

  const burst = harness();
  burst.indicator.report(80, 24);
  burst.indicator.report(81, 24);
  burst.clock.advance(400);
  burst.indicator.report(82, 24);
  burst.clock.advance(400);
  burst.indicator.report(83, 24);
  burst.clock.advance(1199);
  assert.equal(burst.state.hides, 0);
  burst.clock.advance(1);
  assert.equal(burst.state.hides, 1);
});

test("after the readout hid, the next change shows again with a new wait", () => {
  const { clock, shown, state, indicator } = harness();
  indicator.report(80, 24);
  indicator.report(90, 24);
  clock.advance(1200);
  assert.equal(state.hides, 1);
  indicator.report(100, 24);
  assert.deepEqual(clock.pending(), [1200]);
  clock.advance(1200);
  assert.equal(state.hides, 2);
  assert.deepEqual(shown, ["90 x 24", "100 x 24"]);
});

test("dispose (setting off or unmount) cancels the wait and silences the indicator for good", () => {
  const key = "terminal.showSizeOnResize";
  assert.equal(settings.resolveSettings({ [key]: false })[key], false);
  const { clock, shown, state, indicator } = harness();
  indicator.report(80, 24);
  indicator.report(90, 24);
  assert.deepEqual(clock.pending(), [1200]);
  indicator.dispose();
  assert.deepEqual(clock.pending(), []);
  clock.advance(5000);
  assert.equal(state.hides, 0);
  indicator.report(120, 40);
  assert.deepEqual(shown, ["90 x 24"]);
  assert.deepEqual(clock.pending(), []);
  assert.doesNotThrow(() => indicator.dispose());
  const idle = harness();
  assert.doesNotThrow(() => idle.indicator.dispose());
});

test("invalid sizes are ignored and never become the baseline", () => {
  const { clock, shown, indicator } = harness();
  for (const [cols, rows] of [
    [0, 24],
    [80, 0],
    [-1, 24],
    [NaN, 24],
    [80, Infinity],
  ]) {
    indicator.report(cols, rows);
  }
  assert.deepEqual(shown, []);
  assert.deepEqual(clock.pending(), []);
  indicator.report(80, 24);
  assert.deepEqual(shown, []);
  indicator.report(100, 30);
  assert.deepEqual(shown, ["100 x 30"]);
});

test("timers honour delayMs and default to real timers that dispose cleans up", () => {
  const custom = harness({ delayMs: 50 });
  custom.indicator.report(80, 24);
  custom.indicator.report(90, 24);
  assert.deepEqual(custom.clock.pending(), [50]);
  custom.clock.advance(49);
  assert.equal(custom.state.hides, 0);
  custom.clock.advance(1);
  assert.equal(custom.state.hides, 1);

  const shown = [];
  const real = createSizeIndicator({
    onShow: (label) => shown.push(label),
    onHide: () => assert.fail("real timer must not survive dispose"),
  });
  real.report(80, 24);
  real.report(90, 24);
  assert.deepEqual(shown, ["90 x 24"]);
  real.dispose();
});

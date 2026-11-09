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

const copySelect = load("src/terminal-copy-select.ts");
const settings = load("src/settings.ts");
const { shouldCopy, createCopyOnSelect } = copySelect;

// Fake clock: schedule/unschedule/advance with a test-owned notion of time.
function makeClock() {
  let now = 0;
  let nextHandle = 1;
  let timers = [];
  const requested = [];
  return {
    schedule(run, ms) {
      const handle = nextHandle++;
      requested.push(ms);
      timers.push({ handle, run, due: now + ms });
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
    pending: () => timers.length,
    requested,
  };
}

function setup(overrides = {}) {
  const clock = makeClock();
  const state = { enabled: true, selection: "" };
  const copies = [];
  const errors = [];
  const scheduler = createCopyOnSelect({
    delayMs: 250,
    enabled: () => state.enabled,
    read: () => state.selection,
    copy: (text) => {
      copies.push(text);
    },
    onError: (e) => errors.push(e),
    schedule: clock.schedule,
    unschedule: clock.unschedule,
    ...overrides,
  });
  return { clock, state, copies, errors, scheduler };
}

test("tracer: resolved terminal.copyOnSelect gates a single exact clipboard write after 250 ms", () => {
  assert.equal(settings.resolveSettings()["terminal.copyOnSelect"], false);
  assert.equal(
    settings.resolveSettings({ "terminal.copyOnSelect": true })[
      "terminal.copyOnSelect"
    ],
    true,
  );
  for (const value of [true, false]) {
    const clock = makeClock();
    const copies = [];
    const resolved = settings.resolveSettings({
      "terminal.copyOnSelect": value,
    });
    const selection = "  exact text\n";
    const scheduler = createCopyOnSelect({
      enabled: () => resolved["terminal.copyOnSelect"],
      read: () => selection,
      copy: (text) => {
        copies.push(text);
      },
      schedule: clock.schedule,
      unschedule: clock.unschedule,
    });
    scheduler.notify();
    assert.deepEqual(clock.requested, [250]);
    clock.advance(249);
    assert.deepEqual(copies, []);
    clock.advance(1);
    assert.deepEqual(copies, value ? [selection] : []);
  }
});

test("shouldCopy matrix and exported constants", () => {
  assert.equal(copySelect.COPY_SELECT_DELAY_MS, 250);
  assert.equal(copySelect.COPY_SELECT_MAX_CHARS, 20000);
  assert.equal(shouldCopy(false, "good text"), false);
  assert.equal(shouldCopy(true, ""), false);
  assert.equal(shouldCopy(true, " \t\n  \n"), false);
  assert.equal(shouldCopy(true, "ordinary text"), true);
  assert.equal(shouldCopy(true, "a".repeat(20000)), true);
  assert.equal(shouldCopy(true, "a".repeat(20001)), false);
});

test("debounce: every selection change restarts the wait and only the latest text is copied", () => {
  const { clock, state, copies, scheduler } = setup();
  state.selection = "one";
  scheduler.notify();
  clock.advance(100);
  state.selection = "two";
  scheduler.notify();
  clock.advance(100);
  state.selection = "three";
  scheduler.notify();
  assert.equal(clock.pending(), 1);
  assert.deepEqual(copies, []);
  clock.advance(249);
  assert.deepEqual(copies, []);
  clock.advance(1);
  assert.deepEqual(copies, ["three"]);
});

test("toggle is read at settle time, not at notify time", () => {
  const { clock, state, copies, scheduler } = setup();
  state.selection = "secret";
  scheduler.notify();
  state.enabled = false;
  clock.advance(250);
  assert.deepEqual(copies, []);
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, []);
  state.enabled = true;
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["secret"]);
});

test("never writes for empty, whitespace-only or oversized selections", () => {
  const { clock, state, copies, scheduler } = setup();
  state.selection = "kept";
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["kept"]);
  state.selection = "";
  scheduler.notify();
  clock.advance(250);
  state.selection = " \t\n ";
  scheduler.notify();
  clock.advance(250);
  state.selection = "x".repeat(20001);
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["kept"]);
  assert.ok(!copies.includes(""));
});

test("unchanged selection copies once; clear then same text copies again", () => {
  const { clock, state, copies, scheduler } = setup();
  state.selection = "same";
  scheduler.notify();
  clock.advance(250);
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["same"]);
  state.selection = "";
  scheduler.notify();
  clock.advance(250);
  state.selection = "same";
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["same", "same"]);
  state.selection = "different";
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["same", "same", "different"]);
});

test("copy failure reports once, is retryable, and never escapes", async () => {
  const failure = new Error("denied");
  const errors = [];
  const attempts = [];
  const clock = makeClock();
  let mode = "reject";
  const state = { selection: "text" };
  const scheduler = createCopyOnSelect({
    enabled: () => true,
    read: () => state.selection,
    copy: (text) => {
      attempts.push(text);
      if (mode === "reject") return Promise.reject(failure);
      if (mode === "throw") throw failure;
      return Promise.resolve();
    },
    onError: (e) => errors.push(e),
    schedule: clock.schedule,
    unschedule: clock.unschedule,
  });
  scheduler.notify();
  clock.advance(250);
  await new Promise(setImmediate);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(attempts, ["text"]);

  // A failed copy is not remembered as done, so the same text is retried.
  scheduler.notify();
  clock.advance(250);
  await new Promise(setImmediate);
  assert.deepEqual(attempts, ["text", "text"]);
  assert.equal(errors.length, 2);

  // A synchronous throw is reported and does not escape notify() or the clock.
  mode = "throw";
  scheduler.notify();
  assert.doesNotThrow(() => clock.advance(250));
  assert.equal(errors.length, 3);
  assert.equal(errors[2], failure);

  // Success stays silent.
  mode = "ok";
  scheduler.notify();
  clock.advance(250);
  await new Promise(setImmediate);
  assert.equal(errors.length, 3);
  assert.equal(attempts.length, 4);
});

test("cancel unschedules the pending timer and is harmless when idle", () => {
  const { clock, state, copies, scheduler } = setup();
  assert.doesNotThrow(() => scheduler.cancel());
  state.selection = "text";
  scheduler.notify();
  assert.equal(clock.pending(), 1);
  scheduler.cancel();
  assert.equal(clock.pending(), 0);
  clock.advance(1000);
  assert.deepEqual(copies, []);
  scheduler.notify();
  clock.advance(250);
  assert.deepEqual(copies, ["text"]);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const asciiOnly = (text) => !/[^\n -~]/.test(text);
const ch = (...codes) => String.fromCharCode(...codes);
const dot = ch(0xb7);
const both = (lines, bytes) => lines + " " + dot + " " + bytes;

function load(entry) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const mod = new Module(entry, module);
  mod._compile(built.outputFiles[0].text, path.join(root, entry));
  return mod.exports;
}
const counter = load("src/terminal-output-counter.ts");
const settings = load("src/settings.ts");
const KEY = "terminal.showOutputCounter";

// Small deterministic random numbers for the seeded walks.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fake clock: timers run in due order when time is advanced.
function makeClock() {
  let now = 0;
  let next = 1;
  let timers = [];
  return {
    now: () => now,
    setTimeout(run, ms) {
      const handle = next++;
      timers.push({ handle, run, due: now + ms, ms });
      return handle;
    },
    clearTimeout(handle) {
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

// The REAL component bundled once; its window, timers and clock come from a per-mount "env" object and React is a tiny stand-in with state, effects and cleanups.
let componentCode;
function mountCounter(effective, options = {}) {
  componentCode ??= buildSync({
    entryPoints: [path.join(root, "src/TerminalOutputCounter.tsx")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["react", "react/jsx-runtime", "./SettingsContext"],
    define: {
      window: "env.window",
      setTimeout: "env.setTimeout",
      clearTimeout: "env.clearTimeout",
      performance: "env.performance",
    },
  }).outputFiles[0].text;
  const clock = makeClock();
  const sent = [];
  const terminalListeners = new Set();
  const windowListeners = [];
  const keyListeners = [];
  const keyArgs = [];
  const platform = options.platform ?? "linux";
  const term = {
    element: {
      addEventListener(name, listener, capture) {
        keyArgs.push([name, capture]);
        keyListeners.push({ name, listener });
      },
      removeEventListener(name, listener, capture) {
        keyArgs.push(["remove " + name, capture]);
        const at = keyListeners.findIndex(
          (k) => k.name === name && k.listener === listener,
        );
        if (at >= 0) keyListeners.splice(at, 1);
      },
    },
    write: (data) => sent.push(["term.write", data]),
    paste: (data) => sent.push(["term.paste", data]),
    input: (data) => sent.push(["term.input", data]),
  };
  const env = {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    performance: { now: clock.now },
    window: {
      hrig: {
        platform,
        onTerminal(callback) {
          terminalListeners.add(callback);
          return () => terminalListeners.delete(callback);
        },
        writeTerminal: (id, data) => sent.push(["writeTerminal", id, data]),
        resizeTerminal: (id, cols, rows) =>
          sent.push(["resizeTerminal", id, cols, rows]),
      },
      addEventListener(name, listener) {
        windowListeners.push({ name, listener });
      },
      removeEventListener(name, listener) {
        const at = windowListeners.findIndex(
          (w) => w.name === name && w.listener === listener,
        );
        if (at >= 0) windowListeners.splice(at, 1);
      },
    },
  };
  let eff = effective;
  const slots = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  let queued = [];
  let dirty = false;
  let rendering = false;
  let props = null;
  let tree = null;
  const shown = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      const slot = slots[index];
      return [
        slot.value,
        (value) => {
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          if (rendering) dirty = true;
          else render();
        },
      ];
    },
    useEffect(run, deps) {
      const index = effectCursor++;
      const previous = effects[index];
      const changed =
        !previous || deps.some((d, k) => !Object.is(d, previous.deps[k]));
      queued.push({ index, run, deps, changed });
    },
  };
  const fakeRequire = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return {
        jsx: (type, p) => ({ type, props: p }),
        jsxs: (type, p) => ({ type, props: p }),
      };
    if (name === "./SettingsContext")
      return { useSettings: () => ({ effective: eff }) };
    throw new Error("unexpected require " + name);
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", "env", componentCode)(
    mod,
    mod.exports,
    fakeRequire,
    env,
  );
  const Component = mod.exports.default;
  function render() {
    rendering = true;
    do {
      dirty = false;
      cursor = 0;
      effectCursor = 0;
      queued = [];
      tree = Component(props);
      const text = tree ? tree.props.children : null;
      if (!shown.length || shown[shown.length - 1][1] !== text)
        shown.push([clock.now(), text]);
      for (const item of queued) {
        if (!item.changed) continue;
        const previous = effects[item.index];
        if (previous && previous.cleanup) previous.cleanup();
        effects[item.index] = { deps: item.deps, cleanup: item.run() };
      }
    } while (dirty);
    rendering = false;
  }
  const view = {
    clock,
    sent,
    shown,
    term,
    tree: () => tree,
    text: () => (tree ? tree.props.children : null),
    subscribers: () => terminalListeners.size,
    windowListeners: () => windowListeners.map((w) => w.name),
    keyListeners: () => keyListeners.length,
    keyArgs,
    render(next, nextEffective) {
      props = next;
      if (nextEffective) eff = nextEffective;
      render();
    },
    unmount() {
      for (const item of effects) if (item && item.cleanup) item.cleanup();
      effects.length = 0;
    },
    emit(event) {
      for (const callback of [...terminalListeners]) callback(event);
    },
    command(detail) {
      for (const w of [...windowListeners])
        if (w.name === "hrig:terminal-command")
          w.listener({ detail, type: "hrig:terminal-command" });
    },
    key(init) {
      for (const k of [...keyListeners])
        if (k.name === "keydown")
          k.listener({
            type: "keydown",
            key: "k",
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            shiftKey: false,
            ...init,
          });
    },
  };
  view.render({
    terminal: options.noTerminal ? { current: null } : { current: term },
    id: "t1",
    generation: 1,
  });
  return view;
}

const ZERO = both("0 lines", "0 B");

test("terminal-output-counter tracer: off by default it subscribes to nothing; on, the real overlay counts the lines and bytes of its own terminal, resets on clear and reconnect, refreshes at most four times a second and sends nothing", () => {
  assert.equal(settings.defaults[KEY], false);
  assert.equal(settings.resolveSettings()[KEY], false);
  const on = settings.resolveSettings({ [KEY]: true });
  assert.equal(on[KEY], true);

  // Off (the default): nothing is drawn, subscribed, listened to or scheduled.
  const off = mountCounter(settings.resolveSettings());
  assert.equal(off.tree(), null);
  assert.equal(off.subscribers(), 0);
  assert.deepEqual(off.windowListeners(), []);
  assert.equal(off.keyListeners(), 0);
  assert.deepEqual(off.clock.pending(), []);
  off.emit({ id: "t1", data: "ignored\n" });
  assert.equal(off.tree(), null);

  // On but no terminal yet (the first mount, before the panel created it): still nothing; it subscribes when the terminal exists.
  const late = mountCounter(on, { noTerminal: true });
  assert.equal(late.tree(), null);
  assert.equal(late.subscribers(), 0);
  late.render({ terminal: { current: late.term }, id: "t1", generation: 2 });
  assert.equal(late.text(), ZERO);
  assert.equal(late.subscribers(), 1);
  late.unmount();
  assert.equal(late.subscribers(), 0);

  // On: zeros at once, drawn with the existing overlay look plus the counter modifier, never announced.
  const view = mountCounter(on);
  assert.equal(view.text(), ZERO);
  assert.equal(view.tree().type, "div");
  assert.equal(
    view.tree().props.className,
    "terminal-size terminal-output-counter",
  );
  assert.equal(view.tree().props.role, "status");
  assert.equal(view.tree().props["aria-live"], "off");
  assert.equal(typeof view.tree().props.title, "string");
  assert.equal(view.subscribers(), 1);
  assert.deepEqual(view.windowListeners(), ["hrig:terminal-command"]);
  assert.equal(view.keyListeners(), 1);
  assert.deepEqual(view.keyArgs[0], ["keydown", true]);

  // Counting: only data events of its own terminal; an exit event and another terminal are ignored; the label follows after the throttle.
  view.emit({ id: "t1", data: "one\ntwo\n" });
  view.emit({ id: "other", data: "zzz\nzzz\nzzz\n" });
  view.emit({ id: "t1", exitCode: 1 });
  assert.equal(view.text(), ZERO, "a second update waits for the throttle");
  view.clock.advance(249);
  assert.equal(view.text(), ZERO);
  view.clock.advance(1);
  assert.equal(view.text(), both("2 lines", "8 B"));
  view.emit({ id: "t1", data: "caf" + ch(0xe9) + " " + ch(0x20ac) + "\r\n" });
  view.clock.advance(250);
  assert.equal(view.text(), both("3 lines", "19 B"));

  // Clear: the command center event for its own terminal resets; another terminal's or another command does not.
  view.command({ id: "other", command: "clear" });
  view.command({ id: "t1", command: "focus" });
  view.command(null);
  view.clock.advance(250);
  assert.equal(view.text(), both("3 lines", "19 B"));
  view.command({ id: "t1", command: "clear" });
  view.clock.advance(250);
  assert.equal(view.text(), ZERO);

  // Clear from the keyboard: the same key the terminal tools treat as clear (Ctrl+Shift+K here), nothing else.
  view.emit({ id: "t1", data: "x\n" });
  view.clock.advance(250);
  assert.equal(view.text(), both("1 line", "2 B"));
  view.key({ ctrlKey: true, shiftKey: false });
  view.key({ ctrlKey: true, shiftKey: true, altKey: true });
  view.key({ ctrlKey: true, shiftKey: true, key: "j" });
  view.key({ metaKey: true });
  view.clock.advance(250);
  assert.equal(view.text(), both("1 line", "2 B"));
  view.key({ ctrlKey: true, shiftKey: true });
  view.clock.advance(250);
  assert.equal(view.text(), ZERO);

  // No output text is kept anywhere the overlay can reach.
  view.emit({ id: "t1", data: "SECRET-TOKEN-4711\n" });
  view.clock.advance(250);
  assert.equal(view.text(), both("1 line", "18 B"));
  assert.ok(!JSON.stringify(view.tree()).includes("SECRET"));
  assert.ok(!JSON.stringify(view.shown).includes("SECRET"));

  // A new generation (attach, reconnect) starts again from zero and leaves one subscription, not two.
  view.render({ terminal: { current: view.term }, id: "t1", generation: 2 });
  assert.equal(view.text(), ZERO);
  assert.equal(view.subscribers(), 1);
  assert.equal(view.keyListeners(), 1);
  assert.deepEqual(view.windowListeners(), ["hrig:terminal-command"]);
  view.emit({ id: "t1", data: "a\n" });
  view.clock.advance(250);
  assert.equal(view.text(), both("1 line", "2 B"));

  // Turning the setting off (while a refresh is waiting) removes everything at once.
  view.emit({ id: "t1", data: "b\n" });
  assert.ok(view.clock.pending().length > 0);
  view.render(
    { terminal: { current: view.term }, id: "t1", generation: 2 },
    settings.resolveSettings({ [KEY]: false }),
  );
  assert.equal(view.tree(), null);
  assert.equal(view.subscribers(), 0);
  assert.deepEqual(view.windowListeners(), []);
  assert.equal(view.keyListeners(), 0);
  assert.deepEqual(view.clock.pending(), []);
  view.clock.advance(1000);
  assert.equal(view.tree(), null);

  // Turning it back on starts from zero.
  view.render(
    { terminal: { current: view.term }, id: "t1", generation: 2 },
    on,
  );
  assert.equal(view.text(), ZERO);
  view.unmount();
  assert.equal(view.subscribers(), 0);
  assert.equal(view.keyListeners(), 0);

  // Heavy output: 1,000 chunks, one a millisecond. Updates are at least 250 ms apart, at most four in the first second, and the last one is exact.
  const heavy = mountCounter(on);
  for (let i = 0; i < 1000; i++) {
    heavy.emit({ id: "t1", data: "line\n" });
    heavy.clock.advance(1);
  }
  heavy.clock.advance(250);
  const times = heavy.shown
    .filter((entry) => entry[1] !== null)
    .map((entry) => entry[0]);
  assert.ok(times.length >= 3, "the label did move");
  for (let i = 1; i < times.length; i++)
    assert.ok(times[i] - times[i - 1] >= 250, "gap before update " + i);
  assert.ok(times.filter((t) => t < 1000).length <= 4);
  assert.equal(heavy.text(), both("1k lines", "4.9 KB"));
  heavy.unmount();

  // Display only: nothing was ever written, resized, pasted or typed in any scenario above.
  for (const v of [off, late, view, heavy]) assert.deepEqual(v.sent, []);
});

test("terminal-output-counter rules: counting, bounds, number formatting and the throttle", () => {
  const c = counter;
  // measure: lines are line feeds, bytes are UTF-8.
  const cases = [
    ["", 0, 0],
    ["a", 0, 1],
    ["\n", 1, 1],
    ["a\nb\nc", 2, 5],
    ["\r\n", 1, 2],
    ["\r", 0, 1],
    ["\n\n\n", 3, 3],
    [ch(0xe9), 0, 2],
    [ch(0x20ac), 0, 3],
    [ch(0xd83d, 0xde00), 0, 4],
    [ch(0xd83d), 0, 3],
    [ch(0xde00), 0, 3],
    [ch(0xd83d) + "x", 0, 4],
    [ch(0x80, 0x7ff, 0x800, 0xffff), 0, 10],
  ];
  for (const [text, lines, bytes] of cases) {
    assert.deepEqual(c.measure(text), { lines, bytes }, JSON.stringify(text));
    assert.equal(
      Buffer.byteLength(text, "utf8"),
      bytes,
      "agrees with Buffer.byteLength for " + JSON.stringify(text),
    );
  }
  assert.deepEqual(c.measure(new Uint8Array([10, 65, 10, 10, 200])), {
    lines: 3,
    bytes: 5,
  });
  assert.deepEqual(c.measure(new Uint8Array(0)), { lines: 0, bytes: 0 });
  assert.deepEqual(c.measure(Buffer.from("a\nb\n")), { lines: 2, bytes: 4 });
  for (const junk of [
    undefined,
    null,
    0,
    7,
    NaN,
    true,
    {},
    [],
    ["a\n"],
    [10, 10],
    new ArrayBuffer(8),
    () => "a\n",
    Symbol("x"),
  ])
    assert.deepEqual(
      c.measure(junk),
      { lines: 0, bytes: 0 },
      String(typeof junk),
    );

  // addBounded saturates at MAX_COUNT and ignores amounts that are not finite numbers above 0.
  assert.equal(c.MAX_COUNT, Number.MAX_SAFE_INTEGER);
  assert.equal(c.addBounded(0, 0), 0);
  assert.equal(c.addBounded(1, 2), 3);
  assert.equal(c.addBounded(c.MAX_COUNT - 1, 1), c.MAX_COUNT);
  assert.equal(c.addBounded(c.MAX_COUNT - 1, 2), c.MAX_COUNT);
  assert.equal(c.addBounded(c.MAX_COUNT, 1), c.MAX_COUNT);
  assert.equal(c.addBounded(c.MAX_COUNT, c.MAX_COUNT), c.MAX_COUNT);
  assert.equal(c.addBounded(1e300, 1), c.MAX_COUNT);
  assert.equal(c.addBounded(5, -1), 5);
  assert.equal(c.addBounded(5, NaN), 5);
  assert.equal(c.addBounded(5, Infinity), 5);
  assert.equal(c.addBounded(NaN, 4), 4);
  assert.equal(c.addBounded(-3, 4), 4);
  assert.equal(c.addBounded("5", 4), 4);

  // createCounter: two numbers, a copy per snapshot, reset to zero, independent instances, junk ignored.
  const k = c.createCounter();
  assert.deepEqual(Object.keys(k).sort(), ["add", "reset", "snapshot"]);
  for (const name of Object.keys(k)) assert.equal(typeof k[name], "function");
  assert.deepEqual(k.snapshot(), { lines: 0, bytes: 0 });
  k.add("a\nb\n");
  k.add(new Uint8Array([10, 10]));
  k.add(null);
  k.add(12);
  assert.deepEqual(k.snapshot(), { lines: 4, bytes: 6 });
  const copy = k.snapshot();
  copy.lines = 99;
  assert.deepEqual(k.snapshot(), { lines: 4, bytes: 6 });
  assert.deepEqual(Object.keys(k.snapshot()).sort(), ["bytes", "lines"]);
  const other = c.createCounter();
  other.add("zzz\n");
  assert.deepEqual(k.snapshot(), { lines: 4, bytes: 6 });
  k.reset();
  assert.deepEqual(k.snapshot(), { lines: 0, bytes: 0 });
  assert.deepEqual(other.snapshot(), { lines: 1, bytes: 4 });
  // Output text is never kept: nothing reachable from the counter or its snapshot holds a chunk.
  const secret = "PASSWORD-9f2c\n";
  k.add(secret);
  assert.ok(!JSON.stringify(k.snapshot()).includes("PASSWORD"));
  assert.ok(!String(k.add).includes("PASSWORD"));
  assert.ok(Object.values(k.snapshot()).every((v) => typeof v === "number"));
  // A huge chunk is one pass and one add, however long.
  const big = "x".repeat(2000000) + "\n";
  const started = Date.now();
  k.reset();
  k.add(big);
  assert.deepEqual(k.snapshot(), { lines: 1, bytes: 2000001 });
  assert.ok(Date.now() - started < 2000, "a 2 MB chunk is counted quickly");

  // formatLines tables.
  const lineTable = [
    [0, "0 lines"],
    [1, "1 line"],
    [2, "2 lines"],
    [999, "999 lines"],
    [1000, "1k lines"],
    [1049, "1k lines"],
    [1050, "1.1k lines"],
    [1234, "1.2k lines"],
    [9949, "9.9k lines"],
    [9950, "10k lines"],
    [12345, "12k lines"],
    [999499, "999k lines"],
    [999500, "1M lines"],
    [999999, "1M lines"],
    [1000000, "1M lines"],
    [1200000, "1.2M lines"],
    [1e9, "1G lines"],
    [2.5e12, "2.5T lines"],
    [c.MAX_COUNT, "9P lines"],
    [1e30, "9P lines"],
    [-5, "0 lines"],
    [NaN, "0 lines"],
    [Infinity, "0 lines"],
    ["12", "0 lines"],
    [null, "0 lines"],
    [undefined, "0 lines"],
    [12.9, "12 lines"],
  ];
  for (const [value, text] of lineTable)
    assert.equal(c.formatLines(value), text, "formatLines " + String(value));
  const byteTable = [
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024 - 1, "1 MB"],
    [1024 * 1024, "1 MB"],
    [Math.round(3.4 * 1024 * 1024), "3.4 MB"],
    [10 * 1024 * 1024, "10 MB"],
    [1000000000, "954 MB"],
    [Math.pow(1024, 3), "1 GB"],
    [Math.pow(1024, 4) * 2.5, "2.5 TB"],
    [c.MAX_COUNT, "8 PB"],
    [-1, "0 B"],
    [NaN, "0 B"],
    ["1024", "0 B"],
  ];
  for (const [value, text] of byteTable)
    assert.equal(c.formatBytes(value), text, "formatBytes " + String(value));
  assert.equal(
    c.format({ lines: 1234, bytes: Math.round(3.4 * 1024 * 1024) }),
    "1.2k lines " + dot + " 3.4 MB",
  );
  assert.equal(c.format({ lines: 0, bytes: 0 }), ZERO);
  assert.equal(c.format({ lines: 1, bytes: 1 }), both("1 line", "1 B"));

  // A seeded walk of 300 values against an independent reading of the text: shape, size within rounding, no unit overflow, monotone.
  const random = seeded(2024);
  let walked = 0;
  let lastLines = -1;
  let lastBytes = -1;
  const sorted = Array.from({ length: 300 }, () =>
    Math.floor(Math.pow(10, random() * 15.9)),
  ).sort((a, b) => a - b);
  for (const n of sorted) {
    walked += 1;
    const lines = c.formatLines(n);
    const m = /^(\d+(?:\.\d)?)(k|M|G|T|P)? (lines?)$/.exec(lines);
    assert.ok(m, "shape of " + lines);
    const scale = { undefined: 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 }[
      m[2]
    ];
    const value = Number(m[1]) * scale;
    assert.ok(Math.abs(value - n) <= n * 0.051 + 0.5, lines + " is near " + n);
    assert.ok(Number(m[1]) < 1000 || scale === 1);
    assert.ok(value >= lastLines, "monotone lines");
    lastLines = value;
    assert.equal(m[3], n === 1 ? "line" : "lines");
    const bytes = c.formatBytes(n);
    const b = /^(\d+(?:\.\d)?) (B|KB|MB|GB|TB|PB)$/.exec(bytes);
    assert.ok(b, "shape of " + bytes);
    const unit = {
      B: 1,
      KB: 1024,
      MB: 1024 ** 2,
      GB: 1024 ** 3,
      TB: 1024 ** 4,
      PB: 1024 ** 5,
    }[b[2]];
    const size = Number(b[1]) * unit;
    assert.ok(Math.abs(size - n) <= n * 0.051 + 0.5, bytes + " is near " + n);
    assert.ok(Number(b[1]) < 1024, "no unit overflow in " + bytes);
    assert.ok(size >= lastBytes, "monotone bytes");
    lastBytes = size;
  }
  assert.equal(walked, 300, "the walk ran every case");

  // The throttle: leading publish, one trailing publish for any number of notifies, never closer than 250 ms.
  assert.equal(c.OUTPUT_COUNTER_MIN_INTERVAL_MS, 250);
  const clock = makeClock();
  const published = [];
  const throttle = c.createThrottle({
    now: clock.now,
    schedule: (run, ms) => clock.setTimeout(run, ms),
    unschedule: (handle) => clock.clearTimeout(handle),
    publish: () => published.push(clock.now()),
  });
  throttle.notify();
  assert.deepEqual(published, [0]);
  clock.advance(100);
  throttle.notify();
  throttle.notify();
  throttle.notify();
  assert.deepEqual(published, [0]);
  assert.deepEqual(clock.pending(), [150], "one wait for the remaining time");
  clock.advance(149);
  assert.deepEqual(published, [0]);
  clock.advance(1);
  assert.deepEqual(published, [0, 250]);
  assert.deepEqual(clock.pending(), []);
  clock.advance(300);
  throttle.notify();
  assert.deepEqual(
    published,
    [0, 250, 550],
    "after a quiet spell it publishes at once",
  );
  throttle.notify();
  assert.deepEqual(clock.pending(), [250]);
  throttle.dispose();
  assert.deepEqual(clock.pending(), []);
  clock.advance(1000);
  throttle.notify();
  assert.deepEqual(published, [0, 250, 550]);
  assert.doesNotThrow(() => throttle.dispose());
  const idle = c.createThrottle({
    now: () => 0,
    schedule: () => assert.fail("never scheduled"),
    unschedule: () => assert.fail("never unscheduled"),
    publish: () => {},
  });
  assert.doesNotThrow(() => idle.dispose());
  // A clock that is not a number publishes at once instead of waiting for ever.
  let odd = 0;
  const strange = c.createThrottle({
    now: () => NaN,
    schedule: () => assert.fail("not scheduled"),
    unschedule: () => {},
    publish: () => {
      odd += 1;
    },
  });
  strange.notify();
  strange.notify();
  assert.equal(odd, 2);
  // A clock that goes backwards never waits longer than the interval.
  let back = 1000;
  const waits = [];
  const backward = c.createThrottle({
    now: () => back,
    schedule: (run, ms) => {
      waits.push(ms);
      return 1;
    },
    unschedule: () => {},
    publish: () => {},
  });
  backward.notify();
  back = 5;
  backward.notify();
  assert.deepEqual(waits, [250]);
  // A seeded timeline of 400 notifies: publishes are at least 250 ms apart, none is lost for good, and the last one comes within 250 ms of the last notify.
  const rnd = seeded(77);
  const walkClock = makeClock();
  const walkPublished = [];
  const walkThrottle = c.createThrottle({
    now: walkClock.now,
    schedule: (run, ms) => walkClock.setTimeout(run, ms),
    unschedule: (handle) => walkClock.clearTimeout(handle),
    publish: () => walkPublished.push(walkClock.now()),
  });
  let lastNotify = 0;
  let notifies = 0;
  for (let i = 0; i < 400; i++) {
    walkClock.advance(Math.floor(rnd() * rnd() * 400));
    walkThrottle.notify();
    lastNotify = walkClock.now();
    notifies += 1;
  }
  walkClock.advance(250);
  assert.equal(notifies, 400);
  for (let i = 1; i < walkPublished.length; i++)
    assert.ok(walkPublished[i] - walkPublished[i - 1] >= 250);
  assert.ok(walkPublished.length > 3);
  assert.ok(walkPublished[walkPublished.length - 1] >= lastNotify);
  assert.ok(walkPublished[walkPublished.length - 1] - lastNotify <= 250);
});

test("terminal-output-counter wiring: pure module, display-only overlay, one mount, one setting, one style rule", () => {
  const modRaw = read("src/terminal-output-counter.ts");
  const mod = stripComments(modRaw);
  assert.ok(asciiOnly(modRaw), "the pure module is ASCII");
  assert.ok(!/^\s*import\b/m.test(mod), "the pure module has no import");
  assert.ok(!/\brequire\(/.test(mod));
  assert.ok(!/export\s+default/.test(mod), "named exports only");
  for (const word of [
    "window",
    "document",
    "globalThis",
    "navigator",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "fetch",
    "XMLHttpRequest",
    "eval",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "requestAnimationFrame",
    "performance",
    "Date",
    "Math.random",
    "TextEncoder",
    "Buffer",
    "process",
  ])
    assert.ok(
      !new RegExp("\\b" + word.replace(".", "\\.") + "\\b").test(mod),
      "the pure module never uses " + word,
    );
  const exported = [
    ...modRaw.matchAll(/^export (?:const|function|interface) (\w+)/gm),
  ].map((m) => m[1]);
  assert.deepEqual(exported, [
    "MAX_COUNT",
    "OUTPUT_COUNTER_MIN_INTERVAL_MS",
    "OutputCounts",
    "OutputCounter",
    "ThrottleOptions",
    "Throttle",
    "addBounded",
    "measure",
    "createCounter",
    "formatLines",
    "formatBytes",
    "format",
    "createThrottle",
  ]);
  const modLines = modRaw.split("\n");
  modLines.forEach((line, i) => {
    if (/^export (const|function) /.test(line))
      assert.ok(
        modLines[i - 1].startsWith("/** "),
        "a doc comment above " + line.slice(0, 40),
      );
  });
  assert.ok(
    modRaw.includes("export const MAX_COUNT = Number.MAX_SAFE_INTEGER;"),
  );
  assert.ok(
    modRaw.includes("export const OUTPUT_COUNTER_MIN_INTERVAL_MS = 250;"),
  );

  const compRaw = read("src/TerminalOutputCounter.tsx");
  const comp = collapse(stripComments(compRaw));
  assert.ok(asciiOnly(compRaw), "the overlay is ASCII");
  for (const pin of [
    'import { useSettings } from "./SettingsContext";',
    'import { classifyTerminalKey } from "./terminal-keys";',
    'from "./terminal-output-counter";',
    'const enabled = useSettings().effective["terminal.showOutputCounter"];',
    "const counter = createCounter();",
    "const throttle = createThrottle({",
    "now: () => performance.now(),",
    "publish: () => setLabel(format(counter.snapshot())),",
    "throttle.notify();",
    "window.hrig.onTerminal((event) => {",
    'if (event.id !== id || typeof event.data !== "string") return;',
    "counter.add(event.data);",
    "counter.reset();",
    'detail.id === id && detail.command === "clear"',
    'classifyTerminalKey(event, window.hrig.platform, false) === "clear"',
    'window.addEventListener("hrig:terminal-command", onCommand);',
    'term.element?.addEventListener("keydown", onKeyDown, true);',
    "unsubscribe();",
    'window.removeEventListener("hrig:terminal-command", onCommand);',
    'term.element?.removeEventListener("keydown", onKeyDown, true);',
    "throttle.dispose();",
    "}, [generation, enabled, id]);",
    "if (!enabled || label === null) return null;",
    'className="terminal-size terminal-output-counter"',
    'role="status"',
    'aria-live="off"',
  ])
    assert.ok(comp.includes(pin), "TerminalOutputCounter must keep: " + pin);
  assert.equal(comp.split("terminal.current").length - 1, 1);
  const termUses = [...comp.matchAll(/\bterm\.(\w+)/g)].map((m) => m[1]);
  assert.ok(termUses.length > 0 && termUses.every((u) => u === "element"));
  const bridge = [...comp.matchAll(/window\.hrig\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(bridge.sort(), ["onTerminal", "platform"]);
  for (const word of [
    "writeTerminal",
    "resizeTerminal",
    ".write(",
    ".paste(",
    ".input(",
    "onData",
    ".focus(",
    "dangerouslySetInnerHTML",
    "innerHTML",
    "localStorage",
    "sessionStorage",
    "fetch(",
    "console" + ".",
    "style=",
    "href",
    "onClick",
    "preventDefault",
    "stopPropagation",
  ])
    assert.ok(!comp.includes(word), "the overlay is display only: " + word);
  assert.ok(!/Date\b|Math\.random/.test(comp));

  // One import and one mount, inside the stage right after the bell overlay.
  const panel = collapse(read("src/TerminalPanel.tsx"));
  assert.equal(
    panel.split('import TerminalOutputCounter from "./TerminalOutputCounter";')
      .length - 1,
    1,
  );
  assert.equal(panel.split("<TerminalOutputCounter").length - 1, 1);
  const stageStart = panel.indexOf('<div className="terminal-stage">');
  const stage = panel.slice(stageStart, panel.indexOf("</div>", stageStart));
  assert.ok(
    stage.includes(
      "<TerminalBell terminal={terminalRef} generation={attempt * 2 + (ready ? 1 : 0)} /> <TerminalOutputCounter terminal={terminalRef} id={config.terminalId!} generation={attempt * 2 + (ready ? 1 : 0)} />",
    ),
    "the counter is mounted in the stage right after the bell overlay",
  );
  const srcDir = path.join(root, "src");
  const files = fs.readdirSync(srcDir).filter((name) => /\.tsx?$/.test(name));
  assert.deepEqual(
    files.filter((name) =>
      read("src/" + name).includes("<TerminalOutputCounter"),
    ),
    ["TerminalPanel.tsx"],
  );
  assert.deepEqual(
    files.filter((name) =>
      /terminal-output-counter"/.test(read("src/" + name)),
    ),
    ["TerminalOutputCounter.tsx"],
  );

  // One setting: default off and one schema row; the settings module knows nothing else about the counter.
  const settingsText = read("src/settings.ts");
  assert.equal(
    settingsText.split('"terminal.showOutputCounter": false,').length - 1,
    1,
  );
  assert.equal(
    settingsText.split('key: "terminal.showOutputCounter"').length - 1,
    1,
  );
  assert.ok(!/terminal-output-counter/.test(settingsText));

  // One style rule, after the existing rules, reusing the overlay look and only moving it.
  const css = read("src/styles.css");
  assert.equal(css.split("terminal-output-counter").length - 1, 1);
  const rule =
    ".terminal-size.terminal-output-counter {\n  left: 12px;\n  transform: none;\n  animation: none;\n}\n";
  assert.ok(css.endsWith(rule), "the rule is the last thing in the stylesheet");
  assert.equal(css.split(".terminal-size {").length - 1, 1);
  // The size overlay and the rest of the terminal files are not part of this feature.
  for (const name of [
    "TerminalSize.tsx",
    "terminal-size.ts",
    "TerminalTools.tsx",
  ])
    assert.ok(
      !/terminal-output-counter|TerminalOutputCounter/.test(
        read("src/" + name),
      ),
      name + " does not know the counter",
    );
});

test("terminal-output-counter docs: SETTINGS.md has one row and TERMINALS.md one paragraph that say what is counted, when it resets, how often it refreshes and that nothing is stored or sent", () => {
  const settingsDoc = read("SETTINGS.md");
  const terminalsDoc = read("TERMINALS.md");
  for (const [name, doc] of [
    ["SETTINGS.md", settingsDoc],
    ["TERMINALS.md", terminalsDoc],
  ]) {
    assert.ok(
      doc.endsWith("\n") && !doc.endsWith("\n\n"),
      name + " ends with one line feed",
    );
  }
  const rows = settingsDoc
    .split("\n")
    .filter((line) => line.startsWith("| `terminal.showOutputCounter` |"));
  assert.equal(rows.length, 1);
  assert.ok(asciiOnly(rows[0]), "the row is ASCII");
  for (const part of [
    "| `false` |",
    "lines and bytes of output",
    "attached or was last cleared",
    "Off by default",
    "Display only",
    "keeps two numbers, not the output",
    "at most four times a second",
    "sends nothing to the shell or the seat",
    "See TERMINALS.md",
  ])
    assert.ok(rows[0].includes(part), "the row says: " + part);

  const lines = terminalsDoc.split("\n");
  const at = lines.findIndex((line) =>
    line.startsWith("The terminal.showOutputCounter setting is off by default"),
  );
  assert.ok(at > 0, "TERMINALS.md has the paragraph");
  assert.equal(
    lines.filter((line) => line.includes("terminal.showOutputCounter")).length,
    1,
    "exactly one paragraph names the setting",
  );
  assert.ok(lines[at - 1] === "" && lines[at + 1] === "");
  assert.ok(asciiOnly(lines[at]), "the paragraph is ASCII");
  assert.ok(
    lines[at - 2].startsWith(
      "The terminal.showSizeOnResize setting is on by default",
    ),
    "right after the size readout paragraph",
  );
  assert.ok(
    lines[at + 2].startsWith(
      "The terminal.cursorStyle setting chooses the cursor shape",
    ),
    "right before the cursor paragraph",
  );
  for (const part of [
    "off by default, and with it off nothing is counted and nothing is drawn",
    "a small readout at its top left corner",
    "Lines are the line feed characters in the output (a carriage return alone is not a line)",
    "the size is the output in UTF-8 bytes",
    "lines use units of 1,000 (k, M) and the size uses units of 1,024 (KB, MB, GB)",
    "it starts at zero each time the terminal attaches or reconnects and each time it is cleared",
    "Terminal: Clear in the command center or Ctrl+Shift+K (Cmd+K on macOS) while the terminal has focus",
    "the retained history replayed when a seat session is re-attached",
    "refreshed at most four times a second however fast the output arrives",
    "can trail the terminal by a quarter of a second",
    "no output text is stored, logged, copied or sent anywhere",
    "the counts are not saved",
    "for each terminal separately",
    "takes no focus or clicks",
    "never changes the terminal size",
    "is not announced by screen readers as it changes",
    "sends nothing to the shell or the seat",
    "turning it back on starts again from zero",
    "The size readout of terminal.showSizeOnResize stays at the top center",
  ])
    assert.ok(lines[at].includes(part), "TERMINALS.md must say: " + part);
  // The numbers the paragraph quotes are the code's.
  assert.equal(counter.OUTPUT_COUNTER_MIN_INTERVAL_MS, 250);
  assert.equal(1000 / counter.OUTPUT_COUNTER_MIN_INTERVAL_MS, 4);
});

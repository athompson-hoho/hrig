"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const core = require("../electron/core.cjs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
    logLevel: "silent",
  }).outputFiles[0].text;
}
function load(entry, fakes = {}) {
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod.require = (id) => (id in fakes ? fakes[id] : require(id));
  mod._compile(bundle(entry, Object.keys(fakes)), mod.filename);
  return mod.exports;
}
const lib = load("src/seat-attention.ts");
const settings = load("src/settings.ts");
const KEY = "notifications.seatNeedsInputSound";

// A seat as the sidebar holds it after normalizeInventory.
const seat = (id, status = "working", over = {}) => ({
  id,
  rigId: "r",
  rigName: "rig",
  name: String(id).split(":").pop(),
  pod: "",
  runtime: "codex",
  model: "",
  session: "x-" + id + "@rig",
  status,
  activity: "",
  error: "",
  workCount: 0,
  ...over,
});
const waiting = (id, over = {}) => seat("r:" + id, "attention", over);
const idle = (id, over = {}) => seat("r:" + id, "idle", over);
const step = (state, seats, now = 100000, key = "k") =>
  lib.nextAttention(state, key, seats, now);

test("seat-attention rules: the first answer only seeds, a seat that newly waits sounds once, a seat that keeps waiting does not, one that returns sounds again, the pause holds back and defers, a burst is one sound, a switch starts over and the clock never blocks", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "MAX_ATTENTION_SEATS",
    "MAX_SEAT_ID",
    "NO_ATTENTION",
    "SOUND_COOLDOWN_MS",
    "isPersonSeat",
    "nextAttention",
  ]);
  assert.equal(lib.SOUND_COOLDOWN_MS, 10000);
  assert.equal(lib.MAX_ATTENTION_SEATS, 500);
  assert.equal(lib.MAX_SEAT_ID, 200);
  assert.ok(Object.isFrozen(lib.NO_ATTENTION));
  assert.deepEqual(lib.NO_ATTENTION, {
    connectionKey: "",
    attention: null,
    lastPlayed: null,
  });

  // First answer: seats already waiting are taken in, silently.
  let s = step(lib.NO_ATTENTION, [waiting("a"), waiting("b"), idle("c")]);
  assert.equal(s.play, false);
  assert.deepEqual(s.state, {
    connectionKey: "k",
    attention: ["r:a", "r:b"],
    lastPlayed: null,
  });
  // Still waiting at later answers: no sound, however often.
  for (let t = 1; t <= 5; t++) {
    s = step(
      s.state,
      [waiting("a"), waiting("b"), idle("c")],
      100000 + t * 60000,
    );
    assert.equal(s.play, false);
  }
  // A seat that newly waits sounds, once, and the sound time is kept.
  s = step(s.state, [waiting("a"), waiting("b"), waiting("c")], 500000);
  assert.equal(s.play, true);
  assert.equal(s.state.lastPlayed, 500000);
  assert.deepEqual(s.state.attention, ["r:a", "r:b", "r:c"]);
  s = step(s.state, [waiting("a"), waiting("b"), waiting("c")], 600000);
  assert.equal(s.play, false);
  assert.equal(s.state.lastPlayed, 500000, "a silent answer keeps the time");

  // A seat that stops waiting and waits again is new again (after the pause).
  s = step(s.state, [waiting("a"), waiting("b"), idle("c")], 700000);
  assert.equal(s.play, false);
  assert.deepEqual(s.state.attention, ["r:a", "r:b"]);
  s = step(s.state, [waiting("a"), waiting("b"), waiting("c")], 800000);
  assert.equal(s.play, true);

  // Only the status attention counts, exactly.
  let t0 = step(lib.NO_ATTENTION, []);
  for (const status of [
    "failed",
    "stopped",
    "exited",
    "running",
    "working",
    "idle",
    "unknown",
    "needs_input",
    "Attention",
    "attention ",
    "",
  ]) {
    const r = step(t0.state, [seat("r:x", status)], 200000);
    assert.equal(r.play, false, JSON.stringify(status));
    assert.deepEqual(r.state.attention, []);
  }

  // The pause: a new seat inside it is held back, not lost.
  let p = step(lib.NO_ATTENTION, [idle("a"), idle("b")], 0);
  p = step(p.state, [waiting("a"), idle("b")], 20000);
  assert.equal(p.play, true);
  assert.equal(p.state.lastPlayed, 20000);
  const held = step(p.state, [waiting("a"), waiting("b")], 20000 + 9999);
  assert.equal(held.play, false);
  assert.deepEqual(held.state.attention, ["r:a"], "b is not marked as seen");
  assert.equal(held.state.lastPlayed, 20000);
  const late = step(held.state, [waiting("a"), waiting("b")], 20000 + 10000);
  assert.equal(late.play, true, "at exactly the pause it is allowed");
  assert.deepEqual(late.state.attention, ["r:a", "r:b"]);
  assert.equal(late.state.lastPlayed, 30000);
  // A seat that came and left inside the pause never sounds.
  const gone = step(held.state, [waiting("a"), idle("b")], 50000);
  assert.equal(gone.play, false);
  assert.deepEqual(gone.state.attention, ["r:a"]);
  const never = step(gone.state, [waiting("a"), idle("b")], 90000);
  assert.equal(never.play, false);

  // A burst of five new seats is one sound.
  let b = step(lib.NO_ATTENTION, [
    idle("1"),
    idle("2"),
    idle("3"),
    idle("4"),
    idle("5"),
  ]);
  b = step(
    b.state,
    ["1", "2", "3", "4", "5"].map((n) => waiting(n)),
    900000,
  );
  assert.equal(b.play, true);
  assert.equal(b.state.attention.length, 5);
  b = step(
    b.state,
    ["1", "2", "3", "4", "5"].map((n) => waiting(n)),
    1900000,
  );
  assert.equal(b.play, false);

  // A switch to another connection only seeds again and keeps the pause.
  let c = step(lib.NO_ATTENTION, [idle("a")], 0, "one");
  c = step(c.state, [waiting("a")], 20000, "one");
  assert.equal(c.play, true);
  const other = step(c.state, [waiting("a"), waiting("z")], 21000, "two");
  assert.equal(other.play, false);
  assert.equal(other.state.connectionKey, "two");
  assert.deepEqual(other.state.attention, ["r:a", "r:z"]);
  assert.equal(other.state.lastPlayed, 20000, "the pause survives a switch");
  const back = step(other.state, [waiting("a")], 90000, "one");
  assert.equal(back.play, false, "coming back seeds again");
  assert.deepEqual(back.state.attention, ["r:a"]);

  // A clock that moved backwards never blocks; a clock that is not a number does not sound.
  let w = step(lib.NO_ATTENTION, [idle("a")], 5000);
  w = step(w.state, [waiting("a")], 100000);
  assert.equal(w.play, true);
  w = step(w.state, [waiting("a"), waiting("b")], 1000);
  assert.equal(w.play, true, "now is before the last sound");
  assert.equal(w.state.lastPlayed, 1000);
  let n = step(lib.NO_ATTENTION, [idle("a")], 0);
  for (const now of [NaN, Infinity, undefined, "5", null]) {
    const r = lib.nextAttention(n.state, "k", [waiting("a")], now);
    assert.equal(r.play, false);
    assert.deepEqual(r.state.attention, [], "the seat stays unseen");
    assert.equal(step(r.state, [waiting("a")], 100000).play, true);
  }

  // The same seat twice counts once; an answer that is not a list changes nothing.
  const d = step(lib.NO_ATTENTION, [waiting("a"), waiting("a")]);
  assert.deepEqual(d.state.attention, ["r:a"]);
  for (const bad of [null, undefined, {}, "seats", 7, { length: 3 }]) {
    const r = step(d.state, bad, 999999);
    assert.equal(r.play, false);
    assert.deepEqual(r.state, d.state);
  }
  const first = step(lib.NO_ATTENTION, null);
  assert.equal(first.play, false);
  assert.equal(
    first.state.attention,
    null,
    "nothing was seen, nothing is seeded",
  );
  assert.equal(
    step(first.state, [waiting("a")]).play,
    false,
    "the first list is still taken in silently",
  );

  // Pure: the state and the seats are never changed.
  const frozenState = deepFreeze({
    connectionKey: "k",
    attention: ["r:a"],
    lastPlayed: null,
  });
  const frozenSeats = deepFreeze([waiting("a"), waiting("b")]);
  const f = step(frozenState, frozenSeats, 100000);
  assert.equal(f.play, true);
  assert.notEqual(f.state, frozenState);
  assert.deepEqual(frozenState.attention, ["r:a"]);
});

test("seat-attention hostile: rows, ids, state and keys of any shape never throw or sound by themselves, ids are only compared, and at most 500 rows are ever read", () => {
  const rows = [
    null,
    undefined,
    5,
    "text",
    true,
    [],
    [["attention"]],
    {},
    { status: "attention" },
    { id: "", status: "attention" },
    { id: 5, status: "attention" },
    { id: null, status: "attention" },
    { id: ["r:a"], status: "attention" },
    { id: "x".repeat(201), status: "attention" },
    { id: "r:ok", status: ["attention"] },
    { id: "r:ok", status: { toString: () => "attention" } },
    ,
    ,
  ];
  let h = step(lib.NO_ATTENTION, []);
  const none = step(h.state, rows, 200000);
  assert.equal(none.play, false);
  assert.deepEqual(none.state.attention, [], "no hostile row counts");
  // Ids that are legal text are ordinary ids, whatever they look like.
  const odd = [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "x".repeat(200),
  ];
  const hits = step(
    h.state,
    odd.map((id) => ({ id, status: "attention" })),
    200000,
  );
  assert.equal(hits.play, true);
  assert.deepEqual(hits.state.attention, odd);
  assert.equal(
    step(
      hits.state,
      odd.map((id) => ({ id, status: "attention" })),
      900000,
    ).play,
    false,
  );
  assert.equal(
    Object.keys(Object.prototype).length,
    0,
    "nothing was added to Object.prototype",
  );
  assert.equal(Object.getPrototypeOf(hits.state), Object.prototype);

  // Only ids come out: a hostile row's other text is never kept.
  const text = "<img src=x onerror=alert(1)>\u202e\u200b";
  const kept = step(
    h.state,
    [waiting("a", { name: text, activity: text, error: text, rigName: text })],
    200000,
  );
  assert.equal(JSON.stringify(kept).includes("img"), false);
  assert.deepEqual(Object.keys(kept).sort(), ["play", "state"]);
  assert.deepEqual(Object.keys(kept.state).sort(), [
    "attention",
    "connectionKey",
    "lastPlayed",
  ]);

  // A state that is not one is NO_ATTENTION: it seeds, it never sounds.
  const bad = [
    null,
    undefined,
    5,
    "state",
    [],
    {},
    { connectionKey: 5, attention: [], lastPlayed: null },
    { connectionKey: "k", attention: "r:a", lastPlayed: null },
    { connectionKey: "k", attention: [1], lastPlayed: null },
    { connectionKey: "k", attention: [], lastPlayed: "1" },
    { connectionKey: "k", attention: [], lastPlayed: NaN },
    { connectionKey: "k", attention: [], lastPlayed: Infinity },
    { connectionKey: "k", attention: [], lastPlayed: undefined },
    { connectionKey: "k", attention: undefined, lastPlayed: null },
    {
      connectionKey: "k",
      attention: Array.from({ length: 501 }, (_, i) => "id" + i),
      lastPlayed: null,
    },
  ];
  for (const state of bad) {
    const r = lib.nextAttention(state, "k", [waiting("a")], 300000);
    assert.equal(r.play, false, JSON.stringify(state));
    assert.deepEqual(r.state, {
      connectionKey: "k",
      attention: ["r:a"],
      lastPlayed: null,
    });
  }
  // A key that is not text changes nothing.
  const seeded = step(lib.NO_ATTENTION, [waiting("a")]);
  for (const key of [5, null, undefined, {}, ["k"]]) {
    const r = lib.nextAttention(
      seeded.state,
      key,
      [waiting("a"), waiting("b")],
      1e9,
    );
    assert.equal(r.play, false);
    assert.deepEqual(r.state, seeded.state);
  }

  // At most 500 rows are read: later rows are never touched, and what is kept stays small.
  const many = Array.from({ length: 10000 }, (_, i) => waiting("n" + i));
  for (let i = 500; i < many.length; i++)
    Object.defineProperty(many, i, {
      get() {
        throw new Error("row " + i + " was read");
      },
    });
  const big = step(lib.NO_ATTENTION, many);
  assert.equal(big.play, false);
  assert.equal(big.state.attention.length, 500);
  assert.equal(big.state.attention[499], "r:n499");
  const again = step(big.state, many, 900000);
  assert.equal(again.play, false, "the same rows never sound twice");
  assert.equal(again.state.attention.length, 500);
  // Exactly one more than the 500th is beyond the cap; the 500th itself counts.
  const edge = [
    ...Array.from({ length: 499 }, (_, i) => idle("e" + i)),
    idle("last"),
    idle("beyond"),
  ];
  let e = step(lib.NO_ATTENTION, edge);
  const flipped = edge.map((s) => ({ ...s, status: "attention" }));
  e = step(e.state, flipped, 900000);
  assert.equal(e.play, true);
  assert.equal(e.state.attention.length, 500);
  assert.ok(e.state.attention.includes("r:last"), "the 500th row counts");
  assert.ok(!e.state.attention.includes("r:beyond"), "the 501st does not");
});

test("seat-attention person: a seat that looks like a person never sounds and is never remembered, and a name that only looks close does", () => {
  for (const row of [
    { name: "human" },
    { name: "Human" },
    { name: "HUMAN-wrk" },
    { name: "human.wrk" },
    { session: "human@kernel" },
    { session: "human-wrk@host" },
    { session: "human-wrk@some-rig" },
    { session: "alice@external" },
    { runtime: "human" },
    { runtime: "Human" },
  ])
    assert.equal(lib.isPersonSeat(row), true, JSON.stringify(row));
  for (const row of [
    { name: "humanoid" },
    { name: "human-" },
    { name: "inhuman" },
    { name: "human_wrk" },
    { name: "dev-impl", session: "dev-impl@rig", runtime: "codex" },
    { session: "alice@elsewhere" },
    { session: "@external" },
    { runtime: "humans" },
    { name: "human".padEnd(201, "x") },
    { name: ["human"] },
    { name: 5, session: 5, runtime: 5 },
    {},
    null,
    undefined,
    5,
    "human",
    ["human"],
  ])
    assert.equal(lib.isPersonSeat(row), false, JSON.stringify(row));

  const base = step(lib.NO_ATTENTION, [idle("a")]);
  const person = [
    waiting("p1", { name: "human-wrk", session: "human-wrk@kernel" }),
    waiting("p2", { runtime: "human" }),
    waiting("p3", { session: "bob@external" }),
  ];
  let r = step(base.state, person, 200000);
  assert.equal(r.play, false);
  assert.deepEqual(r.state.attention, []);
  r = step(r.state, [...person, waiting("a")], 300000);
  assert.equal(r.play, true, "an agent seat beside them still sounds");
  assert.deepEqual(r.state.attention, ["r:a"]);
  // The first answer does not remember them either.
  const seeded = step(lib.NO_ATTENTION, [...person, waiting("a")]);
  assert.deepEqual(seeded.state.attention, ["r:a"]);
});

// ---------------------------------------------------------------------------
// The real hook over a very small react (refs, and effects queued and run
// after the render that asked for them), with the clock and the audio output
// replaced. The page itself is refused to the feature: any use of window
// throws.
const reactNow = { current: null };
const react = {
  useRef: (initial) => reactNow.current.useRef(initial),
  useEffect: (fn, list) => reactNow.current.useEffect(fn, list),
};
const loadHook = () => load("src/useSeatNeedsInputSound.ts", { react });
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

/** A stand-in for AudioContext that records what was asked of it. */
function fakeAudio({
  resume = "ok",
  ctorThrows = false,
  nodeThrows = false,
} = {}) {
  const made = { contexts: [], oscillators: [], gains: [], release: null };
  class FakeAudioContext {
    constructor() {
      if (ctorThrows) throw new Error("no audio device");
      this.state = "suspended";
      this.currentTime = 10;
      this.destination = { kind: "destination" };
      this.calls = [];
      made.contexts.push(this);
    }
    resume() {
      this.calls.push("resume");
      if (resume === "reject") return Promise.reject(new Error("blocked"));
      if (resume === "hang")
        return new Promise((resolve) => {
          made.release = () => {
            this.state = "running";
            resolve();
          };
        });
      this.state = "running";
      return Promise.resolve();
    }
    suspend() {
      this.calls.push("suspend");
      this.state = "suspended";
      return Promise.resolve();
    }
    createOscillator() {
      if (nodeThrows) throw new Error("cannot create");
      const node = {
        type: "",
        frequency: { value: 0 },
        connected: [],
        disconnected: false,
        started: null,
        stopped: null,
        onended: null,
        connect(next) {
          this.connected.push(next);
        },
        disconnect() {
          this.disconnected = true;
        },
        start(at) {
          this.started = at;
        },
        stop(at) {
          this.stopped = at;
        },
      };
      made.oscillators.push(node);
      return node;
    }
    createGain() {
      const node = {
        connected: [],
        disconnected: false,
        gain: {
          events: [],
          setValueAtTime(value, at) {
            this.events.push(["set", value, at]);
          },
          linearRampToValueAtTime(value, at) {
            this.events.push(["ramp", value, at]);
          },
        },
        connect(next) {
          this.connected.push(next);
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      made.gains.push(node);
      return node;
    }
  }
  return { Context: FakeAudioContext, made };
}

const CONNECTION = { id: "local", name: "Local", kind: "ssh", host: "box" };
const OTHER = { id: "other", name: "Other", kind: "ssh", host: "far" };

function hookHarness({
  enabled = true,
  connection = CONNECTION,
  seats = null,
  inventoryError = "",
  audio = {},
  noAudio = false,
  webkitOnly = false,
} = {}) {
  const mod = loadHook();
  const fake = fakeAudio(audio);
  const refs = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let pending = [];
  const props = { enabled, connection, seats, inventoryError };
  const calls = { log: [] };
  const clock = { now: 1000000 };
  const before = {
    window: globalThis.window,
    AudioContext: globalThis.AudioContext,
    webkit: globalThis.webkitAudioContext,
    now: Date.now,
  };
  const mine = {
    useRef(initial) {
      const i = cursor++;
      if (!(i in refs)) refs[i] = { current: initial };
      return refs[i];
    },
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (
        !old ||
        list.length !== old.length ||
        list.some((d, k) => d !== old[k])
      ) {
        deps[i] = list;
        pending.push(() => {
          if (cleanups[i]) cleanups[i]();
          cleanups[i] = fn();
        });
      }
    },
  };
  const install = () => {
    globalThis.window = new Proxy(
      {},
      {
        get(_target, name) {
          throw new Error("the feature touched the page: " + String(name));
        },
      },
    );
    delete globalThis.webkitAudioContext;
    if (noAudio) delete globalThis.AudioContext;
    else if (webkitOnly) {
      delete globalThis.AudioContext;
      globalThis.webkitAudioContext = fake.Context;
    } else globalThis.AudioContext = fake.Context;
    Date.now = () => clock.now;
  };
  const harness = {
    mod,
    made: fake.made,
    calls,
    clock,
    props,
    render(next = {}) {
      Object.assign(props, next);
      reactNow.current = mine;
      install();
      cursor = 0;
      mod.useSeatNeedsInputSound({
        ...props,
        log: (text) => calls.log.push(text),
      });
      const run = pending;
      pending = [];
      run.forEach((fn) => fn());
    },
    async show(next = {}) {
      harness.render(next);
      await settle();
    },
    /** Tones started so far. */
    tones: () => fake.made.oscillators.filter((o) => o.started !== null).length,
    close() {
      cleanups.forEach((fn) => fn && fn());
      globalThis.window = before.window;
      if (before.window === undefined) delete globalThis.window;
      if (before.AudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = before.AudioContext;
      if (before.webkit !== undefined)
        globalThis.webkitAudioContext = before.webkit;
      else delete globalThis.webkitAudioContext;
      Date.now = before.now;
    },
  };
  return harness;
}

// A CLI node row (the fields `rig ps --nodes --json` prints that the
// inventory reads) and the rigs list around it.
const cliRig = {
  rigId: "r1",
  name: "factory",
  status: "running",
  nodeCount: 6,
};
const cliNode = (name, over = {}) => ({
  rigId: "r1",
  rigName: "factory",
  logicalId: name,
  podNamespace: "dev",
  runtime: "codex",
  model: "gpt-5",
  canonicalSessionName: name + "@factory",
  sessionStatus: "running",
  agentActivity: { state: "running" },
  terminalActive: true,
  ...over,
});
const inventoryOf = (nodes) => core.normalizeInventory([cliRig], nodes);

test("seat-attention tracer: a CLI inventory goes through the real normalizer, the real pure module, the real hook and a stand-in audio output: silent while it is off and on the first answer, then one soft tone for a seat that newly asks", async () => {
  const base = [
    cliNode("busy"),
    cliNode("quiet", { sessionStatus: "stopped", agentActivity: undefined }),
    cliNode("asking", { needsAttention: true }),
    cliNode("broken", { sessionStatus: "failed", latestError: "boom" }),
  ];
  const first = inventoryOf(base);
  assert.deepEqual(
    first.seats.map((s) => [s.name, s.status]),
    [
      ["busy", "working"],
      ["quiet", "stopped"],
      ["asking", "attention"],
      ["broken", "failed"],
    ],
  );
  // Off by default: whatever happens, nothing sounds and no audio is created.
  assert.equal(settings.defaults[KEY], false);
  assert.equal(settings.resolveSettings({})[KEY], false);
  const off = hookHarness({ enabled: settings.resolveSettings({})[KEY] });
  try {
    await off.show({ seats: first.seats });
    const wake = inventoryOf([
      ...base,
      cliNode("late", { needsAttention: true }),
    ]);
    off.clock.now += 60000;
    await off.show({ seats: wake.seats });
    assert.equal(off.tones(), 0);
    assert.equal(off.made.contexts.length, 0, "no audio context was created");
  } finally {
    off.close();
  }

  const on = hookHarness({ enabled: true });
  try {
    // The first answer holds a seat that already asks: silent, and no audio yet.
    await on.show({ seats: first.seats });
    assert.equal(on.tones(), 0);
    assert.equal(on.made.contexts.length, 0, "the context is created lazily");
    // The same answer again, and a refresh that changes nothing: silent.
    on.clock.now += 20000;
    await on.show({ seats: inventoryOf(base).seats });
    assert.equal(on.tones(), 0);
    // A working seat now waits for input (the CLI says needs_input): one tone.
    on.clock.now += 20000;
    const next = inventoryOf([
      cliNode("busy", { agentActivity: { state: "needs_input" } }),
      ...base.slice(1),
    ]);
    assert.equal(next.seats[0].status, "attention");
    await on.show({ seats: next.seats });
    assert.equal(on.tones(), 1);
    assert.equal(on.made.contexts.length, 1);
    const [osc] = on.made.oscillators;
    assert.equal(osc.type, "sine");
    assert.equal(osc.frequency.value, on.mod.TONE_HZ);
    assert.ok(osc.stopped - osc.started < 1, "under a second");
    const gains = on.made.gains[0].gain.events.map((e) => e[1]);
    assert.ok(Math.max(...gains) > 0 && Math.max(...gains) <= 0.1);
    assert.deepEqual(on.calls.log, []);
    // A session that failed with an error is not needs-input: no tone.
    on.clock.now += 20000;
    const failed = inventoryOf([
      cliNode("busy", { agentActivity: { state: "needs_input" } }),
      cliNode("quiet", { sessionStatus: "stopped", agentActivity: undefined }),
      cliNode("asking", { needsAttention: true }),
      cliNode("broken", { sessionStatus: "failed", latestError: "boom" }),
      cliNode("crashed", { sessionStatus: "failed", latestError: "bad" }),
    ]);
    await on.show({ seats: failed.seats });
    assert.equal(on.tones(), 1);
  } finally {
    on.close();
  }
  // Known limit, documented: the inventory gives a startup that failed or needs attention the same status as needs-input, so it sounds too.
  const startup = inventoryOf([
    cliNode("booting", { startupStatus: "attention_required" }),
  ]);
  assert.equal(startup.seats[0].status, "attention");
});

test("seat-attention tone: a single sine tone at a capped gain under a second, one lazily created context reused, a late or refused tone dropped, and nothing ever throws", async () => {
  const run = async (opts, body) => {
    const h = hookHarness({ enabled: false, ...opts });
    try {
      h.render();
      return await body(h);
    } finally {
      h.close();
    }
  };
  assert.equal(settings.defaults[KEY], false);
  // The numbers: soft, short, a plain tone.
  await run({}, async (h) => {
    assert.equal(h.mod.TONE_HZ, 880);
    assert.ok(h.mod.TONE_GAIN > 0 && h.mod.TONE_GAIN <= 0.1);
    assert.ok(h.mod.TONE_SECONDS > 0 && h.mod.TONE_SECONDS < 1);
    assert.ok(h.mod.TONE_FADE_SECONDS * 2 < h.mod.TONE_SECONDS);
    assert.ok(h.mod.TONE_LATE_MS > 0 && h.mod.TONE_LATE_MS <= 2000);
    assert.equal(
      h.made.contexts.length,
      0,
      "nothing exists before the first tone",
    );
    // First tone: the context is created, asked to run, and the tone starts once it runs.
    assert.equal(h.mod.playAttentionTone(), true);
    assert.equal(h.made.contexts.length, 1);
    await settle();
    const ctx = h.made.contexts[0];
    assert.equal(ctx.calls[0], "resume");
    assert.equal(h.tones(), 1);
    const [osc] = h.made.oscillators;
    const [gain] = h.made.gains;
    assert.equal(osc.type, "sine");
    assert.equal(osc.frequency.value, 880);
    assert.deepEqual(osc.connected, [gain]);
    assert.deepEqual(gain.connected, [ctx.destination]);
    assert.equal(osc.started, 10);
    assert.ok(osc.stopped > osc.started && osc.stopped - osc.started < 1);
    const values = gain.gain.events.map((e) => e[1]);
    assert.ok(values.every((v) => v >= 0 && v <= h.mod.TONE_GAIN));
    assert.equal(values[0], 0, "it starts from silence");
    assert.equal(values[values.length - 1], 0, "and ends in silence");
    const times = gain.gain.events.map((e) => e[2]);
    assert.ok(times.every((t) => t >= osc.started && t <= osc.stopped));
    assert.deepEqual(
      [...times].sort((a, b) => a - b),
      times,
      "the fades are in order",
    );
    // When it ends it lets go and the output is not held open.
    osc.onended();
    await settle();
    assert.equal(osc.disconnected && gain.disconnected, true);
    assert.equal(ctx.calls[ctx.calls.length - 1], "suspend");
    // Second tone: the same context, no second one.
    assert.equal(h.mod.playAttentionTone(), true);
    await settle();
    assert.equal(h.made.contexts.length, 1);
    assert.equal(h.tones(), 2);
    // Two tones at once: the output stays until the last one ends.
    assert.equal(h.mod.playAttentionTone(), true);
    await settle();
    const [, second, third] = h.made.oscillators;
    const callsBefore = ctx.calls.length;
    second.onended();
    assert.equal(ctx.calls.length, callsBefore, "one is still sounding");
    third.onended();
    assert.equal(ctx.calls[ctx.calls.length - 1], "suspend");
  });
  // Refused or hanging output: no tone, no throw.
  await run({ audio: { resume: "reject" } }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), true);
    await settle();
    assert.equal(h.tones(), 0);
  });
  await run({ audio: { resume: "hang" } }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), true);
    await settle();
    assert.equal(h.tones(), 0, "nothing plays before the output runs");
    h.clock.now += h.mod.TONE_LATE_MS - 1;
    h.made.release();
    await settle();
    assert.equal(h.tones(), 1, "just in time it still plays");
  });
  await run({ audio: { resume: "hang" } }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), true);
    h.clock.now += h.mod.TONE_LATE_MS + 1;
    h.made.release();
    await settle();
    assert.equal(h.tones(), 0, "a tone that would start late is dropped");
  });
  // No audio at all, a context that cannot be created, a node that cannot be made: false or silent, never a throw.
  await run({ noAudio: true }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), false);
    assert.equal(h.made.contexts.length, 0);
  });
  await run({ webkitOnly: true }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), true, "the prefixed name works");
    await settle();
    assert.equal(h.tones(), 1);
  });
  await run({ audio: { ctorThrows: true } }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), false);
    assert.equal(h.mod.playAttentionTone(), false, "it tries again next time");
  });
  await run({ audio: { nodeThrows: true } }, async (h) => {
    assert.equal(h.mod.playAttentionTone(), true);
    await settle();
    assert.equal(h.tones(), 0);
  });
});

test("seat-attention hook: silent first answer, a tone for a new seat, the pause, a stale or failing list ignored, a connection switch that starts over, a switch off that forgets, and one log line if there is no audio", async () => {
  const A = (id) => waiting(id);
  const I = (id) => idle(id);
  // Silent first answer; a new seat sounds; seats that keep waiting do not.
  let h = hookHarness();
  try {
    await h.show();
    await h.show({ seats: [A("a"), I("b")] });
    assert.equal(h.tones(), 0);
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), I("b")] });
    assert.equal(h.tones(), 0);
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), A("b")] });
    assert.equal(h.tones(), 1);
    // The pause: a seat inside it waits for the first answer after it.
    h.clock.now += 3000;
    await h.show({ seats: [A("a"), A("b"), A("c")] });
    assert.equal(h.tones(), 1);
    h.clock.now += 3000;
    await h.show({ seats: [A("a"), A("b"), A("c"), I("d")] });
    assert.equal(h.tones(), 1);
    h.clock.now += 4000;
    await h.show({ seats: [A("a"), A("b"), A("c"), I("d")] });
    assert.equal(h.tones(), 2, "held back, then sounded once");
    h.clock.now += 40000;
    await h.show({ seats: [A("a"), A("b"), A("c"), I("d")] });
    assert.equal(h.tones(), 2);
    assert.deepEqual(h.calls.log, []);
  } finally {
    h.close();
  }

  // Enabled later: what already waits is taken in silently. Switched off: everything is forgotten.
  h = hookHarness({ enabled: false });
  try {
    await h.show();
    await h.show({ seats: [A("a")] });
    h.clock.now += 20000;
    await h.show({ enabled: true });
    assert.equal(h.tones(), 0, "turning it on is silent");
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), A("b")] });
    assert.equal(h.tones(), 1);
    h.clock.now += 20000;
    await h.show({ enabled: false });
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), A("b"), A("c")] });
    assert.equal(h.tones(), 1, "off is silent");
    h.clock.now += 20000;
    await h.show({ enabled: true });
    assert.equal(h.tones(), 1, "on again is silent: c is taken in");
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), A("b"), A("c"), A("d")] });
    assert.equal(h.tones(), 2);
  } finally {
    h.close();
  }

  // A failing refresh (an error with the last list still shown) and no list at all are skipped.
  h = hookHarness();
  try {
    await h.show();
    await h.show({ seats: [I("a")] });
    h.clock.now += 20000;
    await h.show({ seats: [A("a")], inventoryError: "rig is not reachable" });
    assert.equal(h.tones(), 0);
    await h.show({ seats: null, inventoryError: "" });
    assert.equal(h.tones(), 0);
    h.clock.now += 20000;
    await h.show({ seats: [A("a")], inventoryError: "" });
    assert.equal(h.tones(), 1, "it sounds when a good list shows the seat");
  } finally {
    h.close();
  }

  // A connection switch: the list still handed in belongs to the old connection, and the first list of the new one only seeds.
  h = hookHarness();
  try {
    const one = [A("x")];
    await h.show();
    await h.show({ seats: one });
    h.clock.now += 60000;
    await h.show({ connection: OTHER, seats: one });
    assert.equal(h.tones(), 0, "the stale list is ignored");
    await h.show({ seats: null, inventoryError: "checking" });
    await h.show({ seats: [A("x"), A("y")], inventoryError: "checking" });
    assert.equal(h.tones(), 0, "the cached list is ignored too");
    h.clock.now += 60000;
    await h.show({ seats: [A("x"), A("y")], inventoryError: "" });
    assert.equal(
      h.tones(),
      0,
      "the first list of the new connection only seeds",
    );
    h.clock.now += 60000;
    await h.show({ seats: [A("x"), A("y"), A("z")] });
    assert.equal(h.tones(), 1);
    // And back: again silent first.
    h.clock.now += 60000;
    const stale = [A("x"), A("y"), A("z")];
    await h.show({ connection: CONNECTION, seats: stale });
    await h.show({ seats: [A("x"), A("n")] });
    assert.equal(h.tones(), 1, "coming back seeds again");
  } finally {
    h.close();
  }

  // No audio on this system: one line in the activity log, once, and nothing thrown.
  h = hookHarness({ noAudio: true });
  try {
    await h.show();
    await h.show({ seats: [I("a")] });
    h.clock.now += 20000;
    await h.show({ seats: [A("a")] });
    assert.deepEqual(h.calls.log, [
      "The attention sound is not available on this system.",
    ]);
    h.clock.now += 20000;
    await h.show({ seats: [A("a"), A("b")] });
    assert.equal(h.calls.log.length, 1, "logged once");
    assert.equal(h.tones(), 0);
  } finally {
    h.close();
  }
});

test("seat-attention wiring: the setting is off by default and sits right after the queue item setting, App.tsx adds one import and one call, the pure module and the hook are plain and documented, and there is no audio file and no bridge call", () => {
  // The setting.
  const rows = settings.schema.filter((row) => row.key === KEY);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(settings.defaults[KEY], false);
  assert.equal(row.category, "Notifications");
  assert.equal(row.label, "Sound when a seat needs input");
  for (const field of ["options", "min", "max", "step"])
    assert.equal(row[field], undefined, field);
  const keys = settings.schema.map((r) => r.key);
  assert.equal(keys.indexOf(KEY), keys.indexOf("notifications.humanItems") + 1);
  assert.equal(keys[keys.indexOf(KEY) + 1], "shortcuts.overrides");
  assert.equal(keys[keys.length - 1], "shortcuts.overrides");
  const order = Object.keys(settings.defaults);
  assert.equal(
    order.indexOf(KEY),
    order.indexOf("notifications.humanItems") + 1,
  );
  assert.equal(order[order.indexOf(KEY) + 1], "shortcuts.overrides");
  for (const value of [true, false])
    assert.deepEqual(settings.validateOverrides({ [KEY]: value }), {
      [KEY]: value,
    });
  for (const value of ["true", 1, 0, null, {}, []])
    assert.throws(
      () => settings.validateOverrides({ [KEY]: value }),
      (error) => error.message === "Wrong value type for " + KEY,
    );
  // Separate from the desktop notification: neither implies the other.
  assert.equal(
    settings.resolveSettings({ [KEY]: true })["notifications.desktop"],
    false,
  );
  assert.equal(
    settings.resolveSettings({ "notifications.desktop": true })[KEY],
    false,
  );
  assert.equal(
    settings.resolveSettings({ [KEY]: true }, { [KEY]: false })[KEY],
    false,
  );

  // The pure module: no import, no page, no clock, no randomness, plain ASCII, every export documented.
  const mod = read("src/seat-attention.ts");
  const modCode = stripComments(mod);
  assert.ok(!/[^\n\t -~]/.test(mod), "plain ASCII");
  assert.equal(count(modCode, ' from "'), 0, "no import");
  assert.ok(
    !/(^|[^A-Za-z.])(window|document|fetch|process|require|localStorage|sessionStorage|navigator|setTimeout|setInterval|console|AudioContext)([^A-Za-z]|$)|Date\.now|new Date|Math\.random|innerHTML/.test(
      modCode,
    ),
    "pure",
  );
  const exportLines = mod.split("\n").filter((l) => l.startsWith("export "));
  assert.equal(exportLines.length, 7);
  mod.split("\n").forEach((line, i, lines) => {
    if (line.startsWith("export "))
      assert.ok(
        lines[i - 1].trim().endsWith("*/"),
        "documented: " + line.slice(0, 40),
      );
  });

  // The hook and the tone: three imports, no page, no bridge, no network or storage, no audio element or file, one context.
  const hook = read("src/useSeatNeedsInputSound.ts");
  const hookCode = stripComments(hook);
  assert.ok(!/[^\n\t -~]/.test(hook), "plain ASCII");
  assert.deepEqual(
    [...hookCode.matchAll(/from "([^"]+)";/g)].map((m) => m[1]),
    ["react", "./types", "./seat-attention"],
  );
  assert.ok(
    !/\b(window|document|hrig|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|navigator|setTimeout|setInterval|hasFocus|notifyAttention|Math\.random|innerHTML|Audio|webkitAudioContext\.prototype|decodeAudioData|createBufferSource|createMediaElementSource)\b/.test(
      hookCode.replace(/AudioContext|webkitAudioContext/g, ""),
    ),
    "no page, bridge, network, storage, audio element, buffer or focus check",
  );
  assert.equal(
    count(hookCode, "new Context()"),
    1,
    "one place creates the context",
  );
  assert.equal(count(hookCode, "createOscillator()"), 1);
  assert.equal(count(hookCode, 'oscillator.type = "sine";'), 1);
  assert.ok(
    !/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)\b|data:audio/i.test(hook),
    "no audio file",
  );
  assert.equal(
    hook.split("\n").filter((l) => l.startsWith("export ")).length,
    7,
  );
  hook.split("\n").forEach((line, i, lines) => {
    if (line.startsWith("export "))
      assert.ok(
        lines[i - 1].trim().endsWith("*/"),
        "documented: " + line.slice(0, 40),
      );
  });
  const audioFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const child = dir + "/" + entry.name;
      if (entry.isDirectory()) walk(child);
      else if (/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm|mid)$/i.test(entry.name))
        audioFiles.push(child);
    }
  };
  for (const dir of ["src", "assets", "public", "electron"])
    if (fs.existsSync(path.join(root, dir))) walk(dir);
  assert.deepEqual(
    audioFiles,
    [],
    "the tone is made in code, not played from a file",
  );

  // App.tsx: one import and one call, right after the queue item hook, the notification effect untouched.
  const app = read("src/App.tsx");
  assert.equal(
    count(
      app,
      'import { useSeatNeedsInputSound } from "./useSeatNeedsInputSound";',
    ),
    1,
  );
  assert.equal(count(app, "useSeatNeedsInputSound("), 1);
  assert.equal(
    collapse(between(app, "useSeatNeedsInputSound({", "});")),
    'useSeatNeedsInputSound({ enabled: loaded && preferences["notifications.seatNeedsInputSound"], connection, seats: inventory?.seats ?? null, inventoryError, log,',
  );
  const sound = app.indexOf("useSeatNeedsInputSound({");
  const items = app.indexOf("useHumanItemNotices({");
  const attentionEnd = app.indexOf(
    // The long-list chain's notification effect, which depends on the pin owner, the error and the inventory health too.
    "inventoryHealth.current.failures]);",
  );
  assert.ok(attentionEnd > 0 && items > attentionEnd && sound > items);
  assert.ok(
    collapse(app.slice(items, sound)).endsWith("refresh, log, });"),
    "directly after the queue item hook",
  );
  assert.ok(
    collapse(app.slice(sound)).includes(
      "}); useEffect(() => { if (!loaded) return; const timer = setTimeout( () => window.hrig.saveState(state)",
    ),
    "directly before the workspace save effect",
  );
  assert.equal(
    count(app, "notifyAttention("),
    1,
    "App's own call is unchanged",
  );
  assert.equal(
    count(app, "attentionSeen"),
    3,
    "the attention effect is untouched",
  );
  assert.equal(count(app, "notifications.seatNeedsInputSound"), 1);
  assert.equal(count(read("src/settings.ts"), KEY), 2);

  // Only these files know the feature; nothing in electron or the stylesheet does.
  const mentions = (text) =>
    /seat-attention|useSeatNeedsInputSound|seatNeedsInputSound/.test(text);
  for (const file of fs.readdirSync(path.join(root, "src")))
    assert.equal(
      mentions(read("src/" + file)),
      ["App.tsx", "settings.ts", "useSeatNeedsInputSound.ts"].includes(file),
      file,
    );
  for (const file of fs.readdirSync(path.join(root, "electron")))
    assert.ok(!mentions(read("electron/" + file)), "electron/" + file);
  assert.ok(!mentions(read("src/styles.css")));
  // No package was added for it.
  const pkg = JSON.parse(read("package.json"));
  for (const name of Object.keys({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }))
    assert.ok(!/howler|^tone$|tone\.js|sound|audio/i.test(name), name);
});

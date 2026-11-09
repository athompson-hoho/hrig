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
const lib = load("src/human-items.ts");
const settings = load("src/settings.ts");

// ---------------------------------------------------------------------------
// A row as `rig queue list --all-rigs --json --limit 1000` prints it (OpenRig
// 0.7.7, compact form): the field set is copied from real rows read on this
// machine. None of them was addressed to a person, so the destination,
// summary and intent are filled in the way the daemon source describes them
// (human-route-enforcer and session-name: human@host, human-<name>@kernel,
// <name>@external; humanIntent decision or update; a summary on every row for
// a person). Nothing in this file talks to a real queue.
const ROW = {
  pickup: { state: "parked" },
  qitemId: "qitem-20261109090000-aaaa000000000001",
  tsCreated: "2026-11-09T09:00:00.000Z",
  tsUpdated: "2026-11-09T09:00:02.000Z",
  sourceSession: "orch-lead@hrig",
  destinationSession: "dev-build@hrig",
  state: "pending",
  priority: "routine",
  tier: null,
  tags: null,
  blockedOn: null,
  handedOffTo: null,
  handedOffFrom: null,
  expiresAt: null,
  summary: null,
  humanIntent: null,
  closureReason: null,
  closureTarget: null,
  closureRequiredAt: null,
  claimedAt: null,
  lastNudgeAttempt: null,
  lastNudgeResult: null,
  lastNudgeWireResult: null,
  lastHeartbeat: null,
  resolution: null,
  targetRepo: null,
  deliveryOutcome: null,
  fieldsElided: [
    "body",
    "evidenceRef",
    "humanDetail",
    "waiting",
    "chainOfRecord",
    "replyTo",
    "humanQuestions",
    "humanAnswers",
    "delegatedDecision",
  ],
};
let serial = 0;
const cliRow = (over = {}) => ({
  ...ROW,
  qitemId: "qitem-20261109090000-bbbb" + String(++serial).padStart(12, "0"),
  ...over,
});
const forPerson = (summary, over = {}) =>
  cliRow({
    destinationSession: "human@host",
    summary,
    humanIntent: "decision",
    tier: "human-gate",
    ...over,
  });
const person = (id, summary = "Decide " + id, over = {}) =>
  forPerson(summary, { qitemId: id, ...over });
const agent = (id, over = {}) => cliRow({ qitemId: id, ...over });

// ---------------------------------------------------------------------------
// The real useHumanItemNotices.ts over a very small react (refs, and effects
// queued and run after the render that asked for them), with timers and the
// bridge replaced by recorders. The bridge refuses every call but the two the
// feature may use: a notification, and a read of the queue list.
const reactNow = { current: null };
const react = {
  useRef: (initial) => reactNow.current.useRef(initial),
  useEffect: (fn, list) => reactNow.current.useEffect(fn, list),
};
const { useHumanItemNotices } = load("src/useHumanItemNotices.ts", { react });

const CONNECTION = { id: "local", name: "Local", kind: "ssh", host: "box" };
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

function hookHarness({
  rows = [],
  enabled = true,
  connection = CONNECTION,
  intervalSeconds = 15,
} = {}) {
  const refs = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let pending = [];
  const state = {
    rows,
    failing: false,
    hold: false,
    pending: [],
    notifyFails: false,
    props: { enabled, connection, intervalSeconds, refresh: 0 },
  };
  const calls = { queue: [], notify: [], log: [], timers: [] };
  const timers = new Map();
  let timerId = 0;
  const before = {
    window: globalThis.window,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
  };
  const bridge = {
    queue: (...args) => {
      calls.queue.push(args);
      if (state.hold)
        return new Promise((resolve) => state.pending.push(resolve));
      return state.failing
        ? Promise.reject(new Error("rig is not reachable"))
        : Promise.resolve(state.rows);
    },
    notifyAttention: (title, body) => {
      calls.notify.push([title, body]);
      return state.notifyFails
        ? Promise.reject(new Error("no notifications here"))
        : Promise.resolve();
    },
  };
  const win = {
    hrig: new Proxy(bridge, {
      get(target, name) {
        if (name in target) return target[name];
        throw new Error("the feature touched the bridge: " + String(name));
      },
    }),
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
  reactNow.current = mine;
  const install = () => {
    globalThis.window = win;
    globalThis.setTimeout = (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      calls.timers.push(ms);
      return id;
    };
    globalThis.clearTimeout = (id) => {
      timers.delete(id);
    };
    globalThis.setInterval = () => {
      throw new Error("the poll uses one timeout at a time, never an interval");
    };
  };
  const render = (props = {}) => {
    Object.assign(state.props, props);
    reactNow.current = mine;
    install();
    cursor = 0;
    useHumanItemNotices({
      ...state.props,
      log: (text) => calls.log.push(text),
    });
    const run = pending;
    pending = [];
    run.forEach((fn) => fn());
  };
  const harness = {
    state,
    calls,
    render,
    /** Run the next scheduled timer (the lowest id) and let its read finish. */
    async fire() {
      install();
      const next = [...timers.keys()].sort((a, b) => a - b)[0];
      assert.ok(next !== undefined, "a timer was scheduled");
      const { fn } = timers.get(next);
      timers.delete(next);
      fn();
      await settle();
    },
    timers: () => timers.size,
    async start() {
      render();
      await settle();
    },
    close() {
      cleanups.forEach((fn) => fn && fn());
      globalThis.window = before.window;
      globalThis.setTimeout = before.setTimeout;
      globalThis.clearTimeout = before.clearTimeout;
      globalThis.setInterval = before.setInterval;
      if (before.window === undefined) delete globalThis.window;
    },
  };
  return harness;
}

test("human-items tracer: a real-shaped queue list goes through the real normalizer and the real module, the first read is silent, one new item for a person gives one short notification and one activity line, and the feature is off by default", async () => {
  assert.equal(settings.defaults["notifications.humanItems"], false);
  const agentRow = cliRow();
  const waiting = forPerson("Approve the release plan");
  const answer = (...list) => core.normalizeQueue(list);

  // Off: nothing is read, nothing is scheduled.
  const off = hookHarness({ enabled: false, rows: answer(agentRow, waiting) });
  try {
    await off.start();
    assert.deepEqual(off.calls.queue, []);
    assert.equal(off.timers(), 0);
  } finally {
    off.close();
  }

  // On: the first read only takes in what is already waiting.
  const h = hookHarness({ rows: answer(agentRow, waiting) });
  try {
    await h.start();
    assert.equal(h.calls.queue.length, 1);
    assert.deepEqual(
      h.calls.queue[0],
      [CONNECTION],
      "one connection argument: every rig, the person is not in a rig",
    );
    assert.deepEqual(h.calls.notify, [], "a row that was there is not news");
    assert.deepEqual(h.calls.log, []);
    assert.equal(h.timers(), 1);
    assert.deepEqual(h.calls.timers, [15000]);

    // One new item for the person, one more for an agent.
    h.state.rows = answer(
      agentRow,
      waiting,
      cliRow({ summary: "an agent's own work" }),
      forPerson("Pick the colour for the new logo"),
    );
    await h.fire();
    assert.deepEqual(h.calls.notify, [
      ["1 new item for you", "Pick the colour for the new logo"],
    ]);
    assert.deepEqual(h.calls.log, [
      "New item for you: Pick the colour for the new logo",
    ]);

    // Nothing changed: nothing more.
    await h.fire();
    assert.equal(h.calls.notify.length, 1);
    assert.equal(h.calls.queue.length, 3);
    // The notification holds the count and the subject only.
    const [title, body] = h.calls.notify[0];
    for (const text of [title, body])
      assert.ok(
        !/qitem|@|human-gate|orch-lead/.test(text),
        "no id, address, tier or source in " + text,
      );
  } finally {
    h.close();
  }
});

// ---------------------------------------------------------------------------
// The pure rules.

test("human-items address: a row is for a person when its destination is human@host, human@kernel, human-<name>@host or @kernel, or <name>@external, as the daemon classifies it, and for nobody else", () => {
  assert.equal(lib.HUMAN_ADDRESS_PATTERNS.length, 2);
  for (const pattern of lib.HUMAN_ADDRESS_PATTERNS) {
    assert.ok(pattern instanceof RegExp);
    assert.ok(!pattern.global && !pattern.sticky, "tested over and over");
  }
  const to = (address) => lib.isHumanAddressed({ destinationSession: address });
  for (const yes of [
    "human@host",
    "human@kernel",
    "human-mike@host",
    "human-ops.team_1@kernel",
    "mike@external",
    "sarah.k@external",
    "a:b@external",
    "\thuman@kernel\n",
  ])
    assert.equal(to(yes), true, JSON.stringify(yes));
  for (const no of [
    // the seats this machine's queue really holds
    "dev-build@hrig",
    "dev-alt@hrig",
    "orch-lead@hrig",
    "orch-lead@lego",
    "review-review@lego",
    // near misses
    "human@hrig",
    "Human@host",
    "human@HOST",
    "human@Kernel",
    "human@host.example",
    "human@hosts",
    "human-@kernel",
    "human@kernel@host",
    "humans@host",
    "@external",
    "mike@External",
    "mike@external.example",
    "mike@@external",
    "human @host",
    "human@ host",
    "human@host\nx",
    "xhuman@host",
    "dev-human@host",
    "a-human@kernel",
    "(human@host",
    "x y@external",
    "a b@external",
    "human",
    "external",
    "Unassigned",
    "",
    "   ",
    "x".repeat(300) + "@external",
  ])
    assert.equal(to(no), false, JSON.stringify(no));
  // Only the destination counts, and the first usable one.
  assert.equal(
    lib.isHumanAddressed({ destinationSession: "human@host", state: "done" }),
    true,
    "the address only: the state is a separate rule",
  );
  assert.equal(lib.isHumanAddressed({ destination: "human@host" }), true);
  assert.equal(
    lib.isHumanAddressed({ destinationSession: "", destination: "human@host" }),
    true,
  );
  assert.equal(
    lib.isHumanAddressed({
      destinationSession: "dev-build@hrig",
      destination: "human@host",
    }),
    false,
    "the first usable destination wins",
  );
  for (const row of [
    // no destination at all: only the destination is ever read
    { sourceSession: "human@host", state: "pending" },
    { blockedOn: "human@host", state: "blocked" },
    { handedOffTo: "human@host" },
    { handedOffFrom: "human@host" },
    { owner: "human@host" },
    { tier: "human-gate" },
    { tags: ["human@host"] },
    { summary: "human@host" },
    { sourceSession: "human@host", destinationSession: "dev-build@hrig" },
    { blockedOn: "human@host", destinationSession: "dev-build@hrig" },
    { handedOffTo: "human@host", destinationSession: "dev-build@hrig" },
    { owner: "human@host", destinationSession: "dev-build@hrig" },
    { tier: "human-gate", destinationSession: "dev-build@hrig" },
    { tags: ["human", "human@host"], destinationSession: "dev-build@hrig" },
    { summary: "for human@host", destinationSession: "dev-build@hrig" },
    { title: "human@host" },
  ])
    assert.equal(lib.isHumanAddressed(row), false, JSON.stringify(row));
  for (const junk of [
    null,
    undefined,
    0,
    1,
    true,
    "human@host",
    ["human@host"],
    [{ destinationSession: "human@host" }],
    () => {},
    { destinationSession: 5 },
    { destinationSession: ["human@host"] },
    {
      destinationSession: {
        toString() {
          return "human@host";
        },
      },
    },
  ])
    assert.equal(lib.isHumanAddressed(junk), false);
});

test("human-items state: only a pending, in-progress or blocked row that is not a quiet update is open for a person", () => {
  assert.deepEqual(lib.ACTIVE_STATES, ["pending", "in-progress", "blocked"]);
  assert.equal(lib.QUIET_INTENT, "update");
  const open = (over) =>
    lib.isOpenHumanItem({
      destinationSession: "human@host",
      state: "pending",
      ...over,
    });
  for (const state of [
    "pending",
    "in-progress",
    "blocked",
    " Pending ",
    "BLOCKED",
  ])
    assert.equal(open({ state }), true, state);
  assert.equal(open({ state: undefined, status: "in-progress" }), true);
  for (const state of [
    "done",
    "failed",
    "canceled",
    "handed-off",
    "denied",
    "held",
    "on-hold",
    "parked",
    "unknown",
    "",
    null,
    5,
    undefined,
    "x".repeat(300),
  ])
    assert.equal(open({ state }), false, String(state).slice(0, 20));
  for (const humanIntent of ["update", " Update ", "UPDATE"])
    assert.equal(open({ humanIntent }), false, "quiet: " + humanIntent);
  for (const humanIntent of [null, undefined, "decision", "", "other", 5])
    assert.equal(open({ humanIntent }), true, "an ask: " + humanIntent);
  assert.equal(open({ destinationSession: "dev-build@hrig" }), false);
  for (const junk of [null, 5, "x", [], {}, undefined])
    assert.equal(lib.isOpenHumanItem(junk), false);
});

test("human-items diff: the first answer only takes in what is waiting, later answers give only what was not there, in the order given, once, and never change their input", () => {
  const a = person("qa");
  const b = person("qb");
  const c = person("qc");
  const d = person("qd");
  const work = agent("qw");
  const done = person("qx", "finished", { state: "done" });
  const quiet = person("qq", "FYI", { humanIntent: "update" });
  const first = lib.newHumanItems([a, work, done, quiet, b], null);
  assert.deepEqual(first.fresh, [], "first answer: nothing is news");
  assert.deepEqual(
    [...first.nextSeen],
    ["qa", "qb"],
    "only open items for a person are remembered",
  );
  assert.deepEqual(lib.newHumanItems([a, work, b], first.nextSeen).fresh, []);

  const next = lib.newHumanItems([c, a, d, b], first.nextSeen);
  assert.deepEqual(
    next.fresh.map((x) => x.id),
    ["qc", "qd"],
    "in the order given",
  );
  assert.deepEqual(next.fresh[0], { id: "qc", subject: "Decide qc" });
  assert.deepEqual(Object.keys(next.fresh[0]), ["id", "subject"]);
  assert.deepEqual([...next.nextSeen].sort(), ["qa", "qb", "qc", "qd"]);

  // A seeded empty set is not null: whatever arrives next is news.
  const empty = lib.newHumanItems([work], null);
  assert.deepEqual([...empty.nextSeen], []);
  assert.deepEqual(
    lib.newHumanItems([a], empty.nextSeen).fresh.map((x) => x.id),
    ["qa"],
  );
  // An item that left and came back is not news again.
  const gone = lib.newHumanItems([b], next.nextSeen);
  assert.deepEqual(gone.fresh, []);
  assert.deepEqual(lib.newHumanItems([a, b, c], gone.nextSeen).fresh, []);
  // An item that was for an agent and is now for a person is news.
  const rerouted = {
    ...work,
    destinationSession: "human-mike@kernel",
    summary: "Look at this",
  };
  assert.deepEqual(lib.newHumanItems([rerouted], first.nextSeen).fresh, [
    { id: "qw", subject: "Look at this" },
  ]);
  // The same id twice in one answer counts once.
  const twice = lib.newHumanItems(
    [
      c,
      { ...c, summary: "the second one" },
      { ...c, summary: "the third one" },
    ],
    first.nextSeen,
  );
  assert.deepEqual(twice.fresh, [{ id: "qc", subject: "Decide qc" }]);

  // Ids: qitemId, else id; blank, non-text and over-long ones are skipped.
  const legacy = lib.newHumanItems(
    [
      {
        id: "legacy-1",
        destinationSession: "human@host",
        state: "pending",
        summary: "s",
      },
    ],
    new Set(),
  );
  assert.deepEqual(legacy.fresh, [{ id: "legacy-1", subject: "s" }]);
  const wins = lib.newHumanItems(
    [{ ...a, qitemId: "from-qitemId", id: "from-id" }],
    new Set(),
  );
  assert.equal(wins.fresh[0].id, "from-qitemId");
  for (const qitemId of ["", "  ", 7, null, undefined, "x".repeat(300), {}]) {
    const bad = lib.newHumanItems(
      [{ ...a, qitemId, id: undefined }],
      new Set(),
    );
    assert.deepEqual(bad.fresh, [], "no usable id: " + String(qitemId));
    assert.equal(bad.nextSeen.size, 0);
  }
  // Entries that are not rows are skipped.
  assert.deepEqual(
    lib
      .newHumanItems([null, 5, "x", [], undefined, a], new Set())
      .fresh.map((x) => x.id),
    ["qa"],
  );
  // A reply that is not a list has nothing in it.
  for (const bad of [null, undefined, 5, "x", {}, { length: 3 }]) {
    assert.deepEqual(lib.newHumanItems(bad, null), {
      fresh: [],
      nextSeen: new Set(),
    });
    const seen = new Set(["qa"]);
    const kept = lib.newHumanItems(bad, seen);
    assert.deepEqual([...kept.nextSeen], ["qa"]);
    assert.notEqual(kept.nextSeen, seen, "a new set");
  }
  // Nothing passed in is changed.
  const seenIn = new Set(["qa"]);
  const frozen = [Object.freeze({ ...c })];
  lib.newHumanItems(frozen, seenIn);
  assert.deepEqual([...seenIn], ["qa"]);
});

test("human-items cap: at most MAX_SEEN ids are kept and looked at, the oldest go first, an item still waiting is never dropped by the cut, and a full answer does not flood on the next read", () => {
  assert.equal(lib.MAX_SEEN, 2000);
  const many = Array.from({ length: 2500 }, (_, i) =>
    person("q" + String(i).padStart(4, "0")),
  );
  const first = lib.newHumanItems(many, null);
  assert.equal(first.nextSeen.size, 2000);
  assert.deepEqual(first.fresh, []);
  assert.ok(first.nextSeen.has("q0000") && first.nextSeen.has("q1999"));
  assert.ok(!first.nextSeen.has("q2000"));
  const again = lib.newHumanItems(many, first.nextSeen);
  assert.deepEqual(
    again.fresh,
    [],
    "what is past the cap is never looked at, so it is never news",
  );
  assert.equal(again.nextSeen.size, 2000);
  const flood = lib.newHumanItems(many, new Set());
  assert.equal(flood.fresh.length, 2000, "a batch is bounded too");

  const old = Array.from({ length: 2000 }, (_, i) => "old" + i);
  const seen = new Set(old);
  const r = lib.newHumanItems([person("old0"), person("fresh1")], seen);
  assert.deepEqual(
    r.fresh.map((x) => x.id),
    ["fresh1"],
  );
  assert.equal(r.nextSeen.size, 2000);
  assert.ok(
    r.nextSeen.has("old0"),
    "a waiting item moves to the newest end, so the cut keeps it",
  );
  assert.ok(!r.nextSeen.has("old1"), "the oldest id that is not waiting goes");
  assert.ok(r.nextSeen.has("old2"));
  assert.deepEqual([...r.nextSeen].slice(-2), ["old0", "fresh1"]);
  assert.equal(seen.size, 2000, "the set passed in is not changed");

  const big = new Set(Array.from({ length: 3000 }, (_, i) => "b" + i));
  const cut = lib.newHumanItems([], big);
  assert.equal(cut.nextSeen.size, 2000);
  assert.equal([...cut.nextSeen][0], "b1000");
});

test("human-items text: the notification is a count and at most the first subject, one clean line of at most 80 characters taken from the summary only", () => {
  const n = (...subjects) =>
    lib.notificationFor(subjects.map((s, i) => ({ id: "q" + i, subject: s })));
  assert.deepEqual(n("Approve the plan"), {
    title: "1 new item for you",
    body: "Approve the plan",
    entry: "New item for you: Approve the plan",
    count: 1,
  });
  assert.deepEqual(n("First", "Second", "Third"), {
    title: "3 new items for you",
    body: "First",
    entry: "3 new items for you: First",
    count: 3,
  });
  assert.deepEqual(n(""), {
    title: "1 new item for you",
    body: "Open the Task queue to see it.",
    entry: "New item for you",
    count: 1,
  });
  assert.deepEqual(n("", "x"), {
    title: "2 new items for you",
    body: "Open the Task queue to see them.",
    entry: "2 new items for you",
    count: 2,
  });
  assert.deepEqual(Object.keys(n("x")), ["title", "body", "entry", "count"]);
  for (const junk of [[], null, undefined, "x", 5, {}])
    assert.equal(lib.notificationFor(junk).title, "0 new items for you");
  for (const junk of [[null], [5], ["x"], [{}], [{ subject: 5 }]])
    assert.equal(
      lib.notificationFor(junk).body,
      "Open the Task queue to see it.",
    );

  // Hostile text becomes one plain line.
  assert.equal(
    n("line1\nline2\t\u0007bell‮evil​zero\x1b[31mred").body,
    "line1 line2 bellevilzero [31mred",
  );
  assert.equal(n("  a    b　c d  ").body, "a b c d");
  assert.equal(n("a\ud83d b \ude00c \u{1F600}").body, "a b c \u{1F600}");
  assert.equal(n("ok\u{E0041}\u{E0042}!").body, "ok!");
  assert.equal(n("<b>bold</b> & `code`").body, "<b>bold</b> & `code`");
  // Length: 80 characters in all, the three dots included, never half a pair.
  assert.equal(lib.MAX_SUBJECT, 80);
  assert.equal(lib.MAX_READ, 400);
  assert.equal(n("a".repeat(80)).body, "a".repeat(80));
  assert.equal(n("a".repeat(81)).body, "a".repeat(77) + "...");
  assert.equal(n("a".repeat(1000000)).body.length, 80);
  assert.equal(n(" ".repeat(399) + "ab").body, "a", "400 characters are read");
  assert.equal(
    n(" ".repeat(400) + "ab").body,
    "Open the Task queue to see it.",
    "and no more",
  );
  const faces = n("\u{1F600}".repeat(100)).body;
  assert.equal(faces, "\u{1F600}".repeat(77) + "...");
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(faces));
  // Text that is already clean is cleaned again at the boundary.
  assert.equal(
    lib.notificationFor([{ id: "x", subject: "x\ny".repeat(100) }]).body.length,
    80,
  );

  // Where the subject comes from: the summary, else the subject field.
  const subjectOf = (row) =>
    lib.newHumanItems([row], new Set()).fresh[0].subject;
  assert.equal(
    subjectOf(forPerson("From summary", { subject: "From subject" })),
    "From summary",
  );
  assert.equal(
    subjectOf(forPerson(null, { subject: "From subject" })),
    "From subject",
  );
  assert.equal(
    subjectOf(forPerson("   ", { subject: "From subject" })),
    "From subject",
  );
  for (const over of [
    { body: "the whole body text" },
    { bodyPreview: "preview of the body" },
    { title: "a title" },
    { humanDetail: "detail" },
    { humanQuestions: [{ question: "Q?" }] },
    { evidenceRef: "/p/PROOF.md" },
    { tags: ["t"] },
    { blockedOn: "qitem-9" },
  ])
    assert.equal(
      subjectOf(forPerson(null, over)),
      "",
      "no subject from " + Object.keys(over)[0],
    );
  for (const bad of [5, {}, [], ["x"], true])
    assert.equal(subjectOf(forPerson(bad)), "");
  // The normalizer's title may be a body preview: the module never reads it.
  const normalized = core.normalizeQueue([
    forPerson(null, { bodyPreview: "secret body text" }),
  ]);
  assert.equal(normalized[0].title, "secret body text");
  assert.equal(subjectOf(normalized[0]), "");
});

test("human-items poll: another connection or a reply that is not a list never floods, and the state moves only on a real list", () => {
  const a = person("qa");
  const b = person("qb");
  const first = lib.nextHumanPoll(lib.NO_SEEN, "A", [a]);
  assert.equal(first.notice, null);
  assert.equal(first.seen.key, "A");
  assert.deepEqual([...first.seen.ids], ["qa"]);
  const second = lib.nextHumanPoll(first.seen, "A", [a, b]);
  assert.deepEqual(
    { ...second.notice },
    {
      title: "1 new item for you",
      body: "Decide qb",
      entry: "New item for you: Decide qb",
      count: 1,
    },
  );
  assert.deepEqual([...first.seen.ids], ["qa"], "the old state is not changed");
  assert.equal(lib.nextHumanPoll(second.seen, "A", [a, b]).notice, null);

  const other = lib.nextHumanPoll(second.seen, "B", [a, b, person("qz")]);
  assert.equal(other.notice, null, "another connection starts over silently");
  assert.equal(other.seen.key, "B");
  assert.deepEqual([...other.seen.ids].sort(), ["qa", "qb", "qz"]);
  const back = lib.nextHumanPoll(other.seen, "A", [a, b, person("qy")]);
  assert.equal(back.notice, null, "and so does coming back");

  for (const bad of [null, undefined, 5, "x", {}, { length: 2 }, new Map()]) {
    const same = lib.nextHumanPoll(second.seen, "A", bad);
    assert.equal(same.notice, null);
    assert.deepEqual([...same.seen.ids], ["qa", "qb"]);
    assert.equal(
      lib.nextHumanPoll(lib.NO_SEEN, "A", bad).seen.ids,
      null,
      "a reply that is not a list never seeds",
    );
    assert.deepEqual(lib.nextHumanPoll(second.seen, "B", bad).seen, {
      key: "B",
      ids: null,
    });
  }
  const empty = lib.nextHumanPoll(lib.NO_SEEN, "A", []);
  assert.ok(empty.seen.ids instanceof Set && empty.seen.ids.size === 0);
  assert.equal(lib.nextHumanPoll(empty.seen, "A", [a]).notice.count, 1);
  assert.deepEqual(lib.NO_SEEN, { key: "", ids: null });
  for (const junk of [
    null,
    undefined,
    {},
    { key: "A" },
    { key: "A", ids: "x" },
    { key: "A", ids: ["qa"] },
  ]) {
    const step = lib.nextHumanPoll(junk, "A", [a]);
    assert.equal(step.notice, null, JSON.stringify(junk));
    assert.deepEqual([...step.seen.ids], ["qa"]);
  }
});

// ---------------------------------------------------------------------------
// The hook.

const { pollDelay } = load("src/inventory-health.ts");

test("human-items hook: it keeps one timer at the refresh interval, falls back to 15 seconds for an unusable one, reads again at once when asked to refresh, and restarts only when something it uses changed", async () => {
  for (const [given, ms] of [
    [15, 15000],
    [30, 30000],
    [5, 5000],
    [120, 120000],
    [4, 15000],
    [0, 15000],
    [-5, 15000],
    [NaN, 15000],
    [Infinity, 15000],
    ["abc", 15000],
    [undefined, 15000],
    [null, 15000],
  ]) {
    const h = hookHarness({ intervalSeconds: given });
    try {
      await h.start();
      assert.deepEqual(h.calls.timers, [ms], String(given));
      assert.equal(h.timers(), 1);
    } finally {
      h.close();
    }
  }
  const h = hookHarness({ rows: [person("qa")] });
  try {
    await h.start();
    assert.equal(h.calls.queue.length, 1);
    h.state.rows = [person("qa"), person("qb")];
    h.render({ refresh: 1 });
    await settle();
    assert.equal(h.calls.queue.length, 2);
    assert.equal(h.timers(), 1, "the old timer was cleared");
    assert.deepEqual(h.calls.notify, [["1 new item for you", "Decide qb"]]);
    assert.deepEqual(h.calls.log, ["New item for you: Decide qb"]);
    h.render();
    await settle();
    assert.equal(h.calls.queue.length, 2, "the same props restart nothing");
    h.render({ connection: { ...CONNECTION } });
    await settle();
    assert.equal(h.calls.queue.length, 2, "a new object with the same fields");
    h.render({ intervalSeconds: 60 });
    await settle();
    assert.equal(h.calls.queue.length, 3);
    assert.equal(h.calls.timers.at(-1), 60000);
    assert.equal(h.timers(), 1);
    for (const call of h.calls.queue)
      assert.deepEqual(call, [CONNECTION], "every rig, read only");
  } finally {
    h.close();
  }
  // Each field the connection is told apart by starts a fresh, silent read.
  const g = hookHarness({ rows: [person("qa")] });
  try {
    await g.start();
    let reads = 1;
    for (const change of [
      { id: "other" },
      { kind: "wsl" },
      { host: "elsewhere" },
      { port: 2222 },
      { distro: "Ubuntu" },
      { rigBinary: "/opt/rig" },
    ]) {
      g.state.rows = [person("qa"), person("n" + reads)];
      g.render({ connection: { ...g.state.props.connection, ...change } });
      await settle();
      assert.equal(g.calls.queue.length, ++reads, JSON.stringify(change));
      assert.deepEqual(
        g.calls.notify,
        [],
        "its own items are taken in silently: " + JSON.stringify(change),
      );
      assert.equal(g.timers(), 1);
    }
  } finally {
    g.close();
  }
});

test("human-items retry: a failed read is skipped with the inventory backoff, a failure never reseeds or floods, and a failing notification stops nothing", async () => {
  const h = hookHarness({ rows: [person("qa")] });
  try {
    h.state.failing = true;
    await h.start();
    assert.deepEqual(h.calls.notify, []);
    assert.deepEqual(h.calls.timers, [pollDelay(15, 1)]);
    await h.fire();
    await h.fire();
    await h.fire();
    assert.deepEqual(
      h.calls.timers,
      [1, 2, 3, 4].map((failures) => pollDelay(15, failures)),
    );
    // The first answer that works only takes in what is waiting.
    h.state.failing = false;
    await h.fire();
    assert.deepEqual(h.calls.notify, []);
    assert.equal(h.calls.timers.at(-1), 15000, "a good read ends the backoff");
    // A failure after that does not reseed: the item that came meanwhile is news.
    h.state.rows = [person("qa"), person("qn")];
    h.state.failing = true;
    await h.fire();
    assert.deepEqual(h.calls.notify, []);
    h.state.failing = false;
    await h.fire();
    assert.deepEqual(h.calls.notify, [["1 new item for you", "Decide qn"]]);
    // A notification that cannot be shown stops nothing.
    h.state.notifyFails = true;
    h.state.rows = [...h.state.rows, person("qm")];
    await h.fire();
    await settle();
    assert.equal(h.calls.notify.length, 2);
    assert.equal(h.calls.log.length, 2, "the activity line is still written");
    assert.equal(h.timers(), 1);
    await h.fire();
    assert.equal(h.calls.queue.length, 9);
    assert.equal(h.calls.notify.length, 2, "and nothing is told twice");
  } finally {
    h.close();
  }
});

test("human-items stop: turning it off stops the timer and forgets what was seen, a result that arrives after a stop is dropped, and another connection takes in its own items silently", async () => {
  const h = hookHarness({ rows: [person("qa")] });
  try {
    await h.start();
    h.render({ enabled: false });
    await settle();
    assert.equal(h.timers(), 0, "no timer while it is off");
    const reads = h.calls.queue.length;
    h.state.rows = [person("qa"), person("qb")];
    h.render({ enabled: true });
    await settle();
    assert.equal(h.calls.queue.length, reads + 1);
    assert.deepEqual(
      h.calls.notify,
      [],
      "turning it on again takes in what is waiting",
    );
    assert.equal(h.timers(), 1);

    // A read that finishes after the stop is dropped, not shown.
    h.state.hold = true;
    await h.fire();
    h.render({ enabled: false });
    h.state.hold = false;
    h.state.pending.shift()([person("qa"), person("qb"), person("qc")]);
    await settle();
    assert.deepEqual(h.calls.notify, [], "the late answer was dropped");
    assert.equal(h.timers(), 0, "and it started no timer");
  } finally {
    h.close();
  }

  // So is the answer of a run that a restart replaced, even with a state to clobber.
  const re = hookHarness({ rows: [person("qa")] });
  try {
    await re.start();
    re.state.hold = true;
    await re.fire();
    re.render({ refresh: 1 });
    await settle();
    assert.equal(re.state.pending.length, 2, "the old read and the new one");
    const [stale, current] = re.state.pending;
    re.state.pending.length = 0;
    re.state.hold = false;
    current([person("qa"), person("qb")]);
    await settle();
    assert.deepEqual(re.calls.notify, [["1 new item for you", "Decide qb"]]);
    stale([person("qa"), person("qb"), person("qc")]);
    await settle();
    assert.equal(re.calls.notify.length, 1, "the replaced run shows nothing");
    assert.equal(re.timers(), 1, "and starts no second timer");
    re.state.rows = [person("qa"), person("qb"), person("qc")];
    await re.fire();
    assert.deepEqual(re.calls.notify.at(-1), [
      "1 new item for you",
      "Decide qc",
    ]);
  } finally {
    re.close();
  }

  const sw = hookHarness({ rows: [person("qa")] });
  try {
    await sw.start();
    sw.state.rows = [person("qz1"), person("qz2")];
    sw.render({
      connection: { ...CONNECTION, id: "other", host: "elsewhere" },
    });
    await settle();
    assert.equal(sw.calls.queue.length, 2, "read again at once");
    assert.deepEqual(
      sw.calls.notify,
      [],
      "its own items are taken in silently",
    );
    assert.equal(sw.timers(), 1);
    sw.state.rows = [person("qz1"), person("qz2"), person("qz3")];
    await sw.fire();
    assert.deepEqual(sw.calls.notify, [["1 new item for you", "Decide qz3"]]);
  } finally {
    sw.close();
  }
});

test("human-items real: a row for a person from another rig is dropped by a rig filter, so the poll asks for every rig, and the fields the module reads survive the normalizer", () => {
  const fromOtherRig = forPerson("Look", { sourceSession: "orch-lead@lego" });
  assert.equal(core.normalizeQueue([fromOtherRig], "hrig").length, 0);
  const all = core.normalizeQueue([fromOtherRig]);
  assert.equal(all.length, 1);
  assert.equal(lib.isOpenHumanItem(all[0]), true);
  const fromHrig = forPerson("Look", { sourceSession: "orch-lead@hrig" });
  assert.equal(core.normalizeQueue([fromHrig], "hrig").length, 1);
  const n = core.normalizeQueue([
    forPerson("Approve", { qitemId: "qitem-1" }),
  ])[0];
  assert.equal(n.id, "qitem-1");
  assert.equal(n.status, "pending");
  assert.equal(n.destination, "human@host");
  assert.equal(n.destinationSession, "human@host");
  assert.equal(n.summary, "Approve");
  assert.equal(n.humanIntent, "decision");
  // The same verdict before and after the normalizer, for each kind of row.
  for (const row of [
    forPerson("a"),
    cliRow(),
    forPerson("q", { humanIntent: "update" }),
    forPerson("d", { state: "done" }),
    forPerson("m", { destinationSession: "human-mike@kernel" }),
    forPerson("e", { destinationSession: "sarah@external", state: "blocked" }),
    agent("qa", { blockedOn: "human@host", state: "blocked" }),
  ])
    assert.equal(
      lib.isOpenHumanItem(core.normalizeQueue([row])[0]),
      lib.isOpenHumanItem(row),
      JSON.stringify([row.destinationSession, row.state, row.humanIntent]),
    );
  assert.equal(
    lib.isOpenHumanItem(
      agent("qb", { blockedOn: "human@host", state: "blocked" }),
    ),
    false,
    "a row parked on a person is addressed to its seat, so it is not for the person here",
  );
});

// ---------------------------------------------------------------------------
// Wiring and docs.

test("human-items wiring: the module is pure, the hook reads the queue list and shows a notification and nothing else, App calls it once behind the setting, and nothing else in src or electron knows about it", () => {
  const mod = read("src/human-items.ts");
  const code = stripComments(mod);
  assert.ok(!/^import /m.test(code), "no imports");
  assert.ok(
    !/\b(require|document|window|navigator|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Date|fetch|process)\b|Math\.random|hrig/.test(
      code,
    ),
    "no page, clock, timer, network, storage, program or bridge",
  );
  const types = ["HumanItem", "HumanNotice", "HumanSeen"];
  const exported = [...mod.matchAll(/^export (?:const|function|type) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(
    exported,
    [
      "ACTIVE_STATES",
      "HUMAN_ADDRESS_PATTERNS",
      "MAX_FIELD",
      "MAX_READ",
      "MAX_SEEN",
      "MAX_SUBJECT",
      "NO_SEEN",
      "QUIET_INTENT",
      "isHumanAddressed",
      "isOpenHumanItem",
      "newHumanItems",
      "nextHumanPoll",
      "notificationFor",
      ...types,
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(lib).sort(),
    exported.filter((name) => !types.includes(name)),
    "the runtime exports are the list minus the types",
  );
  const lines = mod.split("\n");
  lines.forEach((line, i) => {
    if (/^export (const|function|type) /.test(line))
      assert.ok(
        lines[i - 1].trim().endsWith("*/"),
        "a doc comment right above: " + line.slice(0, 50),
      );
  });

  const hook = read("src/useHumanItemNotices.ts");
  const hookCode = stripComments(hook);
  assert.deepEqual(
    [...hookCode.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]),
    ["react", "./types", "./inventory-health", "./human-items"],
  );
  assert.deepEqual(
    [...hookCode.matchAll(/hrig\s*\.\s*(\w+)/g)].map((m) => m[1]).sort(),
    ["notifyAttention", "queue"],
    "the only bridge calls: read the queue list, show a notification",
  );
  assert.equal(count(hookCode, "window.hrig.queue(connection)"), 1);
  assert.equal(count(hookCode, ".notifyAttention("), 1);
  assert.ok(
    !/\b(document|localStorage|sessionStorage|fetch|setInterval|Date|XMLHttpRequest|addEventListener|requestAnimationFrame)\b/.test(
      hookCode,
    ),
    "no page, storage, network or second timer: it also reads while the window is hidden",
  );
  assert.equal(count(hookCode, "setTimeout("), 1);
  assert.equal(count(hookCode, "clearTimeout("), 1);
  assert.equal(count(hookCode, "export function"), 1);

  const app = read("src/App.tsx");
  assert.equal(
    count(app, 'import { useHumanItemNotices } from "./useHumanItemNotices";'),
    1,
  );
  assert.equal(count(app, "useHumanItemNotices("), 1);
  const block = between(app, "useHumanItemNotices({", "});");
  assert.equal(
    collapse(block),
    'useHumanItemNotices({ enabled: loaded && preferences["notifications.humanItems"], connection, intervalSeconds: preferences["workspace.refreshInterval"], refresh, log,',
  );
  assert.ok(
    app.indexOf("useHumanItemNotices({") >
      app.indexOf(
        '}, [inventory, preferences["notifications.desktop"], connection.id]);',
      ),
    "right after the seat attention effect",
  );
  assert.equal(
    count(app, "notifyAttention("),
    1,
    "App's own call is unchanged",
  );
  assert.equal(count(app, "notifications.humanItems"), 1);
  assert.equal(count(read("src/settings.ts"), "notifications.humanItems"), 2);

  const mentions = (text) =>
    /human-items|useHumanItemNotices|humanItems/.test(text);
  for (const file of fs.readdirSync(path.join(root, "src")))
    assert.equal(
      mentions(read("src/" + file)),
      ["App.tsx", "settings.ts", "useHumanItemNotices.ts"].includes(file),
      file,
    );
  for (const file of fs.readdirSync(path.join(root, "electron")))
    assert.ok(!mentions(read("electron/" + file)), "electron/" + file);
  assert.ok(!mentions(read("src/styles.css")));
});

test("human-items docs: TASKS.md says what counts as addressed to a person, that only new items notify and what is taken in silently, how it reads, what the notification holds, and that nothing is sent or changed", () => {
  const doc = read("TASKS.md");
  const heading = "\n### Notification for items addressed to you\n";
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, heading), 1);
  assert.equal(
    count(doc, "\n## "),
    2,
    "the level 2 headings other tests count",
  );
  const at = doc.indexOf(heading);
  assert.ok(at > doc.indexOf("separate, explicit actions."), "after the intro");
  assert.ok(
    at < doc.indexOf("\n### Card details\n"),
    "before the section other tests read to the next heading",
  );
  const next = doc.indexOf("\n### ", at + 1);
  assert.ok(next > at && next < doc.indexOf("\n## "));
  const section = doc.slice(at + 1, next);
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 3);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const say = (paragraph, parts) => {
    const flat = collapse(paragraph);
    for (const part of parts)
      assert.ok(flat.includes(part), "TASKS.md says: " + part);
  };
  const schema = (key) => settings.schema.find((row) => row.key === key);
  const refresh = settings.defaults["workspace.refreshInterval"];
  say(paragraphs[0], [
    "a new queue item addressed to a person",
    "It is off by default",
    "Notify about queue items for me under Notifications in Settings (`notifications.humanItems`)",
    "separate from Desktop attention notifications and needs nothing else turned on",
    "`human@host`, `human@kernel`, `human-name@host`, `human-name@kernel` or `name@external`",
    "which is how OpenRig names a person",
    "still pending, in-progress or blocked",
    "A quiet update (`--human-intent " +
      lib.QUIET_INTENT +
      "`) is not an ask and does not notify",
    "a task parked on a person is addressed to its own seat, so it does not notify either",
  ]);
  say(paragraphs[1], [
    "Only new items notify",
    "only takes in what is already waiting, so starting HRig never notifies for old items",
    "an item that left and came back is not new again (the last " +
      lib.MAX_SEEN.toLocaleString("en-US") +
      " are remembered)",
    "the same queue list the Task queue panel reads, for every rig on the active connection",
    "once per refresh interval (`workspace.refreshInterval`, " +
      refresh +
      " seconds by default)",
    "whether or not the Task queue panel is open",
    "A failed read is skipped and tried again with the same back-off as the rig refresh",
    "nothing is notified twice",
    "Several new items found in one read give one notification",
  ]);
  say(paragraphs[2], [
    "says how many new items there are (for example `" +
      lib.notificationFor([{ subject: "a" }, { subject: "b" }]).title +
      "`)",
    "at most the first item's summary, cut to " +
      lib.MAX_SUBJECT +
      " characters with control characters removed",
    "It never shows an item's text, id, address or tags",
    "the Activity list gets one matching line",
    "This is read only: HRig never claims, answers, resolves or changes an item and sends nothing to a seat or shell",
    "the notification is silent and clicking it does nothing",
    "Windows notification preferences still apply",
  ]);
  // The names and numbers the page uses are the code's.
  assert.equal(refresh, 15);
  assert.equal(
    schema("notifications.humanItems").label,
    "Notify about queue items for me",
  );
  assert.equal(
    schema("notifications.desktop").label,
    "Desktop attention notifications",
  );
  assert.ok(schema("workspace.refreshInterval"));
  for (const example of [
    "human@host",
    "human@kernel",
    "human-name@host",
    "human-name@kernel",
    "name@external",
  ])
    assert.equal(
      lib.isHumanAddressed({ destinationSession: example }),
      true,
      example,
    );
  assert.equal(count(read("README.md"), "TASKS.md"), 1);
});

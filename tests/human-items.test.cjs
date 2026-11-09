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

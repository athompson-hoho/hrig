"use strict";
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
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const count = (text, part) => text.split(part).length - 1;

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
const lib = load("src/task-age.ts");
const core = require("../electron/core.cjs");

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

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Queue rows exactly as `rig queue list --json` prints them (the compact shape,
// checked against a live OpenRig at plan time): tsCreated and tsUpdated are
// ISO 8601 texts in UTC with milliseconds and a Z. They are pushed through the
// real normalizeQueue.

const raw = (id, state, extra = {}) => ({
  pickup: { state: state === "blocked" ? "parked" : "working" },
  qitemId: id,
  tsCreated: iso(NOW - 5 * MIN),
  tsUpdated: iso(NOW - 5 * MIN),
  sourceSession: "orch-lead@hrig",
  destinationSession: "dev-build@hrig",
  state,
  priority: "routine",
  tier: null,
  tags: null,
  blockedOn: null,
  handedOffTo: null,
  handedOffFrom: null,
  expiresAt: null,
  summary: "Task " + id,
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
  fieldsElided: ["body", "evidenceRef", "humanDetail", "waiting"],
  ...extra,
});
const noTimes = (row) => {
  const copy = { ...row };
  delete copy.tsCreated;
  delete copy.tsUpdated;
  return copy;
};
const RAW_ROWS = [
  raw("q-new", "pending"),
  raw("q-oldpending", "pending", {
    tsCreated: iso(NOW - 4 * DAY),
    tsUpdated: iso(NOW - 4 * DAY),
  }),
  raw("q-working", "in-progress", {
    tsCreated: iso(NOW - 3 * DAY),
    tsUpdated: iso(NOW - HOUR),
  }),
  raw("q-stuck", "in-progress", {
    tsCreated: iso(NOW - 3 * DAY),
    tsUpdated: iso(NOW - 2 * DAY),
  }),
  raw("q-held", "blocked", {
    blockedOn: "qitem-20261108170835-6059c60110173998",
    tsCreated: iso(NOW - 30 * HOUR),
    tsUpdated: iso(NOW - 25 * HOUR),
  }),
  raw("q-future", "pending", {
    tsCreated: iso(NOW + HOUR),
    tsUpdated: iso(NOW + HOUR),
  }),
  raw("q-junk", "pending", { tsCreated: "yesterday", tsUpdated: "soon" }),
  noTimes(raw("q-none", "pending")),
  raw("q-failed", "failed", {
    tsCreated: iso(NOW - 9 * DAY),
    tsUpdated: iso(NOW - 9 * DAY),
  }),
];
const ROWS = core.normalizeQueue(RAW_ROWS, undefined);
const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [{ name: "dev-build", rigName: "hrig" }];

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx over a very small react: state slots, effects that run
// as they are met, a render after every state change, elements recorded as
// plain objects. The clock is a fixed value that a test can move; the bridge
// is a fake that records every call it gets.

function boardHarness({ rows = ROWS, seats = SEATS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
  let clock = NOW;
  const calls = { queue: [], rigAction: [], sendMessage: [], intervals: [] };
  const before = {
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const win = {
    hrig: {
      queue: (connection, rigName) => {
        calls.queue.push([connection, rigName]);
        return Promise.resolve(rows);
      },
      rigAction: (...args) => {
        calls.rigAction.push(args);
        return Promise.resolve({});
      },
      sendMessage: (...args) => {
        calls.sendMessage.push(args);
        return Promise.resolve("");
      },
    },
  };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
          render();
        },
      ];
    },
    useEffect(fn, list) {
      const i = cursor++;
      const old = deps[i];
      if (
        !old ||
        list.length !== old.length ||
        list.some((d, k) => d !== old[k])
      ) {
        if (cleanups[i]) cleanups[i]();
        deps[i] = list;
        cleanups[i] = fn();
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const Board = load("src/TaskBoard.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
    },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const props = {
    connection: CONNECTION,
    rigName: undefined,
    seats,
    onSeat: () => {},
  };
  function render() {
    const realNow = Date.now;
    globalThis.window = win;
    globalThis.setInterval = (fn, ms) => {
      calls.intervals.push(ms);
      return 1;
    };
    globalThis.clearInterval = () => {};
    Date.now = () => clock;
    cursor = 0;
    try {
      tree = Board(props);
    } finally {
      Date.now = realNow;
    }
  }
  render();
  const all = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((n) => all(n, out));
    else if (node && typeof node === "object") {
      out.push(node);
      all(node.props && node.props.children, out);
    }
    return out;
  };
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join("")
      : node && typeof node === "object"
        ? text(node.props && node.props.children)
        : typeof node === "string" || typeof node === "number"
          ? String(node)
          : "";
  // The direct element children of a card, in order.
  const kids = (card) =>
    [card.props.children]
      .flat()
      .filter((n) => n && typeof n === "object" && n.type);
  const byClass = (name) =>
    all(tree).filter((n) => n.props && n.props.className === name);
  const harness = {
    calls,
    all: () => all(tree),
    text,
    kids,
    byClass,
    async flush() {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
    card: (title) =>
      byClass("task-card").find((c) => text(kids(c)[0]) === title),
    titles: () => byClass("task-card").map((c) => text(kids(c)[0])),
    // What each card shows besides its title, owner and state.
    ages: () =>
      Object.fromEntries(
        byClass("task-card").map((card) => {
          const badges = kids(card).filter(
            (n) => n.type === "small" && n.props.className === "badge",
          );
          const age = badges[1];
          return [
            text(kids(card)[0]),
            {
              badges: badges.length,
              text: age ? text(age) : null,
              tip: age ? age.props.title : null,
              badgeStuck: age ? age.props["data-stuck"] : null,
              cardStuck: card.props["data-stuck"],
              keys: age ? Object.keys(age.props).sort() : null,
              cardKeys: Object.keys(card.props).sort(),
            },
          ];
        }),
      ),
    type(value) {
      const input = all(tree).find(
        (n) => n.props && n.props["aria-label"] === "Filter tasks",
      );
      input.props.onChange({ target: { value } });
    },
    setNow(ms) {
      clock = ms;
    },
    unmount() {
      cleanups.forEach((c) => c && c());
      globalThis.window = before.window;
      globalThis.setInterval = before.setInterval;
      globalThis.clearInterval = before.clearInterval;
      if (before.window === undefined) delete globalThis.window;
    },
  };
  return harness;
}

test("task-age board: the real task board shows an age badge on every card with a creation time, marks a task in progress or blocked with no update for a day as stuck in words as well as colour, and sends and polls nothing more", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    // Display only: one read of the queue, the one existing 15 second refresh timer, no other bridge call.
    assert.equal(board.calls.queue.length, 1);
    assert.deepEqual(board.calls.intervals, [15000]);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);

    const ages = board.ages();
    const shown = (title) => [
      ages[title].badges,
      ages[title].text,
      ages[title].tip,
      ages[title].badgeStuck,
      ages[title].cardStuck,
    ];
    assert.deepEqual(shown("Task q-new"), [
      2,
      "5m",
      "Created 5m ago",
      undefined,
      undefined,
    ]);
    // A pending task is old but never stuck.
    assert.deepEqual(shown("Task q-oldpending"), [
      2,
      "4d",
      "Created 4d ago",
      undefined,
      undefined,
    ]);
    // A task in progress with a recent update is not stuck.
    assert.deepEqual(shown("Task q-working"), [
      2,
      "3d",
      "Created 3d ago",
      undefined,
      undefined,
    ]);
    // No update for 2 days: the word, the tooltip, the badge and the card all say so.
    assert.deepEqual(shown("Task q-stuck"), [
      2,
      "3d stuck",
      "Stuck: no update for 2d. Created 3d ago",
      "true",
      "true",
    ]);
    // A blocked task: 25 hours without an update, created 30 hours ago.
    assert.deepEqual(shown("Task q-held"), [
      2,
      "1d stuck",
      "Stuck: no update for 1d. Created 1d ago",
      "true",
      "true",
    ]);
    // Other states show the age and are never stuck.
    assert.deepEqual(shown("Task q-failed"), [
      2,
      "9d",
      "Created 9d ago",
      undefined,
      undefined,
    ]);
    // A time in the future, junk or no time at all: no badge, and no mark on the card.
    for (const title of ["Task q-future", "Task q-junk", "Task q-none"])
      assert.deepEqual(shown(title), [1, null, null, null, undefined], title);

    // Stuck is never colour only: every stuck card has the word in its badge.
    for (const [title, a] of Object.entries(ages))
      assert.equal(
        a.cardStuck === "true",
        a.text !== null && a.text.includes("stuck"),
        title,
      );
    assert.deepEqual(
      Object.entries(ages)
        .filter(([, a]) => a.cardStuck === "true")
        .map(([title]) => title),
      ["Task q-stuck", "Task q-held"],
    );

    // The badge is the existing badge class with two plain attributes; the card gains one data attribute and nothing else.
    assert.deepEqual(ages["Task q-stuck"].keys, [
      "children",
      "className",
      "data-stuck",
      "title",
    ]);
    assert.deepEqual(ages["Task q-stuck"].cardKeys, [
      "children",
      "className",
      "data-stuck",
      "onClick",
    ]);

    // The card keeps today's children in today's order and gains the age badge last.
    const held = board.card("Task q-held");
    assert.deepEqual(
      board.kids(held).map((n) => [n.type, board.text(n)]),
      [
        ["strong", "Task q-held"],
        ["span", "dev-build@hrig"],
        ["span", "Blocked on qitem-20261108170835-6059c60110173998"],
        ["small", "blocked"],
        ["small", "1d stuck"],
      ],
    );
    // A card without a time is exactly today's card: three children and one badge (the end to end test relies on that).
    assert.deepEqual(
      board.kids(board.card("Task q-none")).map((n) => [n.type, board.text(n)]),
      [
        ["strong", "Task q-none"],
        ["span", "dev-build@hrig"],
        ["small", "pending"],
      ],
    );

    // Ages follow the clock the board reads when it renders again; typing a filter is such a render and asks for nothing.
    board.setNow(NOW + 20 * HOUR);
    board.type("Task");
    let later = board.ages();
    assert.equal(later["Task q-new"].text, "20h");
    assert.equal(
      later["Task q-working"].cardStuck,
      undefined,
      "21 hours without an update is not yet stuck",
    );
    assert.equal(later["Task q-working"].text, "3d");
    board.setNow(NOW + 3 * DAY);
    board.type("Task q");
    later = board.ages();
    assert.equal(later["Task q-working"].cardStuck, "true");
    assert.equal(later["Task q-working"].text, "6d stuck");
    assert.equal(later["Task q-new"].text, "3d");
    assert.equal(later["Task q-new"].cardStuck, undefined);
    assert.equal(board.calls.queue.length, 1, "no extra request");
    assert.deepEqual(board.calls.intervals, [15000], "no extra timer");
    assert.equal(
      board.calls.rigAction.length + board.calls.sendMessage.length,
      0,
    );
  } finally {
    board.unmount();
  }
});

test("task-age shape: a queue with no times at all keeps the end to end board shape of exactly one badge per card", async () => {
  // The row the WSL end to end fixture prints (no times, no reason).
  const rows = core.normalizeQueue(
    [
      {
        qitemId: "test-task",
        subject: "Review the transport fixture",
        state: "pending",
        destinationSession: "builder@fixture",
      },
    ],
    undefined,
  );
  const board = boardHarness({ rows });
  try {
    await board.flush();
    const badges = board
      .all()
      .filter((n) => n.props && n.props.className === "badge");
    assert.equal(badges.length, 1);
    assert.equal(board.text(badges[0]), "pending");
    assert.deepEqual(
      board.kids(board.byClass("task-card")[0]).map((n) => n.type),
      ["strong", "span", "small"],
    );
  } finally {
    board.unmount();
  }
});

// A parser written independently from the rules: a regular expression, Date.UTC arithmetic and a day-of-month check.
const modelParse = (value) => {
  let ms = null;
  if (typeof value === "number") ms = value < 1e11 ? value * 1000 : value;
  else if (typeof value === "string") {
    const t = value.trim();
    const m =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/.exec(
        t,
      );
    if (m && t.length <= 40) {
      const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
      const s = m[6] === undefined ? 0 : Number(m[6]);
      const frac = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
      const dayOk =
        mo >= 1 &&
        mo <= 12 &&
        d >= 1 &&
        new Date(Date.UTC(y, mo - 1, d)).getUTCDate() === d;
      if (dayOk && h <= 23 && mi <= 59 && s <= 59) {
        const offset = m[8]
          ? 0
          : (m[9] === "-" ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
        ms = Date.UTC(y, mo - 1, d, h, mi, s, frac) - offset * MIN;
      }
    } else if (/^\d{9,16}$/.test(t) && t.length <= 40) {
      const n = Number(t);
      ms = n < 1e11 ? n * 1000 : n;
    }
  }
  return ms !== null && Number.isFinite(ms) && ms > 0 && ms <= 8.64e15
    ? ms
    : null;
};
const modelFormat = (ms) =>
  ms < MIN
    ? "<1m"
    : ms < HOUR
      ? Math.floor(ms / MIN) + "m"
      : ms < DAY
        ? Math.floor(ms / HOUR) + "h"
        : Math.floor(ms / DAY) + "d";
const CREATED = ["tsCreated", "createdAt", "created_at", "created"];
const UPDATED = ["tsUpdated", "updatedAt", "updated_at", "updated"];
const modelFirst = (item, keys) => {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
    const t = modelParse(item[key]);
    if (t !== null) return t;
  }
  return null;
};
const modelSpan = (from, now) =>
  from === null ||
  typeof now !== "number" ||
  !Number.isFinite(now) ||
  from > now
    ? null
    : { ms: now - from, label: modelFormat(now - from) };
const modelAge = (item, now) => modelSpan(modelFirst(item, CREATED), now);
const modelIdle = (item, now) => {
  const updated = modelFirst(item, UPDATED);
  const created = modelFirst(item, CREATED);
  const from =
    updated === null
      ? created
      : created === null
        ? updated
        : Math.max(updated, created);
  return modelSpan(from, now);
};
const modelState = (item) => {
  for (const key of ["status", "state"]) {
    const v = Object.prototype.hasOwnProperty.call(item, key)
      ? item[key]
      : null;
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return "";
};
const modelStuck = (item, now, limits) => {
  const state = modelState(item);
  if (!Object.prototype.hasOwnProperty.call(limits, state)) return false;
  const limit = limits[state];
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0)
    return false;
  const idle = modelIdle(item, now);
  return idle !== null && idle.ms > limit;
};
const modelBadge = (item, now, limits) => {
  const age = modelAge(item, now);
  const stuck = modelStuck(item, now, limits);
  if (!age && !stuck) return null;
  const idle = stuck ? modelIdle(item, now) : null;
  return {
    text: [age && age.label, stuck && "stuck"].filter(Boolean).join(" "),
    title: [
      idle && "Stuck: no update for " + idle.label,
      age && "Created " + age.label + " ago",
    ]
      .filter(Boolean)
      .join(". "),
    stuck,
  };
};

test("task-age rules: times, short forms, age, idle time, the stuck rule and the badge follow the rules for every shape of value, with an injected now, and a seeded walk agrees with a model", () => {
  // The constants the docs quote.
  assert.equal(lib.MINUTE_MS, MIN);
  assert.equal(lib.HOUR_MS, HOUR);
  assert.equal(lib.DAY_MS, DAY);
  assert.deepEqual(lib.CREATED_KEYS, [
    "tsCreated",
    "createdAt",
    "created_at",
    "created",
  ]);
  assert.deepEqual(lib.UPDATED_KEYS, [
    "tsUpdated",
    "updatedAt",
    "updated_at",
    "updated",
  ]);
  assert.deepEqual(lib.STUCK_AFTER_MS, { "in-progress": DAY, blocked: DAY });

  // parseTime: ISO 8601 with a time and a zone, epoch numbers, digit texts; everything else is null.
  const t = lib.parseTime;
  const at = Date.UTC(2026, 10, 8, 17, 8, 36, 871);
  assert.equal(t("2026-11-08T17:08:36.871Z"), at);
  assert.equal(t("2026-11-08T17:08:36Z"), at - 871);
  assert.equal(t("2026-11-08T17:08Z"), at - 871 - 36000);
  assert.equal(t("2026-11-08T17:08:36.8Z"), at - 71);
  assert.equal(t("2026-11-08T17:08:36.871+01:00"), at - HOUR);
  assert.equal(t("2026-11-08T17:08:36.871-05:30"), at + 5.5 * HOUR);
  assert.equal(t("  2026-11-08T17:08:36.871Z  "), at, "padding is trimmed");
  assert.equal(t("2024-02-29T00:00:00Z"), Date.UTC(2024, 1, 29));
  assert.equal(
    t("2026-11-08T17:08:36.871123456Z") > 0,
    true,
    "long fractions are accepted",
  );
  for (const bad of [
    "2026-02-29T00:00:00Z",
    "2026-02-31T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-11-00T00:00:00Z",
    "2026-11-08T25:00:00Z",
    "2026-11-08T17:60:00Z",
    "2026-11-08T17:08:61Z",
    "2026-11-08T17:08:36",
    "2026-11-08 17:08:36Z",
    "2026-11-08T17:08:36z",
    "2026-11-08T17:08:36+0100",
    "2026-11-08T17:08:36+01",
    "2026-11-08",
    "2026-11-08T17Z",
    "0001-01-01T00:00:00Z",
    "1969-12-31T23:59:59Z",
    "yesterday",
    "",
    "   ",
    "12:00",
    "1e12",
    "0x1f",
    "123456789012345678",
    "12345678",
    "-1762620516",
    "1762620516.5",
    "2026-11-08T17:08:36.871Z" + " ".repeat(40) + "x",
    "Nov 8 2026",
    "2026-11-08T17:08:36.871Z; drop table",
  ])
    assert.equal(t(bad), null, JSON.stringify(bad));
  assert.equal(t(1762620516), 1762620516000, "seconds");
  assert.equal(t(1762620516000), 1762620516000, "milliseconds");
  assert.equal(t(99999999999), 99999999999000, "just below 1e11 is seconds");
  assert.equal(t(1e11), 1e11, "1e11 is milliseconds");
  assert.equal(t("1762620516"), 1762620516000);
  assert.equal(t("1762620516000"), 1762620516000);
  assert.equal(t("123456789"), 123456789000);
  assert.equal(t("9007199254740991"), null, "past the largest date");
  for (const bad of [
    0,
    -1,
    -1762620516000,
    NaN,
    Infinity,
    -Infinity,
    8.65e15,
    1e300,
    null,
    undefined,
    true,
    false,
    {},
    [],
    [1762620516000],
    () => 1,
    Symbol("x"),
    new Date(NOW),
    10n,
  ])
    assert.equal(t(bad), null, String(typeof bad));

  // formatAge: the short forms and their edges.
  const f = lib.formatAge;
  assert.deepEqual(
    [
      0,
      1,
      59999,
      60000,
      119999,
      120000,
      3599999,
      3600000,
      7199999,
      7200000,
      86399999,
      86400000,
      172799999,
      172800000,
      400 * DAY,
    ].map(f),
    [
      "<1m",
      "<1m",
      "<1m",
      "1m",
      "1m",
      "2m",
      "59m",
      "1h",
      "1h",
      "2h",
      "23h",
      "1d",
      "1d",
      "2d",
      "400d",
    ],
  );
  for (const bad of [-1, NaN, Infinity, "5", null, undefined, {}])
    assert.equal(f(bad), "", String(bad));

  // ageOf: since the first created field that holds a valid time, in the fixed order, own fields only, never in the future.
  const created = { tsCreated: iso(NOW - 5 * MIN) };
  assert.deepEqual(lib.ageOf(created, NOW), { ms: 5 * MIN, label: "5m" });
  assert.deepEqual(lib.ageOf({ tsCreated: iso(NOW) }, NOW), {
    ms: 0,
    label: "<1m",
  });
  assert.equal(lib.ageOf({ tsCreated: iso(NOW + 1) }, NOW), null, "future");
  assert.equal(
    lib.ageOf({ tsCreated: iso(NOW + DAY), createdAt: iso(NOW - DAY) }, NOW),
    null,
    "the first valid time decides, even when it is in the future",
  );
  assert.deepEqual(
    lib.ageOf({ tsCreated: "junk", createdAt: iso(NOW - 3 * HOUR) }, NOW),
    { ms: 3 * HOUR, label: "3h" },
  );
  assert.deepEqual(
    lib.ageOf(
      { createdAt: iso(NOW - 2 * DAY), created_at: iso(NOW - DAY) },
      NOW,
    ),
    { ms: 2 * DAY, label: "2d" },
  );
  assert.deepEqual(lib.ageOf({ created_at: NOW - 7 * DAY }, NOW), {
    ms: 7 * DAY,
    label: "7d",
  });
  assert.deepEqual(
    lib.ageOf({ created: Math.floor((NOW - HOUR) / 1000) }, NOW),
    { ms: HOUR, label: "1h" },
  );
  assert.equal(
    lib.ageOf({ tsUpdated: iso(NOW - HOUR) }, NOW),
    null,
    "an updated time is not a created time",
  );
  assert.equal(lib.ageOf({}, NOW), null);
  assert.equal(
    lib.ageOf(Object.create({ tsCreated: iso(NOW - HOUR) }), NOW),
    null,
    "inherited fields are not read",
  );
  assert.equal(
    lib.ageOf(
      JSON.parse('{"__proto__":{"tsCreated":"2026-11-10T11:00:00Z"}}'),
      NOW,
    ),
    null,
  );
  for (const now of [NaN, Infinity, "2026", null, undefined, {}])
    assert.equal(lib.ageOf(created, now), null, "now " + String(now));
  for (const junk of [null, undefined, 5, "x", [], [created], () => 1, true])
    assert.equal(lib.ageOf(junk, NOW), null);
  assert.equal(
    lib.ageOf(Object.assign([], { tsCreated: iso(NOW - HOUR) }), NOW),
    null,
    "an array with fields is not a task",
  );
  const frozen = Object.freeze({ tsCreated: iso(NOW - HOUR) });
  assert.equal(lib.ageOf(frozen, NOW).label, "1h");
  assert.deepEqual(frozen, { tsCreated: iso(NOW - HOUR) });

  // idleOf: since the later of the updated and created times; created alone is used when nothing was updated.
  const idle = (item) => lib.idleOf(item, NOW);
  assert.deepEqual(
    idle({ tsCreated: iso(NOW - 3 * DAY), tsUpdated: iso(NOW - 2 * DAY) }),
    { ms: 2 * DAY, label: "2d" },
  );
  assert.deepEqual(idle({ tsCreated: iso(NOW - 3 * DAY) }), {
    ms: 3 * DAY,
    label: "3d",
  });
  assert.deepEqual(idle({ tsUpdated: iso(NOW - HOUR) }), {
    ms: HOUR,
    label: "1h",
  });
  assert.deepEqual(
    idle({ tsCreated: iso(NOW - HOUR), tsUpdated: iso(NOW - 3 * DAY) }),
    { ms: HOUR, label: "1h" },
    "an update older than the creation is not used",
  );
  assert.deepEqual(
    idle({
      tsCreated: "junk",
      tsUpdated: "junk",
      updatedAt: iso(NOW - 2 * HOUR),
    }),
    { ms: 2 * HOUR, label: "2h" },
  );
  assert.equal(
    idle({ tsCreated: iso(NOW - DAY), tsUpdated: iso(NOW + MIN) }),
    null,
    "an update in the future",
  );
  assert.equal(
    idle({ tsCreated: iso(NOW + MIN), tsUpdated: iso(NOW - DAY) }),
    null,
    "a creation in the future",
  );
  assert.equal(idle({ tsCreated: "junk", tsUpdated: null }), null);
  assert.equal(idle({}), null);
  for (const junk of [null, undefined, 5, "x", [], () => 1])
    assert.equal(lib.idleOf(junk, NOW), null);
  assert.equal(
    lib.idleOf(Object.assign([], { tsUpdated: iso(NOW - HOUR) }), NOW),
    null,
    "an array with fields is not a task",
  );
  assert.equal(lib.idleOf({ tsUpdated: iso(NOW - HOUR) }, NaN), null);

  // isStuck: only a state with a limit, strictly longer than the limit, own keys only.
  const old = (state, idleMs, extra = {}) => ({
    status: state,
    tsCreated: iso(NOW - idleMs - 5 * DAY),
    tsUpdated: iso(NOW - idleMs),
    ...extra,
  });
  assert.equal(
    lib.isStuck(old("in-progress", DAY), NOW),
    false,
    "exactly 24 hours is not stuck",
  );
  assert.equal(lib.isStuck(old("in-progress", DAY + 1), NOW), true);
  assert.equal(lib.isStuck(old("in-progress", DAY - 1), NOW), false);
  assert.equal(lib.isStuck(old("blocked", DAY + 1), NOW), true);
  assert.equal(lib.isStuck(old("blocked", DAY), NOW), false);
  assert.equal(
    lib.isStuck({ state: " Blocked ", tsUpdated: iso(NOW - 2 * DAY) }, NOW),
    true,
    "state field, case and padding",
  );
  assert.equal(
    lib.isStuck(
      { status: "pending", state: "blocked", tsUpdated: iso(NOW - 2 * DAY) },
      NOW,
    ),
    false,
    "status wins",
  );
  assert.equal(
    lib.isStuck(
      { status: "", state: "blocked", tsUpdated: iso(NOW - 2 * DAY) },
      NOW,
    ),
    true,
    "a blank status falls through",
  );
  for (const state of [
    "pending",
    "failed",
    "done",
    "denied",
    "canceled",
    "handed-off",
    "unknown",
    "",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    5,
    null,
  ])
    assert.equal(lib.isStuck(old(state, 100 * DAY), NOW), false, String(state));
  assert.equal(
    lib.isStuck({ status: "in-progress" }, NOW),
    false,
    "no time at all",
  );
  assert.equal(
    lib.isStuck({ status: "in-progress", tsUpdated: iso(NOW + DAY) }, NOW),
    false,
    "a time in the future",
  );
  assert.equal(
    lib.isStuck({ status: "in-progress", tsCreated: iso(NOW - 3 * DAY) }, NOW),
    true,
    "never updated: counted from the creation",
  );
  // Other limits: own keys, finite numbers above 0 only; anything else falls back to the defaults or is ignored.
  assert.equal(
    lib.isStuck(old("pending", 2 * HOUR), NOW, { pending: HOUR }),
    true,
  );
  assert.equal(
    lib.isStuck(old("pending", 2 * HOUR), NOW, { pending: 3 * HOUR }),
    false,
  );
  assert.equal(
    lib.isStuck(old("in-progress", 2 * DAY), NOW, { pending: HOUR }),
    false,
    "a state that is not listed has no limit",
  );
  assert.equal(
    lib.isStuck(
      old("pending", 2 * HOUR),
      NOW,
      Object.create({ pending: HOUR }),
    ),
    false,
    "inherited limits are ignored",
  );
  for (const limit of [
    0,
    -1,
    NaN,
    Infinity,
    "3600000",
    null,
    undefined,
    {},
    [1],
  ])
    assert.equal(
      lib.isStuck(old("pending", 2 * HOUR), NOW, { pending: limit }),
      false,
      String(limit),
    );
  for (const limits of [null, undefined, 5, "x", [], [DAY]])
    assert.equal(
      lib.isStuck(old("in-progress", DAY + 1), NOW, limits),
      true,
      "no usable limits: the defaults apply",
    );
  for (const junk of [null, undefined, 5, "x", [], () => 1])
    assert.equal(lib.isStuck(junk, NOW), false);
  assert.equal(
    lib.isStuck(
      Object.assign([], {
        status: "in-progress",
        tsUpdated: iso(NOW - 3 * DAY),
      }),
      NOW,
    ),
    false,
    "an array with fields is not a task",
  );
  assert.equal(
    lib.isStuck(
      old("in-progress", 2 * DAY),
      NOW,
      Object.assign([], { "in-progress": 10 * DAY }),
    ),
    true,
    "an array is not a limits object: the defaults apply",
  );
  assert.equal(lib.isStuck(old("in-progress", 2 * DAY), NaN), false);

  // ageBadge: text, tooltip and flag together.
  const badge = (item) => lib.ageBadge(item, NOW);
  assert.deepEqual(
    badge({ status: "pending", tsCreated: iso(NOW - 5 * MIN) }),
    { text: "5m", title: "Created 5m ago", stuck: false },
  );
  assert.deepEqual(badge(old("in-progress", 2 * DAY)), {
    text: "7d stuck",
    title: "Stuck: no update for 2d. Created 7d ago",
    stuck: true,
  });
  assert.deepEqual(
    badge({ status: "blocked", tsUpdated: iso(NOW - 2 * DAY) }),
    { text: "stuck", title: "Stuck: no update for 2d", stuck: true },
    "stuck without a creation time",
  );
  assert.deepEqual(
    badge({ status: "in-progress", tsCreated: iso(NOW - 3 * DAY) }),
    {
      text: "3d stuck",
      title: "Stuck: no update for 3d. Created 3d ago",
      stuck: true,
    },
  );
  assert.equal(badge({ status: "pending" }), null);
  assert.equal(
    badge({ status: "in-progress", tsCreated: iso(NOW + DAY) }),
    null,
  );
  assert.equal(badge({ status: "in-progress", tsCreated: "junk" }), null);
  assert.equal(badge(null), null);
  assert.equal(
    badge(
      Object.assign([], {
        status: "in-progress",
        tsCreated: iso(NOW - 3 * DAY),
      }),
    ),
    null,
    "an array with fields is not a task",
  );
  assert.deepEqual(Object.keys(badge(old("blocked", 2 * DAY))).sort(), [
    "stuck",
    "text",
    "title",
  ]);
  assert.deepEqual(
    lib.ageBadge(old("pending", 2 * HOUR), NOW, { pending: HOUR }),
    {
      text: "5d stuck",
      title: "Stuck: no update for 2h. Created 5d ago",
      stuck: true,
    },
  );

  // A seeded walk of 500 items with random shapes of time, states and limits against the model.
  const rand = seeded(20261110);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const form = (ms) => {
    const x = rand();
    if (x < 0.22) return iso(ms);
    if (x < 0.3) return iso(ms).replace(/\.\d{3}Z$/, "Z");
    if (x < 0.4) {
      const shift = pick([60, 330, -300, -540, 840]);
      const sign = shift < 0 ? "-" : "+";
      const abs = Math.abs(shift);
      const pad = (n) => String(n).padStart(2, "0");
      return (
        iso(ms + shift * MIN).slice(0, 23) +
        sign +
        pad(Math.floor(abs / 60)) +
        ":" +
        pad(abs % 60)
      );
    }
    if (x < 0.5) return ms;
    if (x < 0.58) return Math.floor(ms / 1000);
    if (x < 0.64) return String(ms);
    if (x < 0.68) return String(Math.floor(ms / 1000));
    return pick([
      "",
      "soon",
      "2026-11-08",
      "2026-11-08 17:08:36",
      "2026-02-30T00:00:00Z",
      {},
      [],
      null,
      true,
      -5,
      0,
      NaN,
      "12:00",
      undefined,
    ]);
  };
  const states = [
    "in-progress",
    "blocked",
    "pending",
    "failed",
    "Blocked",
    " in-progress ",
    "",
    "constructor",
    5,
    null,
  ];
  const limitSets = [
    undefined,
    undefined,
    { pending: HOUR },
    { blocked: 2 * HOUR, "in-progress": 0 },
    { "in-progress": NaN },
    { blocked: "5" },
  ];
  for (let i = 0; i < 500; i++) {
    const now = NOW + Math.floor((rand() - 0.3) * 10 * DAY);
    const item = {};
    if (rand() < 0.85) item[pick(["status", "state", "status"])] = pick(states);
    if (rand() < 0.4) item.state = pick(states);
    for (const key of lib.CREATED_KEYS)
      if (rand() < (key === "tsCreated" ? 0.8 : 0.2))
        item[key] = form(
          now - Math.floor(rand() * 12 * DAY) + Math.floor(rand() * 1.2 * DAY),
        );
    for (const key of lib.UPDATED_KEYS)
      if (rand() < (key === "tsUpdated" ? 0.7 : 0.2))
        item[key] = form(
          now - Math.floor(rand() * 12 * DAY) + Math.floor(rand() * 1.2 * DAY),
        );
    const limits = pick(limitSets);
    const effective =
      limits && typeof limits === "object" ? limits : lib.STUCK_AFTER_MS;
    const label = "walk " + i + " " + JSON.stringify(item).slice(0, 300);
    assert.deepEqual(lib.ageOf(item, now), modelAge(item, now), label);
    assert.deepEqual(lib.idleOf(item, now), modelIdle(item, now), label);
    assert.equal(
      lib.isStuck(item, now, limits),
      modelStuck(item, now, effective),
      label,
    );
    assert.deepEqual(
      lib.ageBadge(item, now, limits),
      modelBadge(item, now, effective),
      label,
    );
  }
});

test("task-age wiring: the module is pure and reads no clock, the board reads the clock once and calls it in three places, the stylesheet adds one small block that uses existing classes and colours, and nothing else uses the feature", () => {
  const source = read("src/task-age.ts");
  assert.ok(!/[^\n -~]/.test(source), "plain ASCII");
  const code = stripComments(source);
  assert.ok(!/^\s*import\s/m.test(code), "no import");
  for (const word of [
    "window",
    "document",
    "globalThis",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "Date.now",
    "new Date",
    "Math.random",
    "performance",
    "setTimeout",
    "setInterval",
    "fetch(",
    "console",
    "process",
    "require(",
    "eval(",
    "Function(",
  ])
    assert.equal(count(code, word), 0, "module has no " + word);
  assert.equal(count(code, "Date"), 1, "the one use of Date is Date.parse");
  assert.equal(count(code, "Date.parse("), 1);
  assert.ok(!/export default/.test(code), "named exports only");
  const names = [...source.matchAll(/^export (?:const|function|type) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(names, [
    "AgeBadge",
    "CREATED_KEYS",
    "DAY_MS",
    "HOUR_MS",
    "MINUTE_MS",
    "STUCK_AFTER_MS",
    "TaskAge",
    "UPDATED_KEYS",
    "ageBadge",
    "ageOf",
    "formatAge",
    "idleOf",
    "isStuck",
    "parseTime",
  ]);
  assert.deepEqual(
    Object.keys(lib).sort(),
    names.filter((n) => n !== "AgeBadge" && n !== "TaskAge"),
  );
  const lines = source.split("\n");
  for (const [index, line] of lines.entries())
    if (/^export /.test(line))
      assert.ok(lines[index - 1].startsWith("/** "), "doc comment: " + line);

  // The board: one import, the clock read once, three calls, the same markup classes, the same bridge.
  const boardSource = read("src/TaskBoard.tsx");
  const board = collapse(stripComments(boardSource));
  assert.equal(
    count(board, 'import { ageBadge, isStuck } from "./task-age";'),
    1,
  );
  assert.equal(count(board, "Date.now()"), 1, "the clock is read in one place");
  assert.equal(count(board, "const now = Date.now();"), 1);
  assert.equal(count(board, "ageBadge("), 1);
  assert.equal(count(board, "isStuck("), 1);
  assert.equal(count(board, "ageNote(item)"), 1);
  assert.equal(
    count(
      board,
      'const ageNote = (item: any) => { const badge = ageBadge(item, now); return badge ? ( <small className="badge" data-stuck={badge.stuck ? "true" : undefined} title={badge.title} > {badge.text} </small> ) : null; };',
    ),
    1,
  );
  assert.equal(
    count(
      board,
      '<button className="task-card" key={item.id} onClick={() => inspect(item)} data-stuck={isStuck(item, now) ? "true" : undefined} > <strong>{item.title}</strong> <span>{item.destination}</span> {reasonNote(item)} <small className="badge">{item.status}</small> {ageNote(item)} </button>',
    ),
    1,
    "the card: today's children, the reason line after the owner, the age badge last",
  );
  assert.equal(
    count(board, 'className="badge"'),
    2,
    "the state badge and the age badge, no new class",
  );
  assert.equal(count(boardSource, "style="), 0);
  assert.equal(count(boardSource, "className={"), 0);
  assert.equal(count(boardSource, "dangerouslySetInnerHTML"), 0);
  assert.equal(count(board, "setInterval("), 1, "no timer was added");
  assert.equal(count(board, "setTimeout("), 0);
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  const helper = board.slice(
    board.indexOf("const now = Date.now();"),
    board.indexOf("return (", board.indexOf("const now = Date.now();")),
  );
  assert.ok(
    !/onClick|href|dangerously|innerHTML|rigAction|sendMessage|hrig|set[A-Z]/.test(
      helper,
    ),
  );

  // The stylesheet: one block between two markers that names only the card, the badge and a data attribute, with colours that already exist.
  const css = read("src/styles.css");
  const open = "/* Task cards: stuck highlight */";
  const close = "/* end of Task cards: stuck highlight */";
  assert.equal(count(css, open), 1);
  assert.equal(count(css, close), 1);
  const block = css.slice(css.indexOf(open) + open.length, css.indexOf(close));
  assert.deepEqual(
    [...block.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]),
    ["task-card", "task-card", "badge"],
    "no new class",
  );
  assert.deepEqual(
    block
      .split("{")
      .slice(0, -1)
      .map((s) => s.trim().split("\n").pop().trim()),
    ['.task-card[data-stuck="true"]', '.task-card .badge[data-stuck="true"]'],
  );
  for (const piece of [
    "border-color: var(--color-75613f);",
    "background: var(--color-382e22);",
    "color: var(--color-d9c393);",
  ])
    assert.ok(block.includes(piece), piece);
  assert.ok(
    !/@import|url\(|expression\(|content:|!important|position:|display:|width|height|margin|padding|border-width/.test(
      block,
    ),
    "colours only, no layout",
  );
  const defined = new Set(
    [...css.matchAll(/^\s*(--color-[0-9a-f]+):/gm)].map((m) => m[1]),
  );
  for (const used of block.match(/--color-[0-9a-f]+/g))
    assert.ok(defined.has(used), "defined colour " + used);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(block));
  // The card and badge rules that were there stay: the new rules come right after them.
  assert.ok(
    css.includes(
      ".task-card .badge {\n  align-self: flex-start;\n  font-size: 8px;\n}\n" +
        open,
    ),
  );
  // The block that task details added is still whole.
  assert.equal(count(css, "/* Task details: rendered markdown body */"), 1);
  assert.equal(count(css, "/* end of Task details */"), 1);

  // Nothing else uses the feature: no setting, no electron file, no other component.
  assert.ok(!read("src/settings.ts").includes("task-age"));
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs|js)$/.test(file))
      assert.ok(!read("electron/" + file).includes("task-age"), file);
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.tsx?$/.test(f) && f !== "task-age.ts")
    .filter((f) => read("src/" + f).includes("task-age"));
  assert.deepEqual(users, ["TaskBoard.tsx"]);
});

test("task-age docs: TASKS.md says what the age badge counts, when a task is stuck, that the word and not the colour carries it, which limits are fixed and that nothing is sent", () => {
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n### Card details\n"), 1);
  assert.equal(count(doc, "\n## Card details"), 0);
  const at = doc.indexOf("\n### Card details\n");
  const next = doc.indexOf("\n## ", at);
  assert.ok(at > 0 && next > at);
  assert.ok(
    doc.indexOf("\n## ") === next,
    "no level 2 heading comes before the section",
  );
  const section = doc.slice(at + 1, next);
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(
    paragraphs.length,
    4,
    "two paragraphs for the reason, two for the age",
  );
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const flat = collapse(section);
  const hours = lib.STUCK_AFTER_MS["in-progress"] / lib.HOUR_MS;
  assert.equal(hours, 24);
  assert.equal(lib.STUCK_AFTER_MS.blocked / lib.HOUR_MS, 24);
  const refresh = /setInterval\(load, (\d+)\)/.exec(read("src/TaskBoard.tsx"));
  assert.equal(Number(refresh[1]) / 1000, 15);
  for (const part of [
    "A card also shows an age badge under the state badge, in the same badge style",
    "the time since the task was created (`tsCreated`) as `<1m`, minutes (`5m`), hours (`3h`) or days (`2d`)",
    "Its tooltip says how old the task is.",
    "A task with no valid creation time, or one dated later than this computer's clock, shows no badge.",
    "A task in progress or blocked with no update for more than " +
      hours +
      " hours is stuck.",
    "counted from `tsUpdated`, or from the creation time when there is no update time",
    "The badge then adds the word stuck",
    "its tooltip says `Stuck: no update for 2d`",
    "the card border and the badge turn amber",
    "the word carries the meaning, the colour only helps",
    "Pending tasks and tasks in other states are never marked stuck.",
    "The limit is a constant in `src/task-age.ts` (`STUCK_AFTER_MS`) and is not a setting.",
    "A task that is being worked quietly without queue updates also shows as stuck after a day",
    "read the word as a reason to look, not as a verdict",
    "Ages are measured each time the board refreshes (every 15 seconds)",
    "sends nothing to OpenRig",
  ])
    assert.ok(flat.includes(part), "docs say: " + part);
  assert.ok(flat.includes("`tsUpdated`") && flat.includes("`tsCreated`"));
  // The reason paragraphs of the other feature are still there.
  assert.ok(
    flat.includes("A card for a blocked task shows why under the owner"),
  );
});

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
const char = (code) => String.fromCharCode(code);
const astral = String.fromCodePoint(0x1f600);
// True when a text holds half of a surrogate pair.
const lone = (text) => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const d = text.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
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
const lib = load("src/task-reason.ts");
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

// ---------------------------------------------------------------------------
// Queue rows exactly as `rig queue list --json` prints them (the compact shape,
// checked against a live OpenRig at plan time): blockedOn is a string (a qitem
// id, a typed gate or a human seat) on a parked task and null elsewhere, and
// the body, waiting state and human detail are elided. They are pushed through
// the real normalizeQueue.

const raw = (id, state, extra = {}) => ({
  pickup: { state: state === "blocked" ? "parked" : "working" },
  qitemId: id,
  tsCreated: "2026-11-08T17:08:36.871Z",
  tsUpdated: "2026-11-08T17:08:39.041Z",
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
const BLOCKER = "qitem-20261108170835-6059c60110173998";
const RAW_ROWS = [
  raw("q-wait", "blocked", { blockedOn: BLOCKER }),
  raw("q-nowhy", "blocked"),
  raw("q-gate", "blocked", { blockedOn: "external:ci-green" }),
  raw("q-text", "blocked", {
    blockedOn: "  wait for\n the review" + char(0x202e) + "<b>x</b>  ",
  }),
  raw("q-run", "in-progress", { blockedOn: "qitem-old-blocker" }),
  raw("q-pend", "pending", { reason: "not a block" }),
  raw("q-held", "held", { holdReason: "waiting for the release window" }),
  raw("q-failed", "failed", { closureReason: "denied" }),
  raw("q-long", "blocked", { blockedOn: "b".repeat(500) }),
];
const ROWS = core.normalizeQueue(RAW_ROWS, undefined);
const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [{ name: "dev-build", rigName: "hrig" }];

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx over a very small react: state slots, effects that run
// as they are met, a render after every state change, elements recorded as
// plain objects. The bridge is a fake that records every call it gets.

function boardHarness({ rows = ROWS, seats = SEATS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
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
    globalThis.window = win;
    globalThis.setInterval = (fn, ms) => {
      calls.intervals.push(ms);
      return 1;
    };
    globalThis.clearInterval = () => {};
    cursor = 0;
    tree = Board(props);
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
    cards: () => byClass("task-card"),
    card: (title) =>
      byClass("task-card").find((c) => text(kids(c)[0]) === title),
    columns: () =>
      byClass("task-column").map((column) => ({
        name: text(all(column).find((n) => n.type === "h4")),
        titles: byClass("task-card")
          .filter((card) => all(column).includes(card))
          .map((card) => text(kids(card)[0])),
      })),
    reasons: () =>
      byClass("task-card").flatMap((card) =>
        kids(card)
          .filter((n) => n.props && n.props["data-reason"] !== undefined)
          .map((n) => ({
            title: text(kids(card)[0]),
            kind: n.props["data-reason"],
            line: text(n),
            tip: n.props.title,
            keys: Object.keys(n.props).sort(),
          })),
      ),
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

test("task-reason tracer: a blocked task read through the real queue shape shows why on its card, other cards are untouched and nothing is sent", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    // Display only: one read of the queue, one existing 15 second refresh timer, no other bridge call.
    assert.equal(board.calls.queue.length, 1);
    assert.deepEqual(board.calls.intervals, [15000]);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);

    // The raw row keeps blockedOn through normalizeQueue, which spreads the row.
    assert.equal(ROWS.find((r) => r.id === "q-wait").blockedOn, BLOCKER);

    const reasons = board.reasons();
    assert.deepEqual(
      reasons.map((r) => [r.title, r.kind, r.line]),
      [
        ["Task q-wait", "blocked", "Blocked on " + BLOCKER],
        ["Task q-gate", "blocked", "Blocked on external:ci-green"],
        ["Task q-text", "blocked", "Blocked on wait for the review<b>x</b>"],
        ["Task q-long", "blocked", reasons[3].line],
        ["Task q-held", "held", "Held: waiting for the release window"],
      ],
    );
    // The tooltip is the same text, in full; the line is cut at 80 characters.
    assert.equal(reasons[0].tip, "Blocked on " + BLOCKER);
    assert.equal(reasons[3].line.length, lib.MAX_REASON_LINE);
    assert.ok(reasons[3].line.endsWith("..."));
    assert.ok(reasons[3].tip.length > reasons[3].line.length);
    assert.ok(reasons[3].tip.length <= lib.MAX_REASON_TEXT + 11);
    // Only text and two plain attributes: nothing to click, nothing computed from the task as markup.
    for (const r of reasons)
      assert.deepEqual(r.keys, ["children", "data-reason", "title"]);

    // No reason for a blocked task that gives none, for tasks in other states and for a closure reason.
    for (const quiet of ["q-nowhy", "q-run", "q-pend", "q-failed"])
      assert.ok(
        !reasons.some((r) => r.title === "Task " + quiet),
        quiet + " shows no reason",
      );

    // The card keeps its three children and gains the line right after the owner.
    const quiet = board.card("Task q-nowhy");
    assert.deepEqual(
      board
        .kids(quiet)
        .slice(0, 3)
        .map((n) => [n.type, board.text(n)]),
      [
        ["strong", "Task q-nowhy"],
        ["span", "dev-build@hrig"],
        ["small", "blocked"],
      ],
    );
    const waiting = board.card("Task q-wait");
    assert.deepEqual(
      board
        .kids(waiting)
        .slice(0, 4)
        .map((n) => [n.type, board.text(n)]),
      [
        ["strong", "Task q-wait"],
        ["span", "dev-build@hrig"],
        ["span", "Blocked on " + BLOCKER],
        ["small", "blocked"],
      ],
    );
    assert.equal(waiting.type, "button");
    assert.equal(typeof waiting.props.onClick, "function");

    // The columns are what they were: held and failed rows stay in Other states.
    assert.deepEqual(
      board.columns().map((c) => [c.name.replace(/\d+$/, ""), c.titles.length]),
      [
        ["pending", 1],
        ["in-progress", 1],
        ["blocked", 5],
        ["Other states", 2],
      ],
    );
    assert.equal(
      board.calls.rigAction.length + board.calls.sendMessage.length,
      0,
    );
  } finally {
    board.unmount();
  }
});

// A model written from the rules, by code point, with its own character sets.
const SPACES = (c) =>
  c === 32 ||
  (c >= 9 && c <= 13) ||
  c === 0x85 ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000;
const HIDDEN = (c) =>
  c < 32 ||
  (c >= 127 && c <= 159) ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x2028 && c <= 0x202e) ||
  (c >= 0x2060 && c <= 0x206f) ||
  c === 0xfeff;
const modelText = (value) => {
  if (typeof value !== "string") return "";
  const out = [];
  for (const ch of value.slice(0, 2000)) {
    const c = ch.codePointAt(0);
    if (SPACES(c)) out.push(" ");
    else if (!HIDDEN(c) && !(c >= 0xd800 && c <= 0xdfff)) out.push(ch);
  }
  return out.join("").split(" ").filter(Boolean).join(" ");
};
const modelCut = (text, max) => {
  const chars = [...text];
  return chars.length <= max
    ? text
    : chars
        .slice(0, max - 3)
        .join("")
        .replace(/ +$/, "") + "...";
};
const model = (item) => {
  if (item === null || typeof item !== "object" || Array.isArray(item))
    return null;
  const own = (k) => Object.prototype.hasOwnProperty.call(item, k);
  let state = "";
  for (const k of ["status", "state"])
    if (!state && own(k)) state = modelText(item[k]).toLowerCase();
  const kind =
    state === "blocked"
      ? "blocked"
      : ["held", "on-hold", "parked"].includes(state)
        ? "held"
        : null;
  if (!kind) return null;
  const keys =
    kind === "blocked"
      ? ["blockedReason", "reason", "blockedOn"]
      : ["heldReason", "holdReason", "reason", "blockedOn"];
  for (const key of keys) {
    const text = modelText(own(key) ? item[key] : undefined);
    if (!text) continue;
    const prefix =
      (kind === "blocked" ? "Blocked" : "Held") +
      (key === "blockedOn" ? " on " : ": ");
    const full = modelCut(text, 400);
    return {
      kind,
      key,
      text: full,
      line: modelCut(prefix + full, 80),
      title: prefix + full,
    };
  }
  return null;
};

test("task-reason rules: states, field order, string-only reads, cleaning, caps, junk input and a seeded walk against a model", () => {
  const r = lib.reasonOf;
  const shape = (item) => {
    const got = r(item);
    return got && [got.kind, got.key, got.line];
  };

  // Which states give a reason, with the real status or state field (status wins, blank or odd falls through).
  assert.deepEqual(shape({ status: "blocked", blockedOn: "q-1" }), [
    "blocked",
    "blockedOn",
    "Blocked on q-1",
  ]);
  for (const state of [" Blocked ", "BLOCKED", "blocked\n"])
    assert.equal(shape({ state, blockedOn: "q-1" })?.[0], "blocked", state);
  for (const state of ["held", "On-Hold", " parked "])
    assert.deepEqual(shape({ status: state, blockedOn: "q-1" }), [
      "held",
      "blockedOn",
      "Held on q-1",
    ]);
  for (const state of [
    "pending",
    "in-progress",
    "failed",
    "done",
    "denied",
    "unknown",
    "",
    "unblocked",
    "blockedish",
    "block",
    5,
    null,
    ["blocked"],
    { x: 1 },
  ])
    assert.equal(r({ status: state, blockedOn: "q-1" }), null, String(state));
  assert.equal(r({ blockedOn: "q-1" }), null, "no state at all");
  assert.equal(
    shape({ status: "pending", state: "blocked", blockedOn: "q" }),
    null,
  );
  assert.equal(
    shape({ status: "  ", state: "blocked", blockedOn: "q" })?.[0],
    "blocked",
  );
  assert.equal(
    shape({ status: 5, state: "blocked", blockedOn: "q" })?.[0],
    "blocked",
  );

  // Field order and the whitelist: explicit reasons first, blockedOn last, other fields never read.
  assert.deepEqual(
    shape({
      status: "blocked",
      blockedReason: "A",
      reason: "B",
      blockedOn: "C",
    }),
    ["blocked", "blockedReason", "Blocked: A"],
  );
  assert.deepEqual(
    shape({
      status: "blocked",
      blockedReason: "  ",
      reason: "B",
      blockedOn: "C",
    }),
    ["blocked", "reason", "Blocked: B"],
  );
  assert.deepEqual(
    shape({
      status: "blocked",
      blockedReason: 5,
      reason: null,
      blockedOn: "C",
    }),
    ["blocked", "blockedOn", "Blocked on C"],
  );
  assert.deepEqual(
    shape({
      status: "held",
      heldReason: "A",
      holdReason: "B",
      reason: "C",
      blockedOn: "D",
    }),
    ["held", "heldReason", "Held: A"],
  );
  assert.deepEqual(shape({ status: "held", holdReason: "B", reason: "C" }), [
    "held",
    "holdReason",
    "Held: B",
  ]);
  assert.equal(
    shape({ status: "blocked", heldReason: "A", holdReason: "B" }),
    null,
  );
  assert.equal(shape({ status: "held", blockedReason: "A" }), null);
  for (const key of [
    "why",
    "note",
    "blocker",
    "blockedBy",
    "humanDetail",
    "humanIntent",
    "closureReason",
    "resolution",
    "summary",
    "title",
    "waiting",
    "Reason",
    "blockedon",
  ])
    assert.equal(r({ status: "blocked", [key]: "text" }), null, key);

  // Only own string fields count.
  assert.equal(
    r(Object.assign(Object.create({ blockedOn: "x" }), { status: "blocked" })),
    null,
  );
  assert.equal(
    r(JSON.parse('{"status":"blocked","__proto__":{"blockedOn":"x"}}')),
    null,
  );
  assert.equal(
    r(Object.assign(Object.create({ status: "blocked" }), { blockedOn: "x" })),
    null,
  );
  for (const value of [5, true, null, undefined, ["a"], { a: "b" }, () => "x"])
    assert.equal(r({ status: "blocked", blockedOn: value }), null);

  // Cleaning: line breaks and Unicode spaces read as one space, hidden characters are dropped, runs collapse.
  const clean = (value) => r({ status: "blocked", reason: value })?.text;
  assert.equal(clean("a\r\n\t b"), "a b");
  assert.equal(
    clean(char(0xa0) + "a" + char(0x3000) + char(0x2003) + "b"),
    "a b",
  );
  assert.equal(clean("a" + char(0x85) + "b" + char(0x2028) + "c"), "a b c");
  assert.equal(
    clean(
      "a" +
        char(0x202e) +
        char(0x200b) +
        char(0xfeff) +
        char(0x7f) +
        char(0x9f) +
        "b",
    ),
    "ab",
  );
  assert.equal(clean("a" + char(0) + char(8) + char(27) + "b"), "ab");
  assert.equal(clean("  padded  "), "padded");
  assert.equal(
    clean("x" + char(0xd83d) + "y"),
    "xy",
    "a lone surrogate is dropped",
  );
  assert.equal(clean("a" + astral + "b"), "a" + astral + "b", "a pair is kept");
  assert.equal(
    clean(char(0x301) + "e" + char(0x301)),
    char(0x301) + "e" + char(0x301),
  );
  assert.equal(clean("<script>alert(1)</script>"), "<script>alert(1)</script>");
  assert.equal(clean(" \n\t "), undefined, "blank text gives no reason");
  assert.equal(
    clean(" ".repeat(2500) + "late"),
    undefined,
    "only the first 2000 characters are read",
  );
  assert.equal(clean("a".repeat(1990) + " ".repeat(50) + "b").length, 400);

  // Caps: 80 characters for the line (prefix included), 400 for the text, never half of a pair, no space before the dots.
  const line = (value, key = "blockedOn") =>
    r({ status: "blocked", [key]: value })?.line;
  assert.equal(line("a".repeat(69)), "Blocked on " + "a".repeat(69));
  assert.equal(line("a".repeat(69)).length, 80);
  assert.equal(line("a".repeat(70)), "Blocked on " + "a".repeat(66) + "...");
  assert.equal(line("a".repeat(70)).length, 80);
  assert.equal(line("a".repeat(72), "reason").length, 80);
  assert.equal(line("a".repeat(71), "reason"), "Blocked: " + "a".repeat(71));
  assert.equal(
    r({ status: "blocked", reason: "a".repeat(400) }).text.length,
    400,
  );
  const longText = r({ status: "blocked", reason: "a".repeat(401) });
  assert.equal(longText.text, "a".repeat(397) + "...");
  assert.equal(longText.title, "Blocked: " + "a".repeat(397) + "...");
  const pairs = r({ status: "blocked", reason: astral.repeat(500) });
  assert.equal([...pairs.text].length, 400);
  assert.equal([...pairs.line].length, 80);
  assert.ok(!lone(pairs.line + pairs.text), "no half of a pair is left");
  assert.ok(!line("a ".repeat(100), "reason").includes(" ..."));

  // The result is exactly these five fields and nothing is changed or thrown.
  assert.deepEqual(
    Object.keys(r({ status: "blocked", blockedOn: "q" })).sort(),
    ["key", "kind", "line", "text", "title"],
  );
  const frozen = Object.freeze({ status: "blocked", blockedOn: "q-1" });
  assert.equal(r(frozen).line, "Blocked on q-1");
  assert.deepEqual(frozen, { status: "blocked", blockedOn: "q-1" });
  for (const junk of [
    null,
    undefined,
    0,
    5,
    "blocked",
    true,
    [],
    [1],
    Object.assign([], { status: "blocked", blockedOn: "x", reason: "y" }),
    () => 1,
    Symbol("x"),
    new Date(0),
    NaN,
  ])
    assert.equal(r(junk), null, String(typeof junk));
  assert.equal(r({}), null);

  // A seeded walk of 400 random items against the model.
  const rand = seeded(20261108);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const alphabet = [
    "a",
    "b",
    "Z",
    "0",
    " ",
    " ",
    "\t",
    "\n",
    "\r",
    ":",
    "/",
    "<",
    "&",
    char(0x202e),
    char(0x200b),
    char(0xfeff),
    char(0xa0),
    char(0x3000),
    char(0x2028),
    char(0x7f),
    char(0x9f),
    char(0x85),
    char(0),
    char(0xd83d),
    char(0xde00),
    astral,
    char(0x301),
  ];
  const text = () => {
    const n =
      rand() < 0.05 ? 400 + Math.floor(rand() * 2500) : Math.floor(rand() * 90);
    let s = "";
    for (let i = 0; i < n; i++) s += pick(alphabet);
    return s;
  };
  const value = () => {
    const x = rand();
    if (x < 0.65) return text();
    if (x < 0.72) return null;
    if (x < 0.78) return Math.floor(rand() * 100);
    if (x < 0.84) return [text()];
    if (x < 0.9) return { a: text() };
    if (x < 0.95) return undefined;
    return "";
  };
  const states = [
    "blocked",
    "Blocked",
    " blocked ",
    "held",
    "On-Hold",
    "parked",
    "pending",
    "in-progress",
    "failed",
    "",
    "x",
    5,
    null,
  ];
  const keys = [
    "blockedReason",
    "reason",
    "blockedOn",
    "heldReason",
    "holdReason",
    "why",
    "note",
    "closureReason",
    "humanDetail",
  ];
  for (let i = 0; i < 400; i++) {
    const item = {};
    if (rand() < 0.8) item[pick(["status", "state", "status"])] = pick(states);
    if (rand() < 0.3) item.state = pick(states);
    for (const key of keys) if (rand() < 0.35) item[key] = value();
    assert.deepEqual(
      r(item),
      model(item),
      "walk " + i + " " + JSON.stringify(item).slice(0, 200),
    );
  }
});

test("task-reason wiring: the module is pure with the exports that are pinned, the board reads it in one place, the bridge calls are the same and nothing else uses it", () => {
  const source = read("src/task-reason.ts");
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
    "Date",
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
  assert.ok(!/export default/.test(code), "named exports only");
  const names = [...source.matchAll(/^export (?:const|function|type) (\w+)/gm)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(names, [
    "BLOCKED_REASON_KEYS",
    "BLOCKED_STATES",
    "HELD_REASON_KEYS",
    "HELD_STATES",
    "MAX_REASON_LINE",
    "MAX_REASON_READ",
    "MAX_REASON_TEXT",
    "TaskReason",
    "reasonOf",
  ]);
  assert.deepEqual(
    Object.keys(lib).sort(),
    names.filter((n) => n !== "TaskReason"),
  );
  const lines = source.split("\n");
  for (const [at, text] of lines.entries())
    if (/^export /.test(text))
      assert.ok(lines[at - 1].startsWith("/** "), "doc comment: " + text);
  assert.deepEqual(lib.BLOCKED_STATES, ["blocked"]);
  assert.deepEqual(lib.HELD_STATES, ["held", "on-hold", "parked"]);
  assert.deepEqual(lib.BLOCKED_REASON_KEYS, [
    "blockedReason",
    "reason",
    "blockedOn",
  ]);
  assert.deepEqual(lib.HELD_REASON_KEYS, [
    "heldReason",
    "holdReason",
    "reason",
    "blockedOn",
  ]);
  assert.equal(lib.MAX_REASON_LINE, 80);
  assert.equal(lib.MAX_REASON_TEXT, 400);
  assert.equal(lib.MAX_REASON_READ, 2000);

  // The board: one import, one helper, one call in the card, no markup from text, no handler on the line.
  const boardSource = read("src/TaskBoard.tsx");
  const board = collapse(stripComments(boardSource));
  assert.equal(count(board, 'import { reasonOf } from "./task-reason";'), 1);
  assert.equal(count(board, "reasonOf("), 1);
  assert.equal(count(board, "reasonNote(item)"), 1);
  assert.equal(
    count(
      board,
      "const reasonNote = (item: any) => { const reason = reasonOf(item); return reason ? ( <span data-reason={reason.kind} title={reason.title}> {reason.line} </span> ) : null; };",
    ),
    1,
  );
  assert.equal(
    count(board, "<span>{item.destination}</span> {reasonNote(item)}"),
    1,
    "the line sits right after the owner",
  );
  const from = board.indexOf("const reasonNote");
  const helper = board.slice(from, board.indexOf(": null; };", from) + 10);
  assert.ok(
    helper.endsWith("</span> ) : null; };"),
    "the whole helper, nothing after it",
  );
  assert.ok(
    !/className|style=|onClick|href|dangerously|innerHTML|rigAction|sendMessage|hrig/.test(
      helper,
    ),
  );
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  assert.equal(count(board, "setInterval("), 1, "no timer was added");
  assert.equal(count(board, "setTimeout("), 0);
  assert.equal(count(boardSource, "dangerouslySetInnerHTML"), 0);

  // Nothing else uses the feature: no setting, no electron file, no other component.
  assert.ok(!read("src/settings.ts").includes("task-reason"));
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs|js)$/.test(file))
      assert.ok(!read("electron/" + file).includes("task-reason"), file);
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.tsx?$/.test(f) && f !== "task-reason.ts")
    .filter((f) => read("src/" + f).includes("task-reason"));
  assert.deepEqual(users, ["TaskBoard.tsx"]);
});

test("task-reason docs: TASKS.md says where the reason comes from, which fields are read, how it is cut and that nothing is sent", () => {
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n### Card details\n"), 1);
  assert.equal(
    count(doc, "\n## Card details"),
    0,
    "a level 3 section: the level 2 sections other pages read stay as they are",
  );
  // The section sits after the intro and before the first level 2 section.
  const at = doc.indexOf("\n### Card details\n");
  const next = doc.indexOf("\n## ", at);
  assert.ok(at > 0 && next > at);
  assert.ok(
    doc.indexOf("\n## ") === next,
    "no level 2 heading comes before the section",
  );
  const section = doc.slice(at + 1, next);
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.ok(paragraphs.length >= 2);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const flat = collapse(section);
  for (const part of [
    "A card for a blocked task shows why under the owner",
    "for example `Blocked on qitem-",
    "HRig reads the reason from the task's `blockedOn` field",
    "which OpenRig sets when a task is parked on a blocker (another task, a typed gate or a human seat)",
    "the first of these fields that holds text wins",
    "A task held on purpose (state held, on-hold or parked",
    "OpenRig itself parks a held task as blocked",
    "Only text is read.",
    "A task in any other state shows no reason",
    "a blocked task without a reason keeps its card as it was",
    "The reason line is cut after " +
      lib.MAX_REASON_LINE +
      " characters with three dots",
    "its tooltip holds up to " + lib.MAX_REASON_TEXT + " characters",
    "Control, zero-width and direction-changing characters are removed and line breaks become spaces",
    "The reason is shown as plain text only.",
    "This is display only: no task or seat is changed, nothing is sent to OpenRig",
    "the board makes no extra request and starts no timer",
  ])
    assert.ok(flat.includes(part), "docs say: " + part);
  for (const key of new Set([
    ...lib.BLOCKED_REASON_KEYS,
    ...lib.HELD_REASON_KEYS,
  ]))
    assert.ok(flat.includes("`" + key + "`"), "docs name " + key);
});

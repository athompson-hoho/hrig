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
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
const flat = (text) => tight(text).replace(/,\)/g, ")");
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
const char = (code) => String.fromCharCode(code);

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
const lib = load("src/task-filters.ts");
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
// Queue rows exactly as `rig queue list --json` prints them (compact shape,
// tags null or an array of strings), pushed through the real normalizeQueue.

const raw = (id, state, destination, tags, summary) => {
  const row = {
    pickup: { state: "working" },
    qitemId: id,
    tsCreated: "2026-11-08T17:08:36.871Z",
    tsUpdated: "2026-11-08T17:08:39.041Z",
    sourceSession: "orch-lead@hrig",
    destinationSession: destination,
    state,
    priority: "routine",
    tier: null,
    tags,
    blockedOn: null,
    summary,
    fieldsElided: ["body"],
  };
  if (tags === undefined) delete row.tags;
  return row;
};
const RAW_ROWS = [
  raw(
    "q-login",
    "pending",
    "dev-a@hrig",
    ["slice:w2-asset-writes", "Mission:Alpha"],
    "Fix the login redirect",
  ),
  raw(
    "q-cache",
    "in-progress",
    "dev-b@hrig",
    "gate:qa, slice:w2-asset-writes",
    "Warm the cache",
  ),
  raw("q-docs", "blocked", "dev-a@hrig", null, "Write the docs"),
  raw(
    "q-lint",
    "pending",
    "dev-b@hrig",
    ["  QA  ", 5, null, "slice:w2-asset-writes", { x: 1 }],
    "Lint the login form",
  ),
  raw("q-odd", "failed", "dev-a@hrig", undefined, "Odd job"),
  raw("q-away", "pending", "dev-c@other", ["mission:alpha"], "Other rig task"),
];
const ROWS = core.normalizeQueue(RAW_ROWS, undefined);
const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [
  { name: "dev-a", rigName: "hrig" },
  { name: "dev-b", rigName: "hrig" },
];

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx over a very small react: state slots, effects that run
// as they are met, a render after every state change, elements recorded as
// plain objects. The bridge is a fake that records every call it gets.

function boardHarness({ rows = ROWS, saved, seats = SEATS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
  const calls = { queue: [], rigAction: [], sendMessage: [], filters: [] };
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
    savedFilters: saved,
    onFilters: (filters) => calls.filters.push(filters),
  };
  function render() {
    globalThis.window = win;
    globalThis.setInterval = () => 1;
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
  const byClass = (name) =>
    all(tree).filter((n) => n.props && n.props.className === name);
  const byLabel = (label) =>
    all(tree).find((n) => n.props && n.props["aria-label"] === label);
  const options = (label) =>
    all(byLabel(label))
      .filter((n) => n.type === "option")
      .map((n) => (n.props.value !== undefined ? n.props.value : text(n)));
  const harness = {
    calls,
    props,
    all: () => all(tree),
    text,
    byClass,
    byLabel,
    options,
    async flush() {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
    columns: () =>
      byClass("task-column").map((column) => ({
        name: text(all(column).find((n) => n.type === "h4")),
        titles: byClass("task-card")
          .filter((card) => all(column).includes(card))
          .map((card) => text(all(card).find((n) => n.type === "strong"))),
      })),
    titles: () =>
      byClass("task-card").map((card) =>
        text(all(card).find((n) => n.type === "strong")),
      ),
    empty: () =>
      all(tree).find(
        (n) =>
          n.props &&
          n.props.className === "panel-empty" &&
          n.props.role === "status",
      ),
    note: () =>
      all(tree).find(
        (n) =>
          n.props &&
          n.props.className === "field-note" &&
          n.props.role === "status",
      ),
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n) === name),
    pick(label, value) {
      byLabel(label).props.onChange({ target: { value } });
    },
    value: (label) => byLabel(label).props.value,
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

// The real App text for the two props, cut out and run over fakes.
function appProps() {
  const app = read("src/App.tsx");
  const savedBody = between(app, "savedFilters={", "\n            onFilters={");
  const filtersBody = between(app, "onFilters={", "\n          />");
  const expression = (body, name) =>
    body.slice(name.length).trim().replace(/\}$/, "");
  return {
    saved: new Function(
      "resolveTaskFilters",
      "state",
      "config",
      "return (" + expression(savedBody, "savedFilters={") + ");",
    ),
    filters: new Function(
      "saveTaskFilters",
      "setState",
      "config",
      "return (" + expression(filtersBody, "onFilters={") + ");",
    ),
  };
}

test("task-filters tracer: tag, owner and state narrow the real task board, are saved by the real App callback and come back after a reload, the text box is not saved, Clear filters resets everything, and nothing is ever sent to OpenRig", async () => {
  // The producer: the raw tags reach the board unchanged, so no IPC change is needed.
  assert.deepEqual(ROWS[0].tags, ["slice:w2-asset-writes", "Mission:Alpha"]);
  assert.equal(ROWS[1].tags, "gate:qa, slice:w2-asset-writes");
  assert.equal(ROWS[2].tags, null);
  assert.equal("tags" in ROWS[4], false);
  assert.equal(ROWS[0].status, "pending");
  assert.equal(ROWS[0].destination, "dev-a@hrig");

  const app = appProps();
  let board = boardHarness();
  try {
    await board.flush();
    // Nothing saved: the board is exactly the unfiltered board, four controls in the same grid.
    assert.deepEqual(board.columns(), [
      {
        name: "pending3",
        titles: [
          "Fix the login redirect",
          "Lint the login form",
          "Other rig task",
        ],
      },
      { name: "in-progress1", titles: ["Warm the cache"] },
      { name: "blocked1", titles: ["Write the docs"] },
      { name: "Other states1", titles: ["Odd job"] },
    ]);
    assert.deepEqual(board.options("Filter task tag"), [
      "",
      "gate:qa",
      "mission:alpha",
      "qa",
      "slice:w2-asset-writes",
    ]);
    assert.deepEqual(board.options("Filter task owner"), [
      "",
      "dev-a@hrig",
      "dev-b@hrig",
    ]);
    assert.deepEqual(board.options("Filter task state"), [
      "",
      "pending",
      "in-progress",
      "blocked",
      "failed",
    ]);
    assert.equal(board.empty(), undefined);
    assert.equal(
      board.calls.filters.length,
      0,
      "opening the board saves nothing",
    );

    // Pick a tag: the tag rides on the producer's own field, compared without case or padding.
    board.pick("Filter task tag", "  Slice:W2-Asset-Writes" + char(7) + " ");
    assert.deepEqual(board.titles(), [
      "Fix the login redirect",
      "Lint the login form",
      "Warm the cache",
    ]);
    // Text is a quick search: it narrows the board and is never handed to the saver.
    board.pick("Filter tasks", "LOGIN");
    assert.deepEqual(board.titles(), [
      "Fix the login redirect",
      "Lint the login form",
    ]);
    assert.equal(board.calls.filters.length, 1, "typing saves nothing");
    board.pick("Filter task owner", "dev-b@hrig");
    assert.deepEqual(board.titles(), ["Lint the login form"]);
    board.pick("Filter task state", "pending");
    assert.deepEqual(board.titles(), ["Lint the login form"]);
    assert.deepEqual(
      board.calls.filters.map((f) => [f.seat, f.state, f.tag]),
      [
        ["", "", "slice:w2-asset-writes"],
        ["dev-b@hrig", "", "slice:w2-asset-writes"],
        ["dev-b@hrig", "pending", "slice:w2-asset-writes"],
      ],
    );
    assert.equal(board.value("Filter task tag"), "slice:w2-asset-writes");
    assert.equal(board.value("Filter tasks"), "LOGIN");

    // Read-only so far: the board only read the queue.
    assert.equal(
      board.calls.rigAction.length + board.calls.sendMessage.length,
      0,
    );
    assert.equal(board.calls.queue.length, 1);

    // The real App callback turns the last payload into the saved map, without the text.
    let held = { version: 1, other: 7 };
    const setState = (update) => {
      held = update(held);
    };
    const onFilters = app.filters(lib.saveTaskFilters, setState, {
      connection: CONNECTION,
    });
    onFilters(board.calls.filters[board.calls.filters.length - 1]);
    assert.deepEqual(held, {
      version: 1,
      other: 7,
      taskFilters: {
        local: {
          seat: "dev-b@hrig",
          state: "pending",
          tag: "slice:w2-asset-writes",
        },
      },
    });

    // A reload: the file is parsed again (with hostile neighbours), the real App expression resolves this connection's entry.
    const file = JSON.parse(
      JSON.stringify(held).replace(
        '"taskFilters":{',
        '"taskFilters":{"__proto__":{"seat":"x","state":"pending","tag":"y"},"ssh:junk":"pending","ssh:list":["pending"],',
      ),
    );
    const resolved = app.saved(lib.resolveTaskFilters, file, {
      connection: CONNECTION,
    });
    assert.deepEqual(resolved, {
      seat: "dev-b@hrig",
      state: "pending",
      tag: "slice:w2-asset-writes",
      text: "",
    });
    board.unmount();
    board = boardHarness({ saved: resolved });
    await board.flush();
    assert.deepEqual(board.titles(), ["Lint the login form"]);
    assert.equal(board.value("Filter task owner"), "dev-b@hrig");
    assert.equal(board.value("Filter task state"), "pending");
    assert.equal(board.value("Filter task tag"), "slice:w2-asset-writes");
    assert.equal(board.value("Filter tasks"), "");
    assert.equal(board.calls.filters.length, 0, "restoring saves nothing");

    // A text nobody matches empties the board; the empty state's Clear filters resets all four and saves.
    board.pick("Filter tasks", "zzz");
    assert.deepEqual(board.titles(), []);
    assert.ok(board.empty(), "the empty state shows");
    assert.ok(
      board.text(board.empty()).includes("No tasks match these filters"),
    );
    assert.ok(
      board
        .text(board.empty())
        .includes(
          "Clear the filter, owner, state or tag to see all 6 active items.",
        ),
    );
    board.button("Clear filters").props.onClick();
    assert.equal(board.titles().length, 6);
    assert.equal(board.value("Filter task owner"), "");
    assert.equal(board.value("Filter task state"), "");
    assert.equal(board.value("Filter task tag"), "");
    assert.equal(board.value("Filter tasks"), "");
    assert.deepEqual(
      board.calls.filters.map((f) => [f.seat, f.state, f.tag, f.text]),
      [["", "", "", ""]],
    );
    // Saving the cleared filters removes the connection's entry.
    held = {
      version: 1,
      taskFilters: { local: { seat: "x", state: "", tag: "" } },
    };
    app.filters(lib.saveTaskFilters, setState, { connection: CONNECTION })(
      board.calls.filters[0],
    );
    assert.deepEqual(held, { version: 1, taskFilters: {} });

    // Read-only: the board only ever read the queue.
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);
    assert.equal(board.calls.queue.length, 1);
  } finally {
    board.unmount();
  }
});

test("task-filters list: normalizeFilters, itemTags, applyFilters, tagOptions and the saved map clean, cap and ignore junk, keep today's owner, state and text rules, and never change their input", () => {
  const empty = { seat: "", state: "", tag: "", text: "" };
  assert.deepEqual(lib.emptyFilters(), empty);
  assert.notEqual(
    lib.emptyFilters(),
    lib.emptyFilters(),
    "a fresh object each time",
  );

  // normalizeFilters: anything that is not an object, then hostile parts.
  for (const value of [
    undefined,
    null,
    0,
    7,
    "pending",
    true,
    [],
    ["seat"],
    () => 1,
  ])
    assert.deepEqual(lib.normalizeFilters(value), empty, String(value));
  const hostile = lib.normalizeFilters({
    seat: "  dev-a@hrig" + char(7) + char(0x202e) + "  ",
    state: " pending ",
    tag: "  SLICE:W2" + char(0) + "  ",
    text: "lo" + char(10) + char(0x200b) + "gin ",
    extra: "dropped",
  });
  assert.deepEqual(hostile, {
    seat: "dev-a@hrig",
    state: "pending",
    tag: "slice:w2",
    text: "login ",
  });
  assert.deepEqual(
    lib.normalizeFilters({ seat: 5, state: "bogus", tag: {}, text: [] }),
    empty,
  );
  assert.equal(
    lib.normalizeFilters({ state: "IN-PROGRESS" }).state,
    "",
    "states are exact",
  );
  for (const state of lib.TASK_STATES)
    assert.equal(lib.normalizeFilters({ state }).state, state);
  assert.deepEqual(
    [...lib.TASK_STATES],
    ["pending", "in-progress", "blocked", "failed"],
  );
  assert.equal(
    lib.normalizeFilters({ seat: "s".repeat(300) }).seat.length,
    200,
  );
  assert.equal(
    lib.normalizeFilters({ text: "t".repeat(500) }).text.length,
    200,
  );
  assert.equal(
    lib.normalizeFilters({ tag: "T".repeat(200) }).tag,
    "t".repeat(80),
  );
  const astral = String.fromCodePoint(0x1f600);
  assert.equal(
    Array.from(lib.normalizeFilters({ text: astral.repeat(300) }).text).length,
    200,
    "a character outside the basic plane is never split",
  );
  const parsed = JSON.parse('{"__proto__":{"seat":"x"},"tag":"A"}');
  assert.deepEqual(lib.normalizeFilters(parsed), { ...empty, tag: "a" });
  const frozen = Object.freeze({
    seat: "dev-a@hrig",
    state: "pending",
    tag: "T",
    text: "x",
  });
  const clean = lib.normalizeFilters(frozen);
  assert.notEqual(clean, frozen);
  assert.deepEqual(
    lib.normalizeFilters(clean),
    clean,
    "normalizing twice changes nothing",
  );

  // normalizeTag and itemTags: the producer sends null or an array of strings; a comma list and junk are read defensively.
  assert.equal(lib.normalizeTag("  Mission:Alpha  "), "mission:alpha");
  assert.equal(lib.normalizeTag(5), "");
  assert.equal(lib.normalizeTag(null), "");
  assert.equal(lib.normalizeTag("a" + char(0x200b) + "b"), "ab");
  const tagsOf = (tags) => lib.itemTags({ tags });
  assert.deepEqual(tagsOf(["slice:w2", "Mission:Alpha"]), [
    "slice:w2",
    "mission:alpha",
  ]);
  assert.deepEqual(tagsOf("gate:qa, Slice:W2 ,, "), ["gate:qa", "slice:w2"]);
  assert.deepEqual(tagsOf(["B", "b", " B ", "", "  ", 3, null, {}, ["x"]]), [
    "b",
  ]);
  for (const odd of [null, undefined, 0, 5, true, {}, () => 1])
    assert.deepEqual(tagsOf(odd), []);
  assert.deepEqual(lib.itemTags({}), []);
  for (const odd of [null, undefined, "tags", 5, [], ["tags"]])
    assert.deepEqual(lib.itemTags(odd), []);
  const many = Array.from({ length: 10000 }, (_, i) => "t" + i);
  assert.equal(tagsOf(many).length, 32, "one item reads at most 32 tags");
  assert.equal(tagsOf("x,".repeat(50000)).length, 1);
  assert.equal(tagsOf(["y".repeat(500)])[0].length, 80);

  // applyFilters: the rules that were inline in the board stay exactly the same.
  const items = [
    {
      id: 1,
      title: "Fix Login",
      status: "pending",
      destination: "dev-a@hrig",
      tags: ["slice:a"],
    },
    {
      id: 2,
      title: "Warm cache",
      status: "in-progress",
      destination: "dev-b@hrig",
      tags: "slice:a,gate:qa",
    },
    {
      id: 3,
      title: "Write docs",
      status: "blocked",
      destination: "dev-a@hrig",
      tags: null,
    },
    {
      id: 4,
      title: "login form",
      status: "pending",
      destination: "dev-b@hrig",
    },
    {
      id: 5,
      title: 12345,
      status: "failed",
      destination: "Unassigned",
      tags: ["GATE:QA"],
    },
  ];
  const ids = (list) => list.map((i) => i.id);
  const apply = (filters) => ids(lib.applyFilters(items, filters));
  assert.deepEqual(
    apply(empty),
    [1, 2, 3, 4, 5],
    "an empty filter shows everything",
  );
  assert.deepEqual(apply(undefined), [1, 2, 3, 4, 5]);
  assert.deepEqual(apply({ state: "pending" }), [1, 4]);
  assert.deepEqual(apply({ state: "failed" }), [5]);
  assert.deepEqual(apply({ seat: "dev-a@hrig" }), [1, 3]);
  assert.deepEqual(
    apply({ seat: "DEV-A@hrig" }),
    [],
    "the owner is an exact match",
  );
  assert.deepEqual(apply({ seat: "Unassigned" }), [5]);
  assert.deepEqual(
    apply({ text: "LOGIN" }),
    [1, 4],
    "text is a case-insensitive part of the title",
  );
  assert.deepEqual(apply({ text: "ogi" }), [1, 4]);
  assert.deepEqual(apply({ text: "234" }), [5], "a title is compared as text");
  assert.deepEqual(apply({ text: "login " }), [4], "text is not trimmed");
  assert.deepEqual(apply({ tag: "slice:a" }), [1, 2]);
  assert.deepEqual(
    apply({ tag: " Gate:QA " }),
    [2, 5],
    "tags compare without case or padding",
  );
  assert.deepEqual(
    apply({ tag: "slice" }),
    [],
    "a tag is an exact match, not a part",
  );
  assert.deepEqual(apply({ tag: "none" }), []);
  assert.deepEqual(apply({ seat: "dev-b@hrig", state: "pending" }), [4]);
  assert.deepEqual(
    apply({ seat: "dev-b@hrig", tag: "slice:a", text: "warm" }),
    [2],
  );
  assert.deepEqual(apply({ seat: "dev-a@hrig", tag: "gate:qa" }), []);
  assert.deepEqual(
    apply({ state: "bogus" }),
    [1, 2, 3, 4, 5],
    "an unknown state is no filter",
  );
  const result = lib.applyFilters(items, empty);
  assert.notEqual(result, items, "a copy, never the input");
  assert.equal(result[0], items[0], "the same item objects");
  for (const junk of [null, undefined, 5, "x", {}])
    assert.deepEqual(lib.applyFilters(junk, { state: "pending" }), []);
  assert.deepEqual(
    lib.applyFilters([null, 3, "x", items[0]], { state: "pending" }),
    [items[0]],
  );
  Object.freeze(items);
  for (const item of items) Object.freeze(item);
  lib.applyFilters(items, { seat: "dev-a@hrig", tag: "slice:a", text: "x" });

  // tagOptions: distinct, sorted, the 100 most used; junk gives none.
  assert.deepEqual(lib.tagOptions(items), ["gate:qa", "slice:a"]);
  assert.deepEqual(lib.tagOptions([]), []);
  for (const junk of [null, undefined, 5, "x", {}])
    assert.deepEqual(lib.tagOptions(junk), []);
  assert.deepEqual(
    lib.tagOptions([
      { tags: ["b", "a"] },
      { tags: ["B"] },
      null,
      5,
      { tags: 7 },
    ]),
    ["a", "b"],
  );
  const crowd = [];
  for (let i = 0; i < 150; i++)
    for (let n = 0; n <= i; n++)
      crowd.push({ tags: ["tag" + String(i).padStart(3, "0")] });
  const offered = lib.tagOptions(crowd);
  assert.equal(offered.length, 100);
  assert.equal(offered[0], "tag050", "the 100 most used survive");
  assert.equal(offered[99], "tag149");
  assert.deepEqual([...offered].sort(), offered, "sorted");
  assert.equal(lib.hasFilters(empty), false);
  assert.equal(lib.hasFilters(undefined), false);
  assert.equal(lib.hasFilters({ state: "bogus", seat: " " }), false);
  for (const part of ["seat", "state", "tag", "text"])
    assert.equal(
      lib.hasFilters({ [part]: part === "state" ? "blocked" : "x" }),
      true,
      part,
    );

  // The saved map: bounded, own keys only, text never saved, no input changed.
  const file = JSON.parse(
    JSON.stringify({
      local: {
        seat: " dev-a@hrig ",
        state: "pending",
        tag: "TAG",
        text: "typed",
      },
      "ssh:only-text": { text: "x" },
      "ssh:bad-state": { state: "bogus" },
      "ssh:junk": "pending",
      "ssh:list": ["pending"],
      "ssh:null": null,
      "": { seat: "x" },
      ["k".repeat(151)]: { seat: "x" },
      "wsl:Ubuntu": { state: "blocked" },
    }).replace('"local":', '"__proto__":{"seat":"x"},"local":'),
  );
  assert.ok(Object.prototype.hasOwnProperty.call(file, "__proto__"));
  const map = lib.normalizeSavedFilters(file);
  assert.deepEqual(map, {
    local: { seat: "dev-a@hrig", state: "pending", tag: "tag" },
    "wsl:Ubuntu": { seat: "", state: "blocked", tag: "" },
  });
  assert.equal(
    Object.getPrototypeOf(map),
    Object.prototype,
    "no inherited entry",
  );
  for (const value of [undefined, null, 5, "x", [], [map]])
    assert.deepEqual(lib.normalizeSavedFilters(value), {});
  const big = {};
  for (let i = 0; i < 70; i++) big["c" + i] = { tag: "t" };
  assert.equal(Object.keys(lib.normalizeSavedFilters(big)).length, 64);
  assert.deepEqual(lib.resolveTaskFilters(map, "local"), {
    seat: "dev-a@hrig",
    state: "pending",
    tag: "tag",
    text: "",
  });
  assert.deepEqual(lib.resolveTaskFilters(map, "ssh:none"), empty);
  for (const id of [
    "constructor",
    "toString",
    "hasOwnProperty",
    "__proto__",
    "",
    5,
    null,
    undefined,
  ])
    assert.deepEqual(lib.resolveTaskFilters(map, id), empty, String(id));
  assert.deepEqual(lib.resolveTaskFilters(file, "__proto__"), empty);
  for (const value of [undefined, null, 5, "x", []])
    assert.deepEqual(lib.resolveTaskFilters(value, "local"), empty);
  assert.deepEqual(
    lib.resolveTaskFilters({ local: { seat: 5, state: "bogus" } }, "local"),
    empty,
  );
  const before = JSON.stringify(map);
  const frozenMap = Object.freeze({
    local: Object.freeze({ seat: "a", state: "", tag: "" }),
  });
  const set = lib.saveTaskFilters(frozenMap, "ssh:new", {
    seat: "b",
    state: "failed",
    tag: " T ",
    text: "typed",
  });
  assert.deepEqual(set, {
    local: { seat: "a", state: "", tag: "" },
    "ssh:new": { seat: "b", state: "failed", tag: "t" },
  });
  assert.equal(JSON.stringify(map), before);
  assert.deepEqual(
    lib.saveTaskFilters(set, "ssh:new", { text: "only text" }),
    {
      local: { seat: "a", state: "", tag: "" },
    },
    "all three empty removes the entry",
  );
  assert.deepEqual(lib.saveTaskFilters(set, "ssh:new", empty), {
    local: set.local,
  });
  assert.deepEqual(lib.saveTaskFilters(undefined, "local", { tag: "x" }), {
    local: { seat: "", state: "", tag: "x" },
  });
  for (const id of ["", "__proto__", "k".repeat(151), 5, null, undefined])
    assert.deepEqual(
      lib.saveTaskFilters(frozenMap, id, { seat: "z" }),
      { local: frozenMap.local },
      String(id),
    );
  const full = {};
  for (let i = 0; i < 64; i++)
    full["c" + i] = { seat: "", state: "", tag: "t" };
  assert.equal(
    Object.keys(lib.saveTaskFilters(full, "c64", { tag: "x" })).length,
    64,
    "a 65th connection is refused",
  );
  assert.equal(
    lib.saveTaskFilters(full, "c3", { tag: "y" }).c3.tag,
    "y",
    "an existing connection can still change",
  );

  // A seeded walk against a hand-written model of the board's rules.
  const next = seeded(20261108);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const seats = ["dev-a@hrig", "dev-b@hrig", "Unassigned", "dev-a@hrig2"];
  const states = ["pending", "in-progress", "blocked", "failed", "unknown"];
  const words = ["login", "cache", "Docs", "LINT", "fix"];
  const tagPool = ["a", "B", "slice:x", "gate:qa", " c "];
  const modelTags = (value) => {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    const out = [];
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const tag = entry.trim().toLowerCase();
      if (tag && !out.includes(tag)) out.push(tag);
    }
    return out;
  };
  for (let run = 0; run < 300; run++) {
    const rows = Array.from({ length: Math.floor(next() * 12) }, (_, id) => {
      const shape = next();
      const picked = Array.from({ length: Math.floor(next() * 4) }, () =>
        pick(tagPool),
      );
      return {
        id,
        title: pick(words) + " " + pick(words),
        status: pick(states),
        destination: pick(seats),
        tags:
          shape < 0.5
            ? picked
            : shape < 0.75
              ? picked.join(",")
              : shape < 0.9
                ? null
                : 7,
      };
    });
    const f = {
      seat: next() < 0.4 ? pick(seats) : "",
      state: next() < 0.4 ? pick(states.slice(0, 4)) : "",
      tag: next() < 0.4 ? pick(tagPool) : "",
      text: next() < 0.4 ? pick(words).toUpperCase().slice(0, 3) : "",
    };
    const want = rows.filter(
      (r) =>
        (!f.state || r.status === f.state) &&
        (!f.seat || r.destination === f.seat) &&
        (!f.tag || modelTags(r.tags).includes(f.tag.trim().toLowerCase())) &&
        (!f.text || r.title.toLowerCase().includes(f.text.toLowerCase())),
    );
    assert.deepEqual(ids(lib.applyFilters(rows, f)), ids(want), "run " + run);
    const model = [...new Set(rows.flatMap((r) => modelTags(r.tags)))].sort();
    assert.deepEqual(lib.tagOptions(rows), model, "options " + run);
  }

  // staleFilters and staleNote: the saved owner or tag that nothing offers any more.
  {
    const seats = ["dev-a@hrig", "dev-b@hrig"];
    const none = { seat: "", tag: "" };
    const stale = (filters, list = seats, items = ROWS) =>
      lib.staleFilters(filters, list, items);
    assert.deepEqual(stale({ seat: "dev-z@gone" }), {
      seat: "dev-z@gone",
      tag: "",
    });
    assert.deepEqual(stale({ seat: " dev-z@gone " }), {
      seat: "dev-z@gone",
      tag: "",
    });
    assert.deepEqual(
      stale({ seat: "dev-a@hrig" }),
      none,
      "a listed seat is found",
    );
    assert.deepEqual(
      stale({ seat: "dev-c@other" }),
      none,
      "a task still has this owner",
    );
    assert.deepEqual(
      stale({ seat: "dev-z@gone" }, [], ROWS),
      none,
      "no seats listed yet: not judged",
    );
    assert.deepEqual(stale({ seat: "dev-z@gone" }, null, ROWS), none);
    assert.deepEqual(
      stale({ seat: "dev-z@gone" }, seats, null),
      none,
      "tasks not loaded: not judged",
    );
    assert.deepEqual(
      stale({ seat: "dev-z@gone" }, seats, []),
      { seat: "dev-z@gone", tag: "" },
      "loaded and empty: stale",
    );
    assert.deepEqual(stale({ seat: "dev-z@gone" }, seats, [null, 5, "x"]), {
      seat: "dev-z@gone",
      tag: "",
    });
    assert.deepEqual(stale({ tag: " SLICE:GONE " }), {
      seat: "",
      tag: "slice:gone",
    });
    assert.deepEqual(stale({ tag: "Slice:W2-Asset-Writes" }), none);
    assert.deepEqual(
      stale({ tag: "mission:alpha" }),
      none,
      "a tag on a task from another rig counts",
    );
    assert.deepEqual(stale({ tag: "slice:gone" }, seats, null), none);
    assert.deepEqual(stale({ tag: "slice:gone" }, seats, []), {
      seat: "",
      tag: "slice:gone",
    });
    assert.deepEqual(
      stale({ tag: "slice:gone" }, [], ROWS),
      { seat: "", tag: "slice:gone" },
      "a tag does not need seats",
    );
    assert.deepEqual(
      stale({ state: "failed", text: "zzz" }),
      none,
      "state and text are never stale",
    );
    assert.deepEqual(stale(undefined), none);
    assert.deepEqual(stale({ seat: "x@y", tag: "t" }), {
      seat: "x@y",
      tag: "t",
    });
    const frozen = Object.freeze({ seat: "dev-z@gone", tag: "t" });
    lib.staleFilters(
      frozen,
      Object.freeze([...seats]),
      Object.freeze([...ROWS]),
    );

    assert.equal(lib.staleNote(none), "");
    assert.equal(
      lib.staleNote({ seat: "dev-z@gone", tag: "" }),
      "No seat or task matches the saved owner dev-z@gone.",
    );
    assert.equal(
      lib.staleNote({ seat: "", tag: "slice:gone" }),
      "No task has the saved tag slice:gone.",
    );
    assert.equal(
      lib.staleNote({ seat: "a@b", tag: "t" }),
      "No seat or task matches the saved owner a@b. No task has the saved tag t.",
    );
    for (const junk of [undefined, null, 5, "x", [], { seat: 5, tag: {} }])
      assert.equal(lib.staleNote(junk), "");
    assert.equal(
      lib.staleNote({
        seat: "a" + char(7) + char(0x202e) + "b",
        tag: "T" + char(0),
      }),
      "No seat or task matches the saved owner ab. No task has the saved tag t.",
    );
  }
});

test("task-filters wiring: one pure module, a board that only filters what it already loaded, two props in App, one field in the saved workspace state and no new close, send or storage route", () => {
  // The pure module: ASCII, imports nothing, touches nothing outside its arguments.
  const source = read("src/task-filters.ts");
  assert.ok(!/[^\n -~]/.test(source), "module is printable ASCII");
  assert.ok(
    !source.includes(char(92) + "u"),
    "no escape sequences in the module",
  );
  const code = stripComments(source);
  for (const word of [
    "import",
    "require",
    "window",
    "document",
    "React",
    "hrig",
    "Date",
    "performance",
    "setTimeout",
    "setInterval",
    "fetch",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "async",
    "await",
    "class",
  ])
    assert.ok(
      !new RegExp("\\b" + word + "\\b").test(code),
      "module avoids " + word,
    );
  assert.ok(!/Math\.random|export default/.test(code));
  assert.deepEqual(
    Object.keys(lib).sort(),
    [
      "MAX_CONNECTION_KEY",
      "MAX_FILTER_SEAT",
      "MAX_FILTER_TEXT",
      "MAX_ITEM_TAGS",
      "MAX_SAVED_CONNECTIONS",
      "MAX_TAG_LENGTH",
      "MAX_TAG_OPTIONS",
      "TASK_STATES",
      "applyFilters",
      "emptyFilters",
      "hasFilters",
      "itemTags",
      "normalizeFilters",
      "normalizeSavedFilters",
      "normalizeTag",
      "resolveTaskFilters",
      "saveTaskFilters",
      "staleFilters",
      "staleNote",
      "tagOptions",
    ].sort(),
  );

  // The board: the filter helpers come from the module, the old state is gone, and no filter handler touches the bridge.
  const boardSource = read("src/TaskBoard.tsx");
  const board = tight(stripComments(boardSource));
  assert.equal(count(board, 'from "./task-filters";'), 1);
  assert.equal(count(board, "applyFilters(items || [], filters)"), 1);
  assert.equal(count(board, "tagOptions(items || [])"), 1);
  assert.equal(
    count(
      board,
      "const [filters, setFilters] = useState(() => normalizeFilters(savedFilters));",
    ),
    1,
  );
  for (const gone of [
    "setFilter(",
    "setOwner(",
    "setStateFilter(",
    "const [owner,",
    "const [stateFilter,",
    "i.destination === owner",
    "toLowerCase().includes(filter",
  ])
    assert.equal(count(board, gone), 0, "removed: " + gone);
  const handlers = between(
    tight(stripComments(boardSource)),
    "const visible = applyFilters(",
    "return (",
  );
  assert.ok(
    !/hrig|rigAction|sendMessage|mutate|setNotice|setError|setRefresh|setBusy|setSelected/.test(
      handlers,
    ),
  );
  // The bridge calls are exactly the three the board always had.
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  assert.equal(count(board, "<select"), 4);
  assert.equal(count(board, "maxLength={MAX_FILTER_TEXT}"), 1);
  assert.equal(count(board, 'aria-label="Filter task tag"'), 1);
  for (const label of [
    "Filter tasks",
    "Filter task owner",
    "Filter task state",
  ])
    assert.equal(count(board, 'aria-label="' + label + '"'), 1, label);
  assert.ok(
    !/localStorage|sessionStorage|indexedDB|saveState|flushState|drafts|useDraft/.test(
      board,
    ),
  );

  // App: one import, one board element, two props, no new state or hook.
  const app = flat(stripComments(read("src/App.tsx")));
  assert.equal(
    count(
      app,
      'import { resolveTaskFilters, saveTaskFilters } from "./task-filters";',
    ),
    1,
  );
  assert.equal(count(app, "<TaskBoard"), 1);
  assert.equal(
    count(
      app,
      "savedFilters={resolveTaskFilters(state.taskFilters, config.connection.id)}",
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "onFilters={(next) => setState((s) => ({ ...s, taskFilters: saveTaskFilters(s.taskFilters, config.connection.id, next) })) }",
    ),
    1,
  );
  assert.equal(
    count(app, "taskFilters"),
    3,
    "the field is read once and written once in App",
  );
  // The saved state: one optional field, typed by the module.
  const types = tight(read("src/types.ts"));
  assert.equal(
    count(types, 'taskFilters?: import("./task-filters").SavedTaskFilters;'),
    1,
  );
  // Not a setting, not a draft, not in the main process.
  const settings = read("src/settings.ts");
  assert.ok(!/taskFilters|task-filters/.test(settings));
  for (const file of [
    "electron/main.cjs",
    "electron/preload.cjs",
    "electron/core.cjs",
    "electron/drafts.cjs",
  ])
    assert.ok(!/taskFilters|task-filters/.test(read(file)), file);
});

test("task-filters stale: a remembered owner or tag that nothing offers any more stays visible in its box with a no-match note and Clear filters, and nothing is judged stale while the seats or tasks are still loading", async () => {
  // The real board. Both a stale owner and a stale tag were saved in an earlier session.
  let board = boardHarness({
    saved: { seat: "dev-z@gone", state: "", tag: "slice:gone", text: "" },
  });
  try {
    assert.equal(board.empty(), undefined, "loading shows no empty state");
    assert.deepEqual(board.options("Filter task owner"), [
      "",
      "dev-z@gone",
      "dev-a@hrig",
      "dev-b@hrig",
    ]);
    assert.deepEqual(board.options("Filter task tag"), ["", "slice:gone"]);
    assert.equal(board.value("Filter task owner"), "dev-z@gone");
    assert.equal(board.value("Filter task tag"), "slice:gone");
    await board.flush();
    assert.deepEqual(board.titles(), []);
    assert.deepEqual(board.options("Filter task tag"), [
      "",
      "slice:gone",
      "gate:qa",
      "mission:alpha",
      "qa",
      "slice:w2-asset-writes",
    ]);
    const empty = board.text(board.empty());
    assert.ok(empty.includes("No tasks match these filters"));
    assert.ok(
      empty.includes(
        "No seat or task matches the saved owner dev-z@gone. No task has the saved tag slice:gone.",
      ),
    );
    assert.ok(
      empty.includes(
        "Clear the filter, owner, state or tag to see all 6 active items.",
      ),
    );
    assert.equal(board.calls.filters.length, 0, "restoring saves nothing");
    board.button("Clear filters").props.onClick();
    assert.equal(board.titles().length, 6);
    assert.deepEqual(board.options("Filter task owner"), [
      "",
      "dev-a@hrig",
      "dev-b@hrig",
    ]);
    assert.deepEqual(board.options("Filter task tag"), [
      "",
      "gate:qa",
      "mission:alpha",
      "qa",
      "slice:w2-asset-writes",
    ]);
    assert.equal(board.value("Filter task owner"), "");
    assert.deepEqual(board.calls.filters, [
      { seat: "", state: "", tag: "", text: "" },
    ]);
    assert.equal(board.empty(), undefined);
  } finally {
    board.unmount();
  }

  // One stale part gets its own sentence only.
  board = boardHarness({
    saved: { seat: "", state: "pending", tag: "slice:gone", text: "" },
  });
  try {
    await board.flush();
    const empty = board.text(board.empty());
    assert.ok(empty.includes("No task has the saved tag slice:gone."));
    assert.ok(!empty.includes("saved owner"));
  } finally {
    board.unmount();
  }

  // An owner no seat lists but a task still has is a real filter, not a stale one.
  board = boardHarness({
    saved: { seat: "dev-c@other", state: "", tag: "", text: "" },
  });
  try {
    await board.flush();
    assert.deepEqual(board.titles(), ["Other rig task"]);
    assert.equal(board.empty(), undefined);
    assert.deepEqual(board.options("Filter task owner"), [
      "",
      "dev-c@other",
      "dev-a@hrig",
      "dev-b@hrig",
    ]);
    assert.equal(
      board.text(board.note()),
      "Showing 1 of 6 tasks. Clear filters",
    );
  } finally {
    board.unmount();
  }

  // Seats that have not loaded yet judge nothing: the saved owner is simply a filter with no match.
  board = boardHarness({
    saved: { seat: "dev-a@hrig", state: "", tag: "", text: "" },
    seats: [],
  });
  try {
    await board.flush();
    assert.deepEqual(board.titles(), [
      "Fix the login redirect",
      "Write the docs",
      "Odd job",
    ]);
    assert.equal(board.empty(), undefined);
  } finally {
    board.unmount();
  }
});

test("task-filters board: with a filter set a line says how many tasks show and clears all four, with none set the board is today's board, and the markup keeps the same classes, controls and cards", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    assert.equal(board.note(), undefined, "no filter, no line");
    assert.equal(board.empty(), undefined);
    board.pick("Filter task state", "pending");
    assert.equal(
      board.text(board.note()),
      "Showing 3 of 6 tasks. Clear filters",
    );
    board.pick("Filter task state", "");
    assert.equal(
      board.note(),
      undefined,
      "clearing a box by hand removes the line",
    );
    board.pick("Filter tasks", "login");
    assert.equal(
      board.text(board.note()),
      "Showing 2 of 6 tasks. Clear filters",
      "text alone shows the line",
    );
    board.pick("Filter tasks", "zzz");
    assert.equal(
      board.note(),
      undefined,
      "with nothing showing the empty state speaks instead",
    );
    assert.ok(board.empty());
    assert.equal(
      board
        .all()
        .filter((n) => n.type === "button" && board.text(n) === "Clear filters")
        .length,
      1,
      "one Clear filters at a time",
    );
    board.pick("Filter tasks", "login");
    board.pick("Filter task tag", "slice:w2-asset-writes");
    board.pick("Filter task owner", "dev-b@hrig");
    board.pick("Filter task state", "pending");
    assert.equal(
      board.text(board.note()),
      "Showing 1 of 6 tasks. Clear filters",
    );
    board.button("Clear filters").props.onClick();
    assert.equal(board.titles().length, 6);
    assert.equal(board.note(), undefined);
    for (const label of [
      "Filter tasks",
      "Filter task owner",
      "Filter task state",
      "Filter task tag",
    ])
      assert.equal(board.value(label), "", label);
    assert.deepEqual(board.calls.filters.slice(-1), [
      { seat: "", state: "", tag: "", text: "" },
    ]);
    assert.equal(
      board.calls.rigAction.length + board.calls.sendMessage.length,
      0,
    );

    // Today's layout: the same grid now holds four controls in a fixed order; cards and columns are unchanged.
    const grid = board.byClass("form-grid")[0];
    assert.deepEqual(
      grid.props.children.map((c) => c.props["aria-label"]),
      [
        "Filter tasks",
        "Filter task owner",
        "Filter task state",
        "Filter task tag",
      ],
    );
    const card = board.byClass("task-card")[0];
    assert.deepEqual(
      board
        .all()
        .filter((n) => card.props.children.includes(n))
        .map((n) => [n.type, board.text(n)]),
      [
        ["strong", "Fix the login redirect"],
        ["span", "dev-a@hrig"],
        ["small", "pending"],
      ],
    );
    assert.equal(board.byClass("task-column").length, 4);
  } finally {
    board.unmount();
  }
  const source = read("src/TaskBoard.tsx");
  const classes = [
    ...new Set([...source.matchAll(/className="([^"]+)"/g)].map((m) => m[1])),
  ].sort();
  assert.deepEqual(classes, [
    "badge",
    "field-label",
    "field-note",
    "form-grid",
    "json-result",
    "modal-actions",
    "panel-empty",
    "primary-button",
    "secondary-button",
    "small-button",
    "success-note",
    "task-board",
    "task-card",
    "task-column",
    "tool-panel",
    "tool-panel-heading",
  ]);
  assert.equal(count(source, "style="), 0, "no inline style");
  assert.equal(count(source, "className={"), 0, "no computed class");
});

test("task-filters docs: TASKS.md says what the four filters do, where the tags come from, what is remembered and what is not, that nothing is sent, and README links to it", () => {
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n## Task board filters\n"), 1);
  const section = doc.slice(doc.indexOf("## Task board filters"));
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 4);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const say = (paragraph, parts) => {
    const flat = collapse(paragraph);
    for (const part of parts) assert.ok(flat.includes(part), "says: " + part);
  };
  say(paragraphs[0], [
    "Four filters narrow the board",
    "text in the task title, ignoring case",
    "the owner (the seat a task is assigned to)",
    "the state (pending, in-progress, blocked or failed)",
    "the tag",
    "passes every filter that is set",
    "with no filter set every task shows",
  ]);
  say(paragraphs[1], [
    "the tags found on the tasks that are loaded",
    "up to the 100 most used, sorted",
    "tags field as OpenRig reports it",
    "a list of names, or comma separated text",
    "without case or surrounding spaces",
    "A task without tags never matches a tag filter",
  ]);
  say(paragraphs[2], [
    "owner, state and tag you pick are remembered for each connection",
    "workspace file",
    "come back after a restart or reload",
    "text box is a quick search and is not remembered",
    "This is not a setting",
    "nothing is sent to OpenRig",
    "no task or seat is touched",
  ]);
  say(paragraphs[3], [
    "says how many tasks show",
    "Clear filters, which empties all four filters",
    "no longer exists",
    "the filter stays visible in its box",
    "instead of dropping it silently",
  ]);
  const intro = collapse(doc.slice(0, doc.indexOf("## Task board filters")));
  assert.ok(intro.includes("HRig reads the queue to show it"));
  assert.ok(
    intro.includes(
      "assigning work and requesting a handoff are separate, explicit actions",
    ),
  );

  const readme = read("README.md");
  const rows = readme
    .split("\n")
    .filter((line) => line.startsWith("| Task board |"));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].includes("Filter by owner, state, tag and text"));
  assert.ok(rows[0].includes("remembered per connection"));
  assert.equal(
    count(rows[0], "[Task board filters](TASKS.md#task-board-filters)"),
    1,
  );
  assert.ok(
    rows[0].includes(
      "Handoffs are requested from the owning seat rather than impersonating it.",
    ),
  );
  assert.ok(
    !rows[0].includes("owner, text and state"),
    "the old wording is gone",
  );
  assert.equal(
    count(readme, "TASKS.md"),
    1,
    "one link, from the Task board row",
  );
});

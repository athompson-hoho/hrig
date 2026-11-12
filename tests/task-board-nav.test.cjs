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
const between = (text, from, to) => {
  const start = text.indexOf(from);
  assert.ok(start >= 0, "missing anchor: " + from);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end >= 0, "missing anchor: " + to);
  return text.slice(start, end);
};

// The virtualized list of the long-list chain, drawn here as every row at once: these tests are about the board's
// own behavior (keys, filters, exports), and the list's windowing has its own tests.
function inlineList(props) {
  return { type: "div", props: { className: props.className, children: props.rows.map((row, i) => props.renderRow(row, i)) } };
}
inlineList.inline = true;

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
const lib = load("src/task-board-nav.ts");

// ---------------------------------------------------------------------------
// The real TaskBoard.tsx over a very small react: state slots, effects queued
// and run after the render the way react runs them, elements recorded as plain
// objects. Cards are stand-ins for DOM elements: a focus() that fires the
// board's focus handler, and a click() that fails the test, because a key must
// never click a card. The bridge is a fake that records every call it gets.

const CONNECTION = { id: "local", name: "Local", kind: "local" };
const SEATS = [{ name: "dev-a", rigName: "hrig" }];
const task = (id, status) => ({
  id,
  status,
  title: "Task " + id,
  destination: "dev-a@hrig",
});
// Columns: pending p1 p2 p3 | in-progress i1 | blocked (none) | other f1 f2.
const ROWS = [
  task("p1", "pending"),
  task("i1", "in-progress"),
  task("p2", "pending"),
  task("f1", "failed"),
  task("p3", "pending"),
  task("f2", "held"),
];

function boardHarness({ rows = ROWS } = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let pending = [];
  let cursor = 0;
  let tree = null;
  let current = rows;
  const calls = { queue: [], rigAction: [], sendMessage: [] };
  const state = { active: null, lost: false, focused: [], prevented: 0 };
  const before = {
    window: globalThis.window,
    document: globalThis.document,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const win = {
    hrig: {
      queue: (connection, rigName) => {
        calls.queue.push([connection, rigName]);
        return Promise.resolve(current);
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
        deps[i] = list;
        pending.push(() => {
          if (cleanups[i]) cleanups[i]();
          cleanups[i] = fn();
        });
      }
    },
  };
  const jsx = (type, props, key) =>
    typeof type === "function" && type.inline ? type(props) : { type, props, key };
  const Board = load("src/TaskBoard.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "lucide-react": {
      ListTodo: "ListTodo",
      Plus: "Plus",
      RefreshCw: "RefreshCw",
      ArrowUpRight: "ArrowUpRight",
    },
    "./VirtualList": { VirtualList: inlineList },
    "./components": {
      ErrorBox: "ErrorBox",
      Loading: "Loading",
      Modal: "Modal",
    },
  }).default;
  const props = {
    connection: CONNECTION,
    rigName: undefined,
    seats: SEATS,
    onSeat: () => {},
  };
  function render() {
    globalThis.window = win;
    globalThis.document = {
      get activeElement() {
        return state.active;
      },
    };
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    cursor = 0;
    tree = Board(props);
    const run = pending;
    pending = [];
    run.forEach((fn) => fn());
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
  // The stand-in elements: one per card in reading order, the board and the page around it.
  const dom = [];
  const boardEl = {
    querySelectorAll: (selector) => (selector === ".task-card" ? cards() : []),
    contains: (el) => !state.lost && cards().includes(el),
    querySelector: (selector) => {
      if (selector !== '.task-card[tabindex="0"]') return null;
      const at = byClass("task-card").findIndex((n) => n.props.tabIndex === 0);
      return at < 0 ? null : cards()[at];
    },
  };
  const outside = (name) => ({ name, closest: () => null });
  function cards() {
    const total = byClass("task-card").length;
    while (dom.length < total) {
      const index = dom.length;
      dom.push({
        index,
        closest: (selector) => (selector === ".task-board" ? boardEl : null),
        focus() {
          state.focused.push(index);
          state.active = this;
          state.lost = false;
          const { onFocus } = harness.node().props;
          if (onFocus) onFocus({ target: this, currentTarget: boardEl });
        },
        click() {
          throw new Error("a key must never click a card");
        },
      });
    }
    dom.length = total;
    return dom.slice();
  }
  const harness = {
    calls,
    state,
    boardEl,
    outside,
    all: () => all(tree),
    text,
    byClass,
    node: () => byClass("task-board")[0],
    cards,
    async flush() {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
    button: (name) =>
      all(tree).find((n) => n.type === "button" && text(n) === name),
    titles: () =>
      byClass("task-card").map((card) =>
        text(all(card).find((n) => n.type === "strong")),
      ),
    tabs: () => byClass("task-card").map((n) => n.props.tabIndex),
    columns: () =>
      byClass("task-column").map((column) => ({
        name: text(all(column).find((n) => n.type === "h4")),
        label: column.props["aria-label"],
        titles: byClass("task-card")
          .filter((card) => all(column).includes(card))
          .map((card) => text(all(card).find((n) => n.type === "strong"))),
      })),
    /** Focus the card at a reading position the way a click or Tab does. */
    focusCard(index) {
      cards()[index].focus();
    },
    /** One key event on a target (a card position by default), the way react hands it to the board. */
    press(key, { at, mods = {}, target } = {}) {
      const el = target || cards()[at];
      const event = {
        key,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        ...mods,
        target: el,
        currentTarget: boardEl,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
          state.prevented++;
        },
      };
      harness.node().props.onKeyDown(event);
      return event;
    },
    /** A refresh: the next queue read answers with these rows. */
    async refresh(next) {
      current = next;
      harness.button("Refresh").props.onClick();
      await harness.flush();
    },
    unmount() {
      cleanups.forEach((c) => c && c());
      globalThis.window = before.window;
      globalThis.document = before.document;
      globalThis.setInterval = before.setInterval;
      globalThis.clearInterval = before.clearInterval;
      if (before.window === undefined) delete globalThis.window;
      if (before.document === undefined) delete globalThis.document;
    },
  };
  return harness;
}

test("task-board-nav tracer: on the real task board ArrowDown and ArrowUp move focus between the cards of a column, the board renders the columns it always did, Enter is left alone and nothing is sent", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    assert.equal(board.calls.queue.length, 1);
    // The columns are what they were: the same four, the same headings and counts, the cards in the order given.
    assert.deepEqual(
      board.columns().map((c) => [c.name, c.titles]),
      [
        ["pending3", ["Task p1", "Task p2", "Task p3"]],
        ["in-progress1", ["Task i1"]],
        ["blocked0", []],
        ["Other states2", ["Task f1", "Task f2"]],
      ],
    );

    // ArrowDown on the first card focuses the next one of the same column and consumes the key.
    const down = board.press("ArrowDown", { at: 0 });
    assert.equal(down.defaultPrevented, true);
    assert.deepEqual(board.state.focused, [1]);
    board.press("ArrowDown", { at: 1 });
    assert.deepEqual(board.state.focused, [1, 2]);
    // At the last card of the column nothing moves, and the key is still consumed so the page does not scroll.
    const edge = board.press("ArrowDown", { at: 2 });
    assert.equal(edge.defaultPrevented, true);
    assert.deepEqual(board.state.focused, [1, 2]);
    // ArrowUp walks back.
    board.press("ArrowUp", { at: 2 });
    board.press("ArrowUp", { at: 1 });
    assert.deepEqual(board.state.focused, [1, 2, 1, 0]);

    // Enter, Space and keys typed anywhere but on a card are not touched.
    const before = board.state.prevented;
    for (const key of ["Enter", " "])
      assert.equal(board.press(key, { at: 0 }).defaultPrevented, false, key);
    const field = board.outside("filter box");
    assert.equal(
      board.press("ArrowDown", { target: field }).defaultPrevented,
      false,
    );
    assert.equal(board.state.prevented, before);

    // Display and focus only: the queue was read once and nothing was sent or changed.
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);
  } finally {
    board.unmount();
  }
});

// ---------------------------------------------------------------------------
// The pure module: tables, junk, and a seeded walk against an independent model.

const cell = (col, row) => ({ col, row });
const key = (k, mods = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});
/** Columns with the given number of cards each, every card with an id of its own. */
const grid = (...sizes) =>
  sizes.map((n, c) => ({
    state: "s" + c,
    label: "L" + c,
    items: Array.from({ length: n }, (_, r) => ({ id: "c" + c + "r" + r })),
  }));
const NAV = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
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
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test("task-board-nav columns: the four buckets are the ones the board always rendered, in the order given, with every other state last, and junk is left out", () => {
  assert.deepEqual(lib.BOARD_COLUMNS, [
    { state: "pending", label: "pending" },
    { state: "in-progress", label: "in-progress" },
    { state: "blocked", label: "blocked" },
    { state: "other", label: "Other states" },
  ]);
  assert.deepEqual(lib.NAV_KEYS, NAV);
  const items = [
    task("a", "pending"),
    task("b", "in-progress"),
    task("c", "blocked"),
    task("d", "failed"),
    task("e", "held"),
    task("f", "pending"),
    { id: "g" },
    { id: "h", status: 5 },
    { id: "i", status: null },
    task("j", "Pending"),
    task("k", "pending "),
    { id: "l", status: ["pending"] },
  ];
  const cols = lib.boardColumns(freeze(items.slice()));
  assert.deepEqual(
    cols.map((c) => [c.state, c.label, c.items.map((i) => i.id)]),
    [
      ["pending", "pending", ["a", "f"]],
      ["in-progress", "in-progress", ["b"]],
      ["blocked", "blocked", ["c"]],
      ["other", "Other states", ["d", "e", "g", "h", "i", "j", "k", "l"]],
    ],
  );
  assert.ok(cols[0].items[0] === items[0], "the same objects, not copies");
  assert.notEqual(
    lib.boardColumns(items)[0].items,
    cols[0].items,
    "fresh arrays",
  );

  // Entries that are not objects are left out (the old inline filter would have thrown on them).
  const junk = lib.boardColumns([
    null,
    3,
    "x",
    [],
    undefined,
    true,
    task("z", "pending"),
  ]);
  assert.deepEqual(
    junk.map((c) => c.items.length),
    [1, 0, 0, 0],
  );
  // Input that is not a list gives four empty columns and never throws.
  for (const value of [null, undefined, 0, "abc", {}, { length: 2 }, true]) {
    const empty = lib.boardColumns(value);
    assert.deepEqual(
      empty.map((c) => [c.state, c.items.length]),
      [
        ["pending", 0],
        ["in-progress", 0],
        ["blocked", 0],
        ["other", 0],
      ],
    );
  }

  // Against the filter the board used to run inline, twice: same cards in the same columns in the same order.
  const old = (visible, state) =>
    visible.filter((i) =>
      state === "other"
        ? !["pending", "in-progress", "blocked"].includes(i.status)
        : i.status === state,
    );
  const rand = seeded(11);
  const pool = [
    "pending",
    "in-progress",
    "blocked",
    "failed",
    "held",
    "done",
    "",
    undefined,
    null,
    0,
    "Pending",
    "other",
  ];
  for (let n = 0; n < 120; n++) {
    const visible = Array.from({ length: Math.floor(rand() * 40) }, (_, i) => ({
      id: "t" + i,
      status: pool[Math.floor(rand() * pool.length)],
    }));
    const got = lib.boardColumns(visible);
    for (const [k, name] of [
      "pending",
      "in-progress",
      "blocked",
      "other",
    ].entries()) {
      const want = old(visible, name);
      assert.equal(got[k].items.length, want.length, name);
      got[k].items.forEach((item, r) =>
        assert.ok(item === want[r], name + " " + r),
      );
    }
  }
});

test("task-board-nav keys: Up and Down, Home and End stay in the column, Left and Right skip empty columns and clamp the row, nothing wraps, and only a key pressed on its own counts", () => {
  const cols = freeze(grid(3, 0, 2, 1));
  const mv = (from, k, mods) => lib.moveFocus(cols, freeze(from), key(k, mods));
  // Inside a column; at the first or last card the same card comes back (a handled key that does not move).
  assert.deepEqual(mv(cell(0, 0), "ArrowDown"), cell(0, 1));
  assert.deepEqual(mv(cell(0, 1), "ArrowDown"), cell(0, 2));
  assert.deepEqual(mv(cell(0, 2), "ArrowDown"), cell(0, 2));
  assert.deepEqual(mv(cell(0, 2), "ArrowUp"), cell(0, 1));
  assert.deepEqual(mv(cell(0, 0), "ArrowUp"), cell(0, 0));
  assert.deepEqual(mv(cell(2, 1), "ArrowDown"), cell(2, 1));
  assert.deepEqual(mv(cell(2, 1), "ArrowUp"), cell(2, 0));
  assert.deepEqual(mv(cell(0, 1), "Home"), cell(0, 0));
  assert.deepEqual(mv(cell(0, 1), "End"), cell(0, 2));
  assert.deepEqual(mv(cell(2, 0), "End"), cell(2, 1));
  assert.deepEqual(mv(cell(3, 0), "Home"), cell(3, 0));
  assert.deepEqual(mv(cell(3, 0), "End"), cell(3, 0));
  // Across columns: the empty column is skipped and the row is kept, clamped to the last card.
  assert.deepEqual(mv(cell(0, 1), "ArrowRight"), cell(2, 1));
  assert.deepEqual(mv(cell(0, 2), "ArrowRight"), cell(2, 1));
  assert.deepEqual(mv(cell(0, 0), "ArrowRight"), cell(2, 0));
  assert.deepEqual(mv(cell(2, 1), "ArrowRight"), cell(3, 0));
  assert.deepEqual(mv(cell(3, 0), "ArrowLeft"), cell(2, 0));
  assert.deepEqual(mv(cell(2, 1), "ArrowLeft"), cell(0, 1));
  assert.deepEqual(mv(cell(2, 0), "ArrowLeft"), cell(0, 0));
  // No wrapping at either end of the board.
  assert.deepEqual(mv(cell(3, 0), "ArrowRight"), cell(3, 0));
  assert.deepEqual(mv(cell(0, 2), "ArrowLeft"), cell(0, 2));
  // One column with cards: sideways keys stay put, the rest work as usual.
  const lone = grid(0, 0, 0, 4);
  assert.deepEqual(
    lib.moveFocus(lone, cell(3, 2), key("ArrowLeft")),
    cell(3, 2),
  );
  assert.deepEqual(
    lib.moveFocus(lone, cell(3, 2), key("ArrowRight")),
    cell(3, 2),
  );
  assert.deepEqual(lib.moveFocus(lone, cell(3, 2), key("End")), cell(3, 3));
  // A full board moves one column at a time.
  assert.deepEqual(
    lib.moveFocus(grid(2, 2, 2, 2), cell(0, 1), key("ArrowRight")),
    cell(1, 1),
  );

  // A key held with Ctrl, Alt, Cmd or Shift, one typed during composition and one that is already handled are not ours.
  for (const mods of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
    { ctrlKey: true, altKey: true },
    { isComposing: true },
    { defaultPrevented: true },
  ])
    for (const k of NAV)
      assert.equal(mv(cell(0, 0), k, mods), null, k + JSON.stringify(mods));
  // Every other key is not ours either, whatever its spelling.
  for (const k of [
    "Enter",
    " ",
    "Spacebar",
    "Tab",
    "Escape",
    "PageDown",
    "PageUp",
    "a",
    "A",
    "Delete",
    "Backspace",
    "ArrowDownLeft",
    "arrowdown",
    "Down",
    "Up",
    "Left",
    "Right",
    "",
  ])
    assert.equal(mv(cell(0, 0), k), null, JSON.stringify(k));
  for (const event of [
    {},
    key(undefined),
    key(5),
    key(null),
    key(["ArrowDown"]),
    null,
    undefined,
    0,
    5,
    true,
    [],
    ["ArrowDown"],
    () => {},
  ])
    assert.equal(lib.moveFocus(cols, cell(0, 0), event), null);
  // A string is a key name; a real event keeps its fields on the prototype.
  assert.deepEqual(lib.moveFocus(cols, cell(0, 0), "ArrowDown"), cell(0, 1));
  assert.equal(lib.moveFocus(cols, cell(0, 0), "arrowdown"), null);
  assert.equal(lib.navKey("ArrowDown"), "ArrowDown");
  assert.equal(lib.navKey(key("End", { shiftKey: true })), null);
  class FakeEvent {
    get key() {
      return "ArrowDown";
    }
    get ctrlKey() {
      return false;
    }
  }
  assert.deepEqual(
    lib.moveFocus(cols, cell(0, 0), new FakeEvent()),
    cell(0, 1),
  );
  class WithCtrl extends FakeEvent {
    get ctrlKey() {
      return true;
    }
  }
  assert.equal(lib.moveFocus(cols, cell(0, 0), new WithCtrl()), null);
  // A result is a new object and the input is never changed (it is frozen above).
  const from = cell(0, 0);
  assert.notEqual(lib.moveFocus(cols, from, key("ArrowUp")), from);
});

test("task-board-nav stale: an empty board gives nothing, a position that is gone settles on the nearest card, junk starts at the first card, and no input throws", () => {
  // Empty boards: every shape of nothing.
  for (const empty of [
    grid(0, 0, 0, 0),
    grid(),
    [],
    null,
    undefined,
    {},
    "x",
    7,
    [null, 3, {}, { items: "x" }],
  ]) {
    for (const k of NAV)
      assert.equal(lib.moveFocus(empty, cell(0, 0), key(k)), null, k);
    assert.equal(lib.settleCell(empty, cell(0, 0)), null);
    assert.equal(lib.tabCell(empty, { id: "a", col: 0, row: 0 }), null);
    assert.equal(lib.stopAt(empty, cell(0, 0)), null);
    assert.equal(lib.cellIndex(empty, cell(0, 0)), -1);
    assert.equal(lib.cellAtIndex(empty, 0), null);
  }
  // A missing or junk position lands on the first card of the first column that has one, for every handled key.
  const cols = grid(0, 0, 2, 1);
  for (const from of [
    null,
    undefined,
    "x",
    3,
    [],
    {},
    { col: 1 },
    { row: 0 },
    { col: "1", row: 0 },
    { col: NaN, row: 0 },
    { col: 0, row: Infinity },
    { col: -Infinity, row: 0 },
  ])
    for (const k of NAV)
      assert.deepEqual(
        lib.moveFocus(cols, from, key(k)),
        cell(2, 0),
        JSON.stringify(from) + k,
      );
  assert.deepEqual(lib.settleCell(cols, null), cell(2, 0));
  assert.deepEqual(lib.moveFocus(grid(3, 1), null, key("End")), cell(0, 0));

  // A position that no longer exists settles first, then the key moves from there.
  const board = grid(3, 0, 2, 1);
  assert.deepEqual(
    lib.settleCell(board, cell(1, 0)),
    cell(0, 0),
    "an empty column: the nearest column, the left one on a tie",
  );
  assert.deepEqual(
    lib.moveFocus(board, cell(1, 0), key("ArrowDown")),
    cell(0, 1),
  );
  assert.deepEqual(
    lib.settleCell(board, cell(9, 9)),
    cell(3, 0),
    "past the last column",
  );
  assert.deepEqual(
    lib.settleCell(board, cell(-5, -5)),
    cell(0, 0),
    "before the first",
  );
  assert.deepEqual(
    lib.settleCell(grid(0, 0, 0, 3), cell(-3, 2)),
    cell(3, 2),
    "a column before the first is the first column, then the nearest with cards, row kept",
  );
  assert.deepEqual(
    lib.settleCell(grid(3, 0, 0, 0), cell(9, 2)),
    cell(0, 2),
    "a column past the last is the last column, then the nearest with cards, row kept",
  );
  assert.deepEqual(
    lib.settleCell(board, cell(0, 99)),
    cell(0, 2),
    "past the last row",
  );
  assert.deepEqual(
    lib.moveFocus(board, cell(0, 99), key("ArrowUp")),
    cell(0, 1),
  );
  assert.deepEqual(
    lib.moveFocus(board, cell(2, 99), key("ArrowDown")),
    cell(2, 1),
  );
  assert.deepEqual(
    lib.settleCell(board, cell(1.9, 0.2)),
    cell(0, 0),
    "fractions are cut",
  );
  assert.deepEqual(
    lib.settleCell(grid(0, 0, 0, 2), cell(1, 0)),
    cell(3, 0),
    "only a column further right has cards",
  );
  assert.deepEqual(
    lib.settleCell(grid(2, 0, 0, 0), cell(2, 0)),
    cell(0, 0),
    "only a column further left has cards",
  );
  assert.deepEqual(lib.settleCell(grid(0, 2, 0, 0), cell(2, 5)), cell(1, 1));
  assert.deepEqual(
    lib.settleCell(grid(0, 2, 0, 2), cell(2, 0)),
    cell(1, 0),
    "a tie goes left",
  );
  // Columns that are junk count as empty.
  const messy = [null, { items: "x" }, { items: [1] }, 5, {}];
  assert.deepEqual(
    lib.moveFocus(messy, cell(0, 0), key("ArrowDown")),
    cell(2, 0),
  );
  assert.deepEqual(
    lib.moveFocus(messy, cell(2, 0), key("ArrowRight")),
    cell(2, 0),
  );

  // A seeded fuzz of boards, positions and keys: never throws, and the answer is null or a real card.
  const rand = seeded(5);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const nums = [
    -1,
    0,
    1,
    2,
    3,
    4,
    99,
    1.5,
    NaN,
    Infinity,
    "1",
    null,
    undefined,
    {},
    [],
    true,
  ];
  const mods = [
    {},
    {},
    {},
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
  ];
  for (let n = 0; n < 600; n++) {
    const sizes = Array.from({ length: Math.floor(rand() * 6) }, () =>
      Math.floor(rand() * 4),
    );
    const junkBoard = rand() < 0.1;
    const columns = junkBoard
      ? pick([null, "x", 3, {}, [null, {}]])
      : grid(...sizes);
    const from =
      rand() < 0.2
        ? pick([null, "x", {}, 3])
        : { col: pick(nums), row: pick(nums) };
    const k = rand() < 0.9 ? pick(NAV) : pick(["Enter", "a", " "]);
    const held = pick(mods);
    const got = lib.moveFocus(columns, from, key(k, held));
    assert.ok(
      got === null || lib.cellIndex(columns, got) >= 0,
      JSON.stringify([sizes, from, k, got]),
    );
    // Null only for a key that is not ours, a modifier or a board with no cards.
    const total = sizes.reduce((a, b) => a + b, 0);
    if (
      !junkBoard &&
      total > 0 &&
      NAV.includes(k) &&
      Object.keys(held).length === 0
    )
      assert.notEqual(got, null, JSON.stringify([sizes, from, k]));
  }
});

test("task-board-nav model: a seeded walk over random boards agrees with an independent model of the grid, and reading order and positions map both ways", () => {
  const rand = seeded(7);
  const int = (n) => Math.floor(rand() * n);
  // The model keeps a list of every card as [column, row] and finds its answers by scanning that list.
  const model = (sizes, at, k) => {
    const [c, r] = at;
    if (k === "ArrowUp") return [c, Math.max(0, r - 1)];
    if (k === "ArrowDown") return [c, Math.min(sizes[c] - 1, r + 1)];
    if (k === "Home") return [c, 0];
    if (k === "End") return [c, sizes[c] - 1];
    const dir = k === "ArrowRight" ? 1 : -1;
    const next = sizes
      .map((n, i) => [n, i])
      .filter(([n, i]) => n > 0 && (dir > 0 ? i > c : i < c))
      .map(([, i]) => i);
    if (!next.length) return [c, r];
    const to = dir > 0 ? Math.min(...next) : Math.max(...next);
    return [to, Math.min(r, sizes[to] - 1)];
  };
  let steps = 0;
  for (let n = 0; n < 400; n++) {
    const sizes = Array.from({ length: 1 + int(6) }, () => int(5));
    const flat = sizes.flatMap((count, c) =>
      Array.from({ length: count }, (_, r) => [c, r]),
    );
    if (!flat.length) continue;
    const cols = grid(...sizes);
    flat.forEach(([c, r], i) => {
      assert.equal(lib.cellIndex(cols, cell(c, r)), i);
      assert.deepEqual(lib.cellAtIndex(cols, i), cell(c, r));
    });
    assert.equal(lib.cellAtIndex(cols, flat.length), null);
    assert.equal(lib.cellAtIndex(cols, -1), null);
    assert.deepEqual(
      lib.cellAtIndex(cols, 0.5),
      cell(flat[0][0], flat[0][1]),
      "a fraction is cut to a position",
    );
    let at = flat[int(flat.length)];
    for (let s = 0; s < 40; s++) {
      const k = NAV[int(NAV.length)];
      const want = model(sizes, at, k);
      const got = lib.moveFocus(cols, cell(at[0], at[1]), key(k));
      assert.deepEqual(
        got,
        cell(want[0], want[1]),
        JSON.stringify([sizes, at, k]),
      );
      at = want;
      steps++;
    }
  }
  assert.ok(steps > 10000);
});

test("task-board-nav stops: the tab stop follows a card by id across columns and refreshes, falls back to the nearest position when the id is gone, and a card without an id still works", () => {
  const cols = lib.boardColumns(ROWS); // p1 p2 p3 | i1 | | f1 f2
  assert.deepEqual(lib.stopAt(cols, cell(0, 1)), { id: "p2", col: 0, row: 1 });
  assert.deepEqual(lib.stopAt(cols, cell(3, 1)), { id: "f2", col: 3, row: 1 });
  for (const bad of [
    cell(2, 0),
    cell(9, 9),
    cell(0, 3),
    cell(-1, 0),
    null,
    undefined,
    "x",
    {},
    cell(0, NaN),
  ])
    assert.equal(lib.stopAt(cols, bad), null, JSON.stringify(bad));
  const odd = [
    {
      state: "a",
      label: "A",
      items: [
        {},
        { id: 7 },
        { id: "" },
        { id: NaN },
        { id: {} },
        { id: "ok" },
        null,
      ],
    },
  ];
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((r) => lib.stopAt(odd, cell(0, r))),
    [
      { id: null, col: 0, row: 0 },
      { id: "7", col: 0, row: 1 },
      { id: null, col: 0, row: 2 },
      { id: null, col: 0, row: 3 },
      { id: null, col: 0, row: 4 },
      { id: "ok", col: 0, row: 5 },
      { id: null, col: 0, row: 6 },
    ],
  );

  // The same id is found where it is now, even in another column, and wins over the old position.
  assert.deepEqual(lib.tabCell(cols, { id: "f1", col: 3, row: 0 }), cell(3, 0));
  assert.deepEqual(lib.tabCell(cols, { id: "p3", col: 0, row: 0 }), cell(0, 2));
  assert.deepEqual(lib.tabCell(cols, { id: "p3" }), cell(0, 2));
  const moved = lib.boardColumns(
    ROWS.map((r) => (r.id === "f1" ? { ...r, status: "pending" } : r)),
  );
  assert.deepEqual(
    lib.tabCell(moved, { id: "f1", col: 3, row: 0 }),
    cell(0, 2),
  );
  // A duplicate id gives the first card in reading order.
  assert.deepEqual(
    lib.tabCell(
      lib.boardColumns([task("x", "blocked"), task("x", "pending")]),
      { id: "x", col: 2, row: 0 },
    ),
    cell(0, 0),
  );
  // An id that is gone falls back to the nearest card by position: the same position while it exists, else the nearest column, clamped.
  assert.deepEqual(
    lib.tabCell(cols, { id: "gone", col: 0, row: 1 }),
    cell(0, 1),
  );
  assert.deepEqual(
    lib.tabCell(cols, { id: "gone", col: 0, row: 9 }),
    cell(0, 2),
  );
  const fewer = lib.boardColumns(ROWS.filter((r) => r.id[0] !== "f"));
  assert.deepEqual(
    lib.tabCell(fewer, { id: "f2", col: 3, row: 1 }),
    cell(1, 0),
    "the other column emptied: the nearest column with cards",
  );
  // No id on the card, a stop without a position, junk and nothing remembered: by position, else the first card.
  assert.deepEqual(lib.tabCell(cols, { id: null, col: 1, row: 0 }), cell(1, 0));
  assert.deepEqual(lib.tabCell(cols, { id: "", col: 3, row: 1 }), cell(3, 1));
  assert.deepEqual(
    lib.tabCell(cols, { id: 5, col: 0, row: 2 }),
    cell(0, 2),
    "an id that is not text is not searched",
  );
  for (const stop of [
    null,
    undefined,
    {},
    "x",
    4,
    [],
    { id: "gone" },
    { col: "a", row: "b" },
  ])
    assert.deepEqual(lib.tabCell(cols, stop), cell(0, 0), JSON.stringify(stop));
  assert.deepEqual(lib.tabCell(grid(0, 0, 3, 0), null), cell(2, 0));
});

test("task-board-nav roving: on the real board exactly one card is a tab stop at every step, it follows focus, keys and refreshes, and the keys reach every column", async () => {
  const board = boardHarness();
  const oneStop = () =>
    assert.equal(
      board.tabs().filter((t) => t === 0).length,
      board.tabs().length ? 1 : 0,
    );
  try {
    await board.flush();
    // Nothing used yet: Tab enters the board at the first card and passes the other five.
    assert.deepEqual(board.tabs(), [0, -1, -1, -1, -1, -1]);
    // A card that takes focus, by click or Tab, becomes the stop.
    board.focusCard(2);
    assert.deepEqual(board.tabs(), [-1, -1, 0, -1, -1, -1]);
    // Reading order is p1 p2 p3 | i1 | f1 f2 (index 0 to 5). Right skips the empty blocked column.
    board.press("ArrowRight", { at: 2 });
    assert.deepEqual(board.tabs(), [-1, -1, -1, 0, -1, -1]);
    board.press("ArrowRight", { at: 3 });
    assert.deepEqual(board.tabs(), [-1, -1, -1, -1, 0, -1]);
    const edge = board.press("ArrowRight", { at: 4 });
    assert.equal(edge.defaultPrevented, true);
    assert.deepEqual(board.tabs(), [-1, -1, -1, -1, 0, -1]);
    board.press("End", { at: 4 });
    assert.deepEqual(board.tabs(), [-1, -1, -1, -1, -1, 0]);
    board.press("Home", { at: 5 });
    assert.deepEqual(board.tabs(), [-1, -1, -1, -1, 0, -1]);
    board.press("ArrowLeft", { at: 4 });
    assert.deepEqual(board.tabs(), [-1, -1, -1, 0, -1, -1]);
    board.press("ArrowLeft", { at: 3 });
    assert.deepEqual(board.tabs(), [0, -1, -1, -1, -1, -1]);
    board.press("ArrowLeft", { at: 0 });
    assert.deepEqual(board.tabs(), [0, -1, -1, -1, -1, -1]);
    board.press("End", { at: 0 });
    assert.deepEqual(board.tabs(), [-1, -1, 0, -1, -1, -1]);
    oneStop();

    // A refresh that moves the remembered task to another column: the stop follows the task.
    board.focusCard(4); // f1
    await board.refresh(
      ROWS.map((r) => (r.id === "f1" ? { ...r, status: "pending" } : r)),
    );
    assert.deepEqual(
      board.columns().map((c) => c.titles.length),
      [4, 1, 0, 1],
    );
    assert.deepEqual(board.tabs(), [-1, -1, 0, -1, -1, -1]);
    assert.equal(board.titles()[2], "Task f1");
    // The task is gone and the board is smaller: the stop falls to the nearest card (focus is elsewhere, so nothing is moved).
    board.state.active = board.outside("filter box");
    await board.refresh(ROWS.filter((r) => r.id[0] !== "f"));
    assert.deepEqual(board.tabs(), [-1, -1, -1, 0]);
    oneStop();
    // No tasks at all: no board, nothing to tab to, nothing throws; when they come back the stop is where it was remembered.
    await board.refresh([]);
    assert.deepEqual(board.tabs(), []);
    await board.refresh(ROWS);
    assert.equal(board.tabs().length, 6);
    oneStop();
    // A filter that hides every card leaves an empty board; one card left makes that card the stop.
    const filter = board
      .all()
      .find((n) => n.props && n.props["aria-label"] === "Filter tasks");
    filter.props.onChange({ target: { value: "zzz" } });
    assert.deepEqual(board.tabs(), []);
    board
      .all()
      .find((n) => n.props && n.props["aria-label"] === "Filter tasks")
      .props.onChange({ target: { value: "p2" } });
    assert.deepEqual(board.tabs(), [0]);
  } finally {
    board.unmount();
  }
});

test("task-board-nav refresh: focus goes back to the nearest card only when the board had focus and lost it, and is never taken from anything else", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    board.focusCard(4); // f1
    assert.deepEqual(board.state.focused, [4]);

    // The focused card is still there after the refresh: nothing is moved.
    await board.refresh(ROWS.slice());
    assert.deepEqual(board.state.focused, [4]);

    // Its element was replaced because the task changed column: focus returns to the same task in its new place.
    board.state.lost = true;
    await board.refresh(
      ROWS.map((r) => (r.id === "f1" ? { ...r, status: "pending" } : r)),
    );
    assert.deepEqual(board.state.focused, [4, 2]);
    assert.equal(board.titles()[2], "Task f1");
    assert.deepEqual(board.tabs(), [-1, -1, 0, -1, -1, -1]);

    // The focused task is gone: focus goes to the card nearest to where it was.
    board.focusCard(5); // f2
    await board.refresh(ROWS.filter((r) => r.id[0] !== "f"));
    assert.deepEqual(board.state.focused, [4, 2, 5, 3]);
    assert.equal(board.titles()[3], "Task i1");

    // Focus in a filter box, a dialog or nowhere is never touched, even when the board changes under it.
    for (const elsewhere of [
      board.outside("filter box"),
      board.outside("dialog"),
      null,
    ]) {
      board.focusCard(0);
      const log = board.state.focused.length;
      board.state.active = elsewhere;
      board.state.lost = true;
      await board.refresh(ROWS);
      assert.equal(
        board.state.focused.length,
        log,
        String(elsewhere && elsewhere.name),
      );
      await board.refresh(ROWS.filter((r) => r.id !== "p1"));
      assert.equal(board.state.focused.length, log);
    }
    // The first load, with nothing focused, moves nothing either.
    const fresh = boardHarness();
    try {
      await fresh.flush();
      assert.deepEqual(fresh.state.focused, []);
    } finally {
      fresh.unmount();
    }
    assert.equal(
      board.calls.rigAction.length + board.calls.sendMessage.length,
      0,
    );
  } finally {
    board.unmount();
  }
});

test("task-board-nav scope: keys act only on a card and only when handled, filters and dialogs keep theirs, accessible names are on the board and its columns, and a long walk never clicks, sends or loses its single tab stop", async () => {
  const board = boardHarness();
  try {
    await board.flush();
    // Only the board listens, and only for keys and focus: no handler on a filter control or a card.
    const handlers = board
      .all()
      .filter(
        (n) =>
          n.props &&
          (n.props.onKeyDown || n.props.onKeyUp || n.props.onKeyPress),
      );
    assert.deepEqual(
      handlers.map((n) => n.props.className),
      ["task-board"],
    );
    assert.equal(
      board.all().filter((n) => n.props && n.props.onFocus).length,
      1,
    );
    for (const card of board.byClass("task-card")) {
      assert.deepEqual(Object.keys(card.props).sort(), [
        "children",
        "className",
        "data-stuck",
        "onClick",
        "tabIndex",
      ]);
    }
    // Columns and cards keep their keys (state and task id), so a card that stays in its column keeps its element, and focus, across a refresh.
    assert.deepEqual(
      board.byClass("task-column").map((n) => n.key),
      ["pending", "in-progress", "blocked", "other"],
    );
    assert.deepEqual(
      board.byClass("task-card").map((n) => n.key),
      ["p1", "p2", "p3", "i1", "f1", "f2"],
    );
    // A key on the board itself or on a control around it is not ours.
    for (const target of [
      board.boardEl,
      board.outside("filter box"),
      board.outside("owner select"),
      undefined,
    ])
      for (const k of NAV)
        assert.equal(board.press(k, { target }).defaultPrevented, false);
    // On a card: other keys, and handled keys with a modifier, are left alone; handled keys are consumed once.
    for (const k of [
      "Enter",
      " ",
      "Tab",
      "Escape",
      "PageDown",
      "PageUp",
      "a",
      "?",
      "Delete",
    ])
      assert.equal(board.press(k, { at: 1 }).defaultPrevented, false, k);
    for (const mods of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ])
      for (const k of NAV)
        assert.equal(
          board.press(k, { at: 1, mods }).defaultPrevented,
          false,
          k,
        );
    assert.equal(board.state.prevented, 0);
    for (const k of NAV) {
      const before = board.state.prevented;
      board.press(k, { at: 1 });
      assert.equal(board.state.prevented, before + 1, k);
    }

    // Accessible names: the board is a named group that says how to use it, each column says its state and count; the headings keep their text.
    assert.equal(board.node().props.role, "group");
    assert.equal(
      board.node().props["aria-label"],
      "Tasks by state. Use the arrow keys, Home and End to move between tasks.",
    );
    assert.deepEqual(
      board.columns().map((c) => [c.name, c.label]),
      [
        ["pending3", "pending, 3 tasks"],
        ["in-progress1", "in-progress, 1 task"],
        ["blocked0", "blocked, 0 tasks"],
        ["Other states2", "Other states, 2 tasks"],
      ],
    );
    assert.equal(
      board.all().filter((n) => n.props && n.props.role === "list").length,
      0,
      "no list role: the headings would be invalid children",
    );

    // A long seeded walk: every key and no key, on every card. Nothing clicked (the cards throw on click), nothing sent, one tab stop throughout.
    const rand = seeded(3);
    let at = 0;
    for (let n = 0; n < 300; n++) {
      const k =
        rand() < 0.8
          ? NAV[Math.floor(rand() * NAV.length)]
          : ["Enter", " ", "Tab", "x"][Math.floor(rand() * 4)];
      const event = board.press(k, { at });
      if (event.defaultPrevented) {
        const stop = board.tabs().indexOf(0);
        assert.equal(board.tabs().filter((t) => t === 0).length, 1);
        at = stop;
        assert.equal(board.state.active.index, stop);
      }
    }
    assert.equal(board.calls.queue.length, 1);
    assert.equal(board.calls.rigAction.length, 0);
    assert.equal(board.calls.sendMessage.length, 0);
  } finally {
    board.unmount();
  }
});

test("task-board-nav wiring: the module is pure and only the board uses it, the board has one key handler that moves focus and nothing else, the column split exists once, and no shortcut, setting, style, timer or bridge call was added", () => {
  // The module: plain data in and out, no imports, no page, no clock, no bridge; every export has a doc comment.
  const source = read("src/task-board-nav.ts");
  const code = stripComments(source);
  assert.ok(!/^\s*import\s/m.test(code), "no imports");
  assert.ok(
    !/\b(require|document|window|navigator|localStorage|sessionStorage|setTimeout|setInterval|requestAnimationFrame|Date|fetch|process)\b|Math\.random|hrig/.test(
      code,
    ),
  );
  const exported = [
    ...source.matchAll(/^export (?:const|function|type) (\w+)/gm),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(exported, [
    "BOARD_COLUMNS",
    "BoardColumn",
    "Cell",
    "NAV_KEYS",
    "Stop",
    "boardColumns",
    "cellAtIndex",
    "cellIndex",
    "moveFocus",
    "navKey",
    "settleCell",
    "stopAt",
    "tabCell",
  ]);
  assert.deepEqual(
    Object.keys(lib).sort(),
    exported.filter((n) => !["BoardColumn", "Cell", "Stop"].includes(n)),
  );
  const lines = source.split("\n");
  for (const [index, line] of lines.entries())
    if (/^export /.test(line) && !/^export type /.test(line))
      assert.ok(lines[index - 1].startsWith("/** "), "doc comment: " + line);

  // The board: one import from the module, one column split (the old two inline filters are gone), one key handler on the board.
  const boardSource = read("src/TaskBoard.tsx");
  const board = collapse(stripComments(boardSource));
  assert.equal(count(board, 'from "./task-board-nav";'), 1);
  assert.equal(count(board, "boardColumns(visible)"), 1);
  assert.equal(count(board, "tabCell(columns, stop)"), 1);
  assert.equal(count(board, "moveFocus("), 1);
  for (const gone of [
    '["pending", "in-progress", "blocked", "other"]',
    '!["pending", "in-progress", "blocked"]',
    "visible.filter(",
  ])
    assert.equal(count(board, gone), 0, "gone: " + gone);
  assert.equal(count(board, "onKeyDown="), 1);
  assert.equal(count(board, "onKeyUp="), 0);
  assert.equal(count(board, "onFocus="), 1);
  assert.equal(count(board, "tabIndex="), 1);
  assert.equal(count(board, "tabIndex={tabFor(col, row)}"), 1);
  assert.equal(
    count(board, "event.preventDefault()"),
    1,
    "only the handled key is consumed",
  );
  assert.equal(
    count(board, ".focus()"),
    2,
    "the key handler and the refresh restore",
  );
  assert.equal(count(board, ".click("), 0, "a key never clicks a card");
  assert.equal(count(board, "document.activeElement"), 2);
  assert.equal(count(board, 'typeof document === "undefined"'), 2);
  const handler = between(board, "const onBoardKey =", "const onBoardFocus =");
  assert.ok(
    !/onClick|inspect|mutate|rigAction|sendMessage|hrig|set[A-Z]|\.click\(/.test(
      handler,
    ),
    "the key handler only moves focus",
  );
  const focus = between(board, "const onBoardFocus =", "const reasonNote =");
  assert.ok(
    !/onClick|inspect|mutate|rigAction|sendMessage|hrig|setSelected|setError|setBusy|setNotice|setRefresh/.test(
      focus,
    ),
  );
  for (const absent of [
    "setTimeout(",
    "requestAnimationFrame",
    "addEventListener",
    "localStorage",
    "sessionStorage",
    "dangerouslySetInnerHTML",
    'role="list"',
    'role="listitem"',
  ])
    assert.equal(count(board, absent), 0, "absent: " + absent);
  assert.equal(count(board, "setInterval("), 1, "no timer was added");
  assert.equal(count(boardSource, "style="), 0);
  assert.equal(count(boardSource, "className={"), 0);
  const bridge = [
    ...stripComments(boardSource).matchAll(/window\s*\.hrig\s*\.(\w+)/g),
  ]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(bridge, ["queue", "rigAction", "rigAction", "sendMessage"]);
  // The card keeps its click and gains only the tab stop; Enter and Space are the button's own.
  assert.equal(
    count(
      board,
      'className="task-card" key={item.id} onClick={() => inspect(item)} tabIndex={tabFor(col, row)} data-stuck=',
    ),
    1,
  );

  // Nothing else uses the module, and no shortcut, setting, stylesheet rule or main process file mentions it.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((f) => /\.tsx?$/.test(f) && f !== "task-board-nav.ts")
    .filter((f) => read("src/" + f).includes("task-board-nav"));
  assert.deepEqual(users, ["TaskBoard.tsx"]);
  for (const file of [
    "src/shortcuts.ts",
    "src/settings.ts",
    "src/App.tsx",
    "src/styles.css",
  ])
    assert.ok(
      !/task-board-nav|onBoardKey|BOARD_COLUMNS/.test(read(file)),
      file,
    );
  for (const file of fs.readdirSync(path.join(root, "electron")))
    if (/\.(cjs|mjs|js)$/.test(file))
      assert.ok(!read("electron/" + file).includes("task-board-nav"), file);
});

test("task-board-nav docs: TASKS.md and NAVIGATION.md say which keys move where, that the board is one Tab stop, that Enter opens the details as before, that it is not a shortcut or a setting, what a refresh does, and that nothing is sent", () => {
  const doc = read("TASKS.md");
  assert.ok(!/[^\n -~]/.test(doc), "plain ASCII");
  assert.ok(doc.startsWith("# Task board\n\n"));
  assert.equal(count(doc, "\n### Keyboard navigation\n"), 1);
  assert.equal(
    count(doc, "\n## "),
    2,
    "the two level 2 headings other tests count are untouched",
  );
  // The section sits before Card details, so the sections that other tests read to the next heading keep their paragraphs.
  assert.ok(
    doc.indexOf("\n### Keyboard navigation\n") <
      doc.indexOf("\n### Card details\n"),
  );
  assert.ok(
    doc.indexOf("\n### Keyboard navigation\n") >
      doc.indexOf("separate, explicit actions."),
  );
  const at = doc.indexOf("\n### Keyboard navigation\n");
  const section = doc.slice(at + 1, doc.indexOf("\n### Card details\n"));
  const paragraphs = section.trim().split("\n\n").slice(1);
  assert.equal(paragraphs.length, 3);
  for (const paragraph of paragraphs)
    assert.ok(!paragraph.includes("\n"), "one line per paragraph");
  const say = (paragraph, parts) => {
    const flat = collapse(paragraph);
    for (const part of parts)
      assert.ok(flat.includes(part), "TASKS.md says: " + part);
  };
  say(paragraphs[0], [
    "driven from the keyboard",
    "the board is one stop, on the card you used last (the first card at first), instead of one stop per card",
    "Up and Down move to the previous and next card of the same column",
    "Left and Right move to the nearest column that has cards and keep the same row when it can (the last card of that column otherwise)",
    "Home and End go to the first and last card of the column",
    "Focus does not wrap around",
    "Enter or Space opens the task details, as clicking the card does, and Escape closes them again",
  ]);
  say(paragraphs[1], [
    "only while a card has focus and only when pressed on their own",
    "a key held with Ctrl, Alt, Cmd or Shift is left to the app",
    "the filter boxes above the board keep their own arrow, Home and End keys",
    "This is not a shortcut",
    "not in the Keyboard shortcuts sheet or in Settings, there is no setting for it",
    "the focused card showing the same focus ring as any button",
  ]);
  say(paragraphs[2], [
    "only moves focus and never changes a task",
    "does not open, send, assign or hand off anything",
    "nothing is typed into a seat",
    "every 15 seconds",
    "focus stays on the same task while it is still shown, in its new column if its state changed",
    "if it is gone, focus goes to the card nearest to where it was",
    "A refresh never takes focus from anything outside the board",
  ]);
  const refresh = /setInterval\(load, (\d+)\)/.exec(read("src/TaskBoard.tsx"));
  assert.equal(
    Number(refresh[1]) / 1000,
    15,
    "the doc's refresh period is the code's",
  );
  // The keys named in the docs are the keys the module handles.
  assert.deepEqual(lib.NAV_KEYS, NAV);

  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark is kept");
  assert.ok(raw.endsWith(".\n") && !raw.endsWith("\n\n"));
  assert.ok(!raw.includes("\r"));
  const navLines = raw.split("\n");
  const mine = navLines.filter((l) =>
    l.startsWith("Task board keyboard navigation:"),
  );
  assert.equal(mine.length, 1);
  const para = mine[0];
  assert.ok(/^[\x20-\x7e]+$/.test(para), "plain ASCII");
  const where = navLines.indexOf(para);
  assert.ok(
    navLines[where - 1] === "" && navLines[where + 1] === "",
    "a paragraph of its own",
  );
  assert.ok(
    where > navLines.findIndex((l) => l.startsWith("Shortcut overrides:")),
    "after the last earlier paragraph",
  );
  for (const part of [
    "the board is one Tab stop, on the card you used last",
    "Up and Down inside a column, Left and Right to the nearest column that has cards, Home and End to the first and last card of the column",
    "Enter or Space opens the task details, as a click does, and Escape closes them",
    "only while a card has focus and only without Ctrl, Alt, Cmd or Shift",
    "the filter boxes, the app shortcuts and terminals keep every key they had",
    "It is not a global shortcut",
    "not in the Keyboard shortcuts sheet or the command center, it cannot be rebound, there is no setting for it",
    "nothing is typed or sent to a terminal or seat",
    "TASKS.md describes what the board does when it refreshes",
  ])
    assert.ok(para.includes(part), "NAVIGATION.md says: " + part);
  // README keeps its single link to TASKS.md.
  assert.equal(count(read("README.md"), "TASKS.md"), 1);
});

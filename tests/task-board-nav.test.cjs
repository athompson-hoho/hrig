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
  const jsx = (type, props, key) => ({ type, props, key });
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

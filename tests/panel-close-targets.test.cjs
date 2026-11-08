"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { buildSync, transformSync } = require("esbuild");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const tight = (text) =>
  collapse(text)
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, \}/g, " }");
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
const close = load("src/panel-close-targets.ts");
const closed = load("src/closed-panels.ts");

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const info = (id, kind = "file", extra = {}) => ({
  id,
  name: id + ".txt",
  kind,
  dirty: false,
  locked: false,
  ...extra,
});

// ---------------------------------------------------------------------------
// A small react runtime for the real PanelContextMenu: state slots, effects
// with their cleanups, and a render after every state change.

function menuHarness(menu, platformWindow = {}) {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let cursor = 0;
  let tree = null;
  const listeners = [];
  const win = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    ...platformWindow,
  };
  globalThis.window = win;
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
  const Menu = load("src/PanelContextMenu.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./components": { Modal: "Modal" },
  }).default;
  const calls = { dismissed: 0, closed: [] };
  const props = {
    menu,
    onDismiss: () => {
      calls.dismissed++;
    },
    onClosePanels: (ids) => calls.closed.push(ids),
  };
  function render() {
    globalThis.window = win;
    cursor = 0;
    tree = Menu(props);
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
        : typeof node === "string"
          ? node
          : "";
  const button = (name) =>
    all(tree).find((n) => n.type === "button" && text(n) === name);
  return {
    calls,
    props,
    listeners,
    win,
    render,
    all: () => all(tree),
    text,
    button,
    menuNode: () => all(tree).find((n) => n.props && n.props.role === "menu"),
    items: () =>
      all(tree)
        .filter((n) => n.type === "button" && n.props.role === "menuitem")
        .map((n) => ({ label: text(n), disabled: !!n.props.disabled })),
    modal: () => all(tree).find((n) => n.type === "Modal"),
    click: (name) => button(name).props.onClick(),
    setMenu(next) {
      props.menu = next;
      render();
    },
    unmount() {
      globalThis.window = win;
      cleanups.forEach((c) => c && c());
      delete globalThis.window;
    },
  };
}

// ---------------------------------------------------------------------------
// The real App text, cut out, stripped of its types and run over fakes.

class FakeTab {
  constructor(id, extra = {}) {
    this.id = id;
    this.name = extra.name || id;
    this.component = extra.component || "editor";
    this.config = extra.config || {
      connection: { id: "local" },
      root: "/p",
      path: id,
    };
    this.pinned = !!extra.pinned;
    this.closeable = extra.closeable !== false;
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getComponent() {
    return this.component;
  }
  getConfig() {
    return this.config;
  }
  isPinned() {
    return this.pinned;
  }
  isCloseable() {
    return this.closeable;
  }
  getParent() {
    return this.parent;
  }
}
class FakeTabSet {
  constructor(tabs) {
    this.tabs = tabs;
    for (const tab of tabs) tab.parent = this;
  }
  getType() {
    return "tabset";
  }
  getTabNodes() {
    return this.tabs;
  }
  getParent() {
    return undefined;
  }
}

function appText() {
  return read("src/App.tsx");
}
function between(text, from, to) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, "found: " + from);
  return text.slice(a, b);
}

// The Layout onContextMenu hook, as a function.
function hookFunction(fakes) {
  const body = between(
    appText(),
    "onContextMenu={(node, event) => {",
    "realtimeResize",
  )
    .replace(/^onContextMenu=\{/, "")
    .replace(/\}\s*$/, "");
  const js = transformSync("const hook = " + body, { loader: "ts" }).code;
  const names = Object.keys(fakes);
  return new Function(...names, js + "\nreturn hook;")(
    ...names.map((n) => fakes[n]),
  );
}

// rememberClosed, closeTab and closePanels, the real text, over a fake model.
function closeHarness(tabs, options = {}) {
  const model = {
    nodes: new Map(tabs.map((t) => [t.id, t])),
    getNodeById(id) {
      return this.nodes.get(id);
    },
    doAction(action) {
      this.nodes.delete(action.id);
    },
  };
  const state = {
    closedPanels: { current: [] },
    history: { current: { past: [1], future: [] } },
    dirtyTabs: { current: new Set(options.dirty || []) },
    terminalsClosed: [],
    buffersCleared: [],
    pending: null,
    errors: [],
    timers: [],
    modelChanged: 0,
    order: [],
  };
  const fakes = {
    model,
    TabNode: FakeTab,
    workspace: "local::/p::",
    closedPanels: state.closedPanels,
    history: state.history,
    dirtyTabs: state.dirtyTabs,
    describeClosedPanel: closed.describeClosedPanel,
    pushClosed: closed.pushClosed,
    dirtyPrompt: close.dirtyPrompt,
    window: {
      hrig: {
        closeTerminal: (id) => {
          state.terminalsClosed.push(id);
          return Promise.resolve();
        },
      },
    },
    clearBuffer: (id) => state.buffersCleared.push(id),
    Actions: {
      deleteTab: (id) => {
        state.order.push(id);
        return { type: "deleteTab", id };
      },
    },
    modelChanged: () => state.modelChanged++,
    setPending: (value) => (state.pending = value),
    setActionError: (value) => state.errors.push(value),
    setTimeout: (fn) => state.timers.push(fn),
  };
  const text = between(
    appText(),
    "const rememberClosed = (id: string) => {",
    "const onAction = (action: Action) => {",
  );
  const js = transformSync(text, { loader: "ts" }).code;
  const names = Object.keys(fakes);
  const make = new Function(
    ...names,
    js + "\nreturn { rememberClosed, closeTab, closePanels };",
  );
  const out = make(...names.map((n) => fakes[n]));
  return {
    ...out,
    state,
    model,
    open: () => [...model.nodes.keys()],
    flush() {
      const run = state.timers.splice(0);
      for (const fn of run) fn();
    },
    answer(button) {
      const pending = state.pending;
      if (button === "discard") state.dirtyTabs.current.delete(pending.tabId);
      if (button === "discard" || button === "save") pending.run();
      state.pending = null;
      return pending;
    },
  };
}

const seat = (id) =>
  new FakeTab("seat:local:" + id, {
    name: id,
    component: "terminal",
    config: {
      connection: { id: "local" },
      root: "/p",
      seat: { id },
      terminalId: "seat:local:" + id,
    },
  });
const shell = (id) =>
  new FakeTab(id, {
    name: id,
    component: "terminal",
    config: { connection: { id: "local" }, root: "/p", terminalId: id },
  });
const file = (id, extra = {}) => new FakeTab(id, extra);

test("panel-close-targets tracer: a right click on a tab opens the menu for its own group, Close others asks first with the counts, and the panels close through the real closeTab, remember files and seats for Reopen, and stop to ask about unsaved edits", () => {
  // Group 1 holds the clicked tab; group 2 must never be touched.
  const tabs = [
    file("a"),
    file("b"),
    file("c"),
    shell("sh1"),
    seat("s1"),
    file("d"),
  ];
  const other = [file("x"), file("y")];
  const group = new FakeTabSet(tabs);
  new FakeTabSet(other);
  const doc = { id: "main" };
  const opened = [];
  let prevented = 0;
  const hook = hookFunction({
    TabNode: FakeTab,
    TabSetNode: FakeTabSet,
    document: doc,
    dirtyTabs: { current: new Set(["c"]) },
    panelKind: close.panelKind,
    setTabMenu: (value) => opened.push(value),
  });
  const fire = (node, ownerDocument = doc) =>
    hook(node, {
      currentTarget: { ownerDocument },
      clientX: 120,
      clientY: 80,
      preventDefault: () => prevented++,
    });
  // Not a tab, or a click in another window's document: nothing opens and nothing is prevented.
  fire(group);
  fire(tabs[1], { id: "popout" });
  assert.equal(opened.length, 0);
  assert.equal(prevented, 0);
  fire(tabs[1]);
  assert.equal(prevented, 1);
  assert.equal(opened.length, 1);
  const menu = opened[0];
  assert.equal(menu.id, "b");
  assert.equal(menu.x, 120);
  assert.equal(menu.y, 80);
  assert.deepEqual(
    menu.panels.map((p) => [p.id, p.kind, p.dirty, p.locked]),
    [
      ["a", "file", false, false],
      ["b", "file", false, false],
      ["c", "file", true, false],
      ["sh1", "shell", false, false],
      ["seat:local:s1", "seat", false, false],
      ["d", "file", false, false],
    ],
    "the clicked tab's own group, in strip order",
  );

  // The real menu over that state, then the real close path over a fake model.
  const closer = closeHarness([...tabs, ...other], { dirty: ["c"] });
  const h = menuHarness(menu);
  assert.deepEqual(h.items(), [
    { label: "Close", disabled: false },
    { label: "Close others", disabled: false },
    { label: "Close to the right", disabled: false },
  ]);
  h.props.onClosePanels = (ids) => closer.closePanels(ids);
  h.click("Close others");
  assert.equal(h.calls.dismissed, 1, "the menu goes away first");
  h.setMenu(null);
  const ask = h.modal();
  assert.ok(ask, "a confirmation is shown: more than one panel and a terminal");
  assert.equal(ask.props.title, "Close 5 panels?");
  assert.equal(
    ask.props.subtitle,
    "This closes 5 panels: 3 files, 1 shell and 1 seat panel. Closing a shell ends it and anything running in it. A seat panel only detaches: the seat's session keeps running. 1 panel has unsaved edits and will ask before closing. Files and seat panels can be brought back with Reopen closed panel.",
  );
  assert.deepEqual(closer.open().length, 8, "nothing closed yet");
  h.click("Cancel");
  assert.equal(h.modal(), undefined);
  assert.deepEqual(closer.open().length, 8, "Cancel closes nothing");
  assert.deepEqual(closer.state.terminalsClosed, []);

  // Ask again and confirm: the panels close right to left until the one with unsaved edits.
  h.setMenu(menu);
  h.click("Close others");
  h.setMenu(null);
  h.click("Close 5 panels");
  assert.deepEqual(
    closer.state.order,
    ["d", "seat:local:s1", "sh1"],
    "d, the seat and the shell closed; c has unsaved edits and stops the run",
  );
  assert.deepEqual(closer.state.terminalsClosed, ["seat:local:s1", "sh1"]);
  assert.equal(closer.state.pending.tabId, "c");
  assert.equal(closer.state.pending.title, "Save your changes?");
  assert.equal(
    closer.state.pending.description,
    "c has unsaved edits. Save them before closing, or discard them. 1 more panel will close after it.",
  );
  assert.deepEqual(closer.state.errors, [""]);
  assert.equal(
    closer.state.history.current.past.length,
    0,
    "undo history clears like any close",
  );
  // Discard changes: that panel closes, then the run continues after the dialog has cleared its state.
  assert.equal(closer.state.timers.length, 0);
  closer.answer("discard");
  assert.deepEqual(closer.state.order, ["d", "seat:local:s1", "sh1", "c"]);
  assert.equal(closer.state.timers.length, 1, "the rest is deferred one tick");
  assert.deepEqual(closer.state.buffersCleared.slice(-1), ["c"]);
  closer.flush();
  assert.deepEqual(closer.state.order, ["d", "seat:local:s1", "sh1", "c", "a"]);
  assert.equal(closer.state.pending, null);
  assert.deepEqual(
    closer.open().sort(),
    ["b", "x", "y"],
    "the clicked tab and the other group stay",
  );
  // Reopen: files and the seat were remembered by the real rememberClosed; the shell was not.
  const remembered = closer.state.closedPanels.current.map((e) => [
    e.kind,
    e.title,
  ]);
  assert.deepEqual(remembered, [
    ["file", "d"],
    ["seat", "s1"],
    ["file", "c"],
    ["file", "a"],
  ]);
});

test("panel-close-targets run: a panel with unsaved edits asks one at a time with its own name, Cancel stops the run, Save closes it and goes on, a missing panel is skipped, and a clean run needs no prompt", () => {
  // Three dirty files and two clean ones.
  const ids = ["a", "b", "c", "d", "e"];
  const run = closeHarness(
    ids.map((id) => file(id)),
    { dirty: ["b", "d"] },
  );
  run.closePanels(["e", "d", "c", "b", "a"]);
  assert.deepEqual(run.state.order, ["e"], "e closes, d asks");
  assert.equal(run.state.pending.tabId, "d");
  assert.equal(
    run.state.pending.description,
    "d has unsaved edits. Save them before closing, or discard them. 3 more panels will close after it.",
  );
  run.answer("save");
  assert.deepEqual(run.state.order, ["e", "d"]);
  run.flush();
  assert.deepEqual(run.state.order, ["e", "d", "c"]);
  assert.equal(run.state.pending.tabId, "b", "the next one asks");
  assert.equal(
    run.state.pending.description,
    "b has unsaved edits. Save them before closing, or discard them. 1 more panel will close after it.",
  );
  // Cancel: the dialog just clears its state; nothing else happens and the rest stays open.
  run.state.pending = null;
  run.flush();
  assert.deepEqual(run.open().sort(), ["a", "b"]);
  assert.deepEqual(run.state.order, ["e", "d", "c"]);
  assert.equal(run.state.timers.length, 0);
  // Unsaved edits are never discarded without an answer.
  assert.ok(run.state.dirtyTabs.current.has("b"));
  assert.equal(run.state.buffersCleared.includes("b"), false);

  // A missing panel is skipped; a clean run closes in the order it is given with no prompt and no timer.
  const clean = closeHarness(ids.map((id) => file(id)));
  clean.closePanels(["gone", "c", "a"]);
  assert.deepEqual(clean.state.order, ["c", "a"]);
  assert.equal(clean.state.pending, null);
  assert.equal(clean.state.timers.length, 0);
  assert.deepEqual(clean.open().sort(), ["b", "d", "e"]);
  clean.closePanels([]);
  assert.deepEqual(clean.state.order, ["c", "a"]);

  // The closed stack keeps only the newest 10 (MAX_CLOSED_PANELS) however many close.
  const many = Array.from({ length: 14 }, (_, i) => file("f" + i));
  const bounded = closeHarness(many);
  bounded.closePanels(many.map((t) => t.id));
  assert.equal(bounded.state.closedPanels.current.length, 10);
  assert.equal(closed.MAX_CLOSED_PANELS, 10);
  assert.deepEqual(
    bounded.state.closedPanels.current.map((e) => e.title),
    many.slice(4).map((t) => t.id),
    "the last 10 closed, oldest first",
  );
  assert.deepEqual(bounded.open(), []);
  // A rig-control terminal and a plain shell close but are not remembered.
  const sh = shell("sh9");
  const rig = new FakeTab("rig1", {
    component: "terminal",
    config: {
      connection: { id: "local" },
      root: "/p",
      terminalId: "rig1",
      rigControlToken: "t",
    },
  });
  const odd = closeHarness([sh, rig, file("z")]);
  odd.closePanels(["sh9", "rig1", "z"]);
  assert.deepEqual(odd.state.terminalsClosed, ["sh9", "rig1"]);
  assert.deepEqual(
    odd.state.closedPanels.current.map((e) => e.title),
    ["z"],
  );
});

test("panel-close-targets targets: closeOthers and closeRight work on the clicked tab's group in strip order, skip locked, repeated and unknown ids, and never change their input", () => {
  const { closeOthers, closeRight } = close;
  const strip = ["a", "b", "c", "d", "e"];
  assert.deepEqual(closeOthers(strip, "c"), ["a", "b", "d", "e"]);
  assert.deepEqual(closeOthers(strip, "a"), ["b", "c", "d", "e"]);
  assert.deepEqual(closeOthers(strip, "e"), ["a", "b", "c", "d"]);
  assert.deepEqual(closeRight(strip, "a"), ["b", "c", "d", "e"]);
  assert.deepEqual(closeRight(strip, "c"), ["d", "e"]);
  assert.deepEqual(closeRight(strip, "e"), []);
  assert.deepEqual(closeOthers(["a"], "a"), []);
  assert.deepEqual(closeRight(["a"], "a"), []);
  assert.deepEqual(
    closeOthers(strip, "zzz"),
    [],
    "an unknown id closes nothing",
  );
  assert.deepEqual(closeRight(strip, "zzz"), []);
  assert.deepEqual(closeOthers([], "a"), []);
  assert.deepEqual(
    closeOthers(strip, "c", ["b", "e"]),
    ["a", "d"],
    "locked tabs are never targets",
  );
  assert.deepEqual(closeRight(strip, "b", ["c", "zzz"]), ["d", "e"]);
  assert.deepEqual(
    closeOthers(strip, "c", ["c"]),
    ["a", "b", "d", "e"],
    "the clicked tab is never a target either way",
  );
  assert.deepEqual(
    closeOthers(["a", "b", "a", "c"], "b"),
    ["a", "c"],
    "a repeated id counts once",
  );
  assert.deepEqual(closeRight(["a", "b", "a", "c"], "a"), ["b", "c"]);
  assert.deepEqual(
    closeOthers(["a", "", 7, null, "b"], "a"),
    ["b"],
    "junk entries are dropped",
  );
  assert.deepEqual(closeRight(["a", "", 7, null, "b"], "a"), ["b"]);
  assert.deepEqual(closeOthers(strip, ""), []);
  assert.deepEqual(closeOthers(strip, null), []);
  const frozen = Object.freeze([...strip]);
  const locked = Object.freeze(["b"]);
  assert.deepEqual(closeOthers(frozen, "c", locked), ["a", "d", "e"]);
  assert.deepEqual(strip, ["a", "b", "c", "d", "e"]);
  const next = seeded(5);
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  for (let run = 0; run < 500; run++) {
    const list = [];
    for (const n of names) if (next() < 0.8) list.push(n);
    if (next() < 0.3 && list.length) list.push(list[0]);
    const locks = names.filter(() => next() < 0.25);
    const id = next() < 0.1 ? "zz" : names[Math.floor(next() * names.length)];
    const unique = [...new Set(list)];
    const at = unique.indexOf(id);
    const others =
      at === -1 ? [] : unique.filter((x) => x !== id && !locks.includes(x));
    const right =
      at === -1 ? [] : unique.slice(at + 1).filter((x) => !locks.includes(x));
    assert.deepEqual(closeOthers(list, id, locks), others);
    assert.deepEqual(closeRight(list, id, locks), right);
    assert.ok(!others.includes(id) && !right.includes(id));
    assert.ok(right.every((x) => others.includes(x)));
  }
});

test("panel-close-targets plan: panelKind sorts panels, planClose counts what closes and decides the confirmation, the order is right to left, and the text says what ends and what only detaches", () => {
  const { panelKind, planClose, dirtyPrompt } = close;
  assert.equal(panelKind("editor", {}), "file");
  assert.equal(panelKind("diff", null), "file");
  assert.equal(panelKind("terminal", { seat: { id: "s" } }), "seat");
  assert.equal(
    panelKind("terminal", { seat: { id: "s" }, rigControlToken: "t" }),
    "shell",
  );
  assert.equal(panelKind("terminal", { terminalId: "x" }), "shell");
  assert.equal(panelKind("terminal", undefined), "shell");
  assert.equal(panelKind("terminal", "text"), "shell");
  assert.equal(panelKind("settings", {}), "other");
  assert.equal(panelKind(undefined, undefined), "other");
  assert.equal(panelKind(7, {}), "other");

  const group = [
    info("a"),
    info("b"),
    info("c", "shell"),
    info("d", "seat"),
    info("e", "other"),
  ];
  const others = planClose(group, "others", "b");
  assert.deepEqual(others.order, ["e", "d", "c", "a"], "right to left");
  assert.deepEqual(
    [
      others.panels,
      others.files,
      others.seats,
      others.shells,
      others.others,
      others.dirty,
    ],
    [4, 1, 1, 1, 1, 0],
  );
  assert.equal(others.confirm, true);
  assert.equal(others.title, "Close 4 panels?");
  assert.equal(
    others.description,
    "This closes 4 panels: 1 file, 1 shell, 1 seat panel and 1 other panel. Closing a shell ends it and anything running in it. A seat panel only detaches: the seat's session keeps running. Files and seat panels can be brought back with Reopen closed panel.",
  );
  const right = planClose(group, "right", "b");
  assert.deepEqual(right.order, ["e", "d", "c"]);
  assert.equal(right.title, "Close 3 panels?");
  const self = planClose(group, "self", "c");
  assert.deepEqual(self.order, ["c"]);
  assert.equal(self.confirm, true, "any terminal asks");
  assert.equal(self.title, "Close 1 panel?");
  assert.equal(
    self.description,
    "This closes 1 panel: 1 shell. Closing a shell ends it and anything running in it. Files and seat panels can be brought back with Reopen closed panel.",
  );

  // The confirmation rule: more than one panel or any terminal.
  const files = [info("a"), info("b"), info("c")];
  assert.equal(planClose(files, "self", "a").confirm, false);
  assert.equal(planClose(files, "right", "b").confirm, false, "one file");
  assert.equal(planClose(files, "right", "a").confirm, true, "two files");
  assert.equal(planClose(files, "others", "a").confirm, true);
  assert.equal(
    planClose([info("a"), info("b", "other")], "others", "a").confirm,
    false,
  );
  assert.equal(
    planClose([info("a"), info("b", "seat")], "others", "a").confirm,
    true,
  );
  assert.equal(planClose([info("a", "shell")], "self", "a").confirm, true);

  // Nothing to close: an empty plan, no confirmation.
  for (const empty of [
    planClose([info("a")], "others", "a"),
    planClose(files, "right", "c"),
    planClose(files, "others", "zzz"),
    planClose([], "self", "a"),
    planClose([info("a", "file", { locked: true })], "self", "a"),
  ]) {
    assert.deepEqual(empty.order, []);
    assert.equal(empty.confirm, false);
    assert.equal(empty.panels, 0);
  }
  // Locked panels are never counted.
  const locked = planClose(
    [info("a"), info("b", "shell", { locked: true }), info("c")],
    "others",
    "a",
  );
  assert.deepEqual(locked.order, ["c"]);
  assert.equal(locked.shells, 0);
  // Unsaved edits are counted and promised a prompt; the 10 limit is said when it applies.
  const dirty = planClose(
    [
      info("a"),
      info("b", "file", { dirty: true }),
      info("c", "file", { dirty: true }),
    ],
    "others",
    "a",
  );
  assert.equal(dirty.dirty, 2);
  assert.equal(
    dirty.description,
    "This closes 2 panels: 2 files. 2 panels have unsaved edits and will ask before closing. Files and seat panels can be brought back with Reopen closed panel.",
  );
  const lots = Array.from({ length: 13 }, (_, i) => info("p" + i));
  const big = planClose(lots, "others", "p0");
  assert.equal(big.panels, 12);
  assert.equal(
    big.description,
    "This closes 12 panels: 12 files. Reopen closed panel brings back only the last 10 closed files and seats.",
  );
  assert.equal(
    planClose(lots.slice(0, 11), "others", "p0").description.includes(
      "only the last 10",
    ),
    false,
    "10 can all come back",
  );
  assert.equal(
    planClose(lots.slice(0, 12), "others", "p0").description.includes(
      "only the last 10",
    ),
    true,
    "11 cannot",
  );
  // Never mutates its input.
  const frozen = Object.freeze(group.map((p) => Object.freeze({ ...p })));
  assert.deepEqual(planClose(frozen, "others", "a").order, [
    "e",
    "d",
    "c",
    "b",
  ]);

  assert.equal(
    dirtyPrompt("notes.md", 0),
    "notes.md has unsaved edits. Save them before closing, or discard them.",
  );
  assert.equal(
    dirtyPrompt("notes.md", 1),
    "notes.md has unsaved edits. Save them before closing, or discard them. 1 more panel will close after it.",
  );
  assert.equal(
    dirtyPrompt("notes.md", 4),
    "notes.md has unsaved edits. Save them before closing, or discard them. 4 more panels will close after it.",
  );
  assert.equal(
    dirtyPrompt("", 0),
    "This panel has unsaved edits. Save them before closing, or discard them.",
  );
  assert.equal(
    dirtyPrompt(undefined, 2),
    "This panel has unsaved edits. Save them before closing, or discard them. 2 more panels will close after it.",
  );

  // A seeded walk: every id in a plan is a real, unlocked panel of the group other than the clicked one.
  const next = seeded(21);
  const kinds = ["file", "seat", "shell", "other"];
  for (let run = 0; run < 400; run++) {
    const panels = [];
    for (let i = 0; i < 1 + Math.floor(next() * 8); i++)
      panels.push(
        info("p" + i, kinds[Math.floor(next() * 4)], {
          dirty: next() < 0.3,
          locked: next() < 0.2,
        }),
      );
    const id = panels[Math.floor(next() * panels.length)].id;
    for (const scope of ["others", "right", "self"]) {
      const plan = planClose(panels, scope, id);
      const byId = new Map(panels.map((p) => [p.id, p]));
      for (const target of plan.order) {
        assert.ok(byId.has(target) && !byId.get(target).locked);
        assert.equal(target === id, scope === "self");
      }
      assert.equal(plan.panels, plan.order.length);
      assert.equal(
        plan.files + plan.seats + plan.shells + plan.others,
        plan.panels,
      );
      assert.equal(
        plan.confirm,
        plan.order.length > 1 || plan.shells + plan.seats > 0,
      );
    }
  }
});

test("panel-close-targets menu: the real menu lists Close, Close others and Close to the right, disables what has nothing to close, clamps to the window, dismisses on Escape, a click elsewhere or blur, and only asks or closes through onClosePanels", () => {
  const group = [info("a"), info("b"), info("c")];
  const menu = { x: 400, y: 300, id: "b", panels: group };
  const h = menuHarness(menu);
  assert.deepEqual(h.items(), [
    { label: "Close", disabled: false },
    { label: "Close others", disabled: false },
    { label: "Close to the right", disabled: false },
  ]);
  const node = h.menuNode();
  assert.equal(node.props.className, "dropdown terminal-context-menu");
  assert.deepEqual(node.props.style, { left: 400, top: 300 });
  // The same look as the terminal's menu, kept inside the window.
  const corner = menuHarness({ ...menu, x: 990, y: 790 });
  assert.deepEqual(corner.menuNode().props.style, { left: 820, top: 670 });
  corner.unmount();
  // Nothing to close: disabled.
  const last = menuHarness({ ...menu, id: "c" });
  assert.deepEqual(
    last.items().map((i) => i.disabled),
    [false, false, true],
  );
  last.unmount();
  const lone = menuHarness({ ...menu, id: "a", panels: [info("a")] });
  assert.deepEqual(
    lone.items().map((i) => i.disabled),
    [false, true, true],
  );
  lone.unmount();
  const pinned = menuHarness({
    ...menu,
    id: "a",
    panels: [info("a", "file", { locked: true }), info("b")],
  });
  assert.deepEqual(
    pinned.items().map((i) => i.disabled),
    [true, false, false],
  );
  pinned.unmount();
  // A closed menu shows nothing but a pending confirmation.
  h.setMenu(null);
  assert.equal(h.menuNode(), undefined);
  assert.equal(h.modal(), undefined);
  h.setMenu(menu);
  // Dismissal: Escape, a mouse press elsewhere, losing the window.
  const types = h.listeners.map((l) => l.type).sort();
  assert.deepEqual(types, ["blur", "keydown", "mousedown"]);
  const fire = (type, event = {}) =>
    h.listeners.filter((l) => l.type === type).forEach((l) => l.fn(event));
  fire("keydown", { key: "Enter" });
  assert.equal(h.calls.dismissed, 0, "only Escape");
  fire("keydown", { key: "Escape" });
  fire("mousedown");
  fire("blur");
  assert.equal(h.calls.dismissed, 3);
  // A press on the menu itself is not an outside press.
  let stopped = 0;
  node.props.onMouseDown({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 1);
  // Closing the menu removes the window listeners.
  h.setMenu(null);
  assert.equal(h.listeners.length, 0);
  h.unmount();

  // A single file closes straight away: no confirmation.
  const direct = menuHarness(menu);
  direct.click("Close");
  assert.equal(direct.calls.dismissed, 1);
  assert.deepEqual(direct.calls.closed, [["b"]]);
  assert.equal(direct.modal(), undefined);
  direct.click("Close to the right");
  assert.deepEqual(
    direct.calls.closed[1],
    ["c"],
    "one file to the right closes without asking",
  );
  direct.unmount();
  // Two files ask; Cancel and the dialog's own close do not close anything; Close does, once.
  const ask = menuHarness(menu);
  ask.click("Close others");
  ask.setMenu(null);
  assert.equal(ask.modal().props.title, "Close 2 panels?");
  assert.equal(ask.button("Close 2 panels").props.className, "primary-button");
  assert.equal(ask.button("Cancel").props.className, "secondary-button");
  ask.modal().props.onClose();
  assert.equal(ask.modal(), undefined);
  assert.deepEqual(ask.calls.closed, []);
  ask.setMenu(menu);
  ask.click("Close others");
  ask.setMenu(null);
  ask.click("Close 2 panels");
  assert.deepEqual(ask.calls.closed, [["c", "a"]]);
  assert.equal(ask.modal(), undefined);
  ask.unmount();
  // A disabled item does nothing even when its handler is called.
  const edge = menuHarness({ ...menu, id: "c" });
  edge.click("Close to the right");
  assert.deepEqual(edge.calls.closed, []);
  assert.equal(edge.modal(), undefined);
  edge.unmount();
});

test("panel-close-targets wiring: two pure modules, one Layout hook that only opens the menu, one menu in App, every close through closeTab, and no new close route", () => {
  const code = stripComments(read("src/panel-close-targets.ts"));
  assert.ok(
    /^[\x20-\x7e\n]*$/.test(read("src/panel-close-targets.ts")),
    "ASCII only",
  );
  assert.deepEqual(
    code.match(/^import .*$/gm),
    ['import { MAX_CLOSED_PANELS } from "./closed-panels";'],
    "the module imports only the closed-panels limit",
  );
  for (const forbidden of [
    /\bwindow\b/,
    /\bdocument\b/,
    /\bhrig\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\bfetch\(/,
    /setTimeout|setInterval|Date\.now|Math\.random/,
    /writeTerminal|createTerminal|closeTerminal|sendTerminalCommand/,
    /deleteTab|DELETE_TAB|Actions\.|rememberClosed/,
    /closeAll/,
    /export default/,
    /console\./,
    /from "react"/,
  ])
    assert.ok(!forbidden.test(code), "the module must stay pure: " + forbidden);
  assert.deepEqual(Object.keys(close).sort(), [
    "closeOthers",
    "closeRight",
    "dirtyPrompt",
    "panelKind",
    "planClose",
  ]);
  const view = stripComments(read("src/PanelContextMenu.tsx"));
  assert.ok(
    /^[\x20-\x7e\n]*$/.test(read("src/PanelContextMenu.tsx")),
    "ASCII only",
  );
  assert.deepEqual(view.match(/from "[^"]+";/g), [
    'from "react";',
    'from "./components";',
    'from "./panel-close-targets";',
  ]);
  for (const forbidden of [
    /deleteTab|DELETE_TAB|Actions\./,
    /closeTerminal|writeTerminal|window\.hrig/,
    /localStorage|sessionStorage/,
    /console\./,
    /closeAll/,
    /export default function PanelContextMenu\(\{[^}]*onContextMenu/,
  ])
    assert.ok(!forbidden.test(view), "the menu only chooses: " + forbidden);

  const app = tight(stripComments(appText()));
  const has = (text, part) => text.includes(tight(part));
  assert.equal(
    count(
      app,
      'import PanelContextMenu, { type PanelMenu } from "./PanelContextMenu";',
    ),
    1,
  );
  assert.equal(
    count(
      app,
      'import { dirtyPrompt, panelKind } from "./panel-close-targets";',
    ),
    1,
  );
  assert.equal(
    count(
      app,
      "const [tabMenu, setTabMenu] = useState<PanelMenu | null>(null);",
    ),
    1,
  );
  assert.equal(count(app, "<PanelContextMenu "), 1);
  assert.ok(
    has(
      app,
      "<PanelContextMenu menu={tabMenu} onDismiss={() => setTabMenu(null)} onClosePanels={closePanels} />",
    ),
  );
  assert.equal(count(app, "onContextMenu="), 1);
  assert.equal(
    count(app, "closePanels("),
    1,
    "only the deferred continuation calls it",
  );
  assert.equal(count(app, "closePanels}"), 1);
  const hook = tight(
    stripComments(
      between(appText(), "onContextMenu={(node, event) => {", "realtimeResize"),
    ),
  );
  for (const forbidden of [
    "closeTab",
    "closePanels",
    "setPending",
    "Actions.",
    "closeTerminal",
    "rememberClosed",
    "window.hrig",
  ])
    assert.ok(
      !hook.includes(forbidden),
      "the Layout hook only opens the menu: " + forbidden,
    );
  assert.ok(has(hook, "if (!(node instanceof TabNode)) return;"));
  assert.ok(
    has(hook, "if (event.currentTarget.ownerDocument !== document) return;"),
  );
  assert.ok(has(hook, "if (!(group instanceof TabSetNode)) return;"));
  assert.ok(has(hook, "locked: tab.isPinned() || !tab.isCloseable() })"));
  assert.ok(has(hook, "dirty: dirtyTabs.current.has(tab.getId()),"));
  const run = tight(
    stripComments(
      between(
        appText(),
        "const closePanels = (ids: string[]) => {",
        "const onAction = (action: Action) => {",
      ),
    ),
  );
  assert.equal(
    count(run, "closeTab("),
    2,
    "the prompt's run and the clean close",
  );
  assert.equal(count(run, "setTimeout("), 1);
  assert.ok(has(run, "tabId: id,"));
  assert.ok(has(run, 'title: "Save your changes?",'));
  for (const forbidden of [
    "Actions.",
    "clearBuffer",
    "dirtyTabs.current.delete",
    "closeTerminal",
    "rememberClosed",
    "window.hrig",
  ])
    assert.ok(
      !run.includes(forbidden),
      "closePanels only calls closeTab: " + forbidden,
    );

  // A seat panel only detaches: it runs tmux attach-session for an existing session, closing a terminal kills the local client process, and no electron file kills a session.
  const core = read("electron/core.cjs");
  assert.ok(
    core.includes(
      'return `exec tmux attach-session -t ${quote("=" + session)}`;',
    ),
  );
  const main = read("electron/main.cjs");
  assert.ok(
    tight(main).includes(
      tight(
        'handle("terminal:close", (_event, id) => { const item = terminals.get(id); if (item) { item.terminal.kill(); void terminalLogs.forget(id); terminals.delete(id); } });',
      ),
    ),
    "closing a terminal kills only the local client process it started",
  );
  for (const name of fs.readdirSync(path.join(root, "electron")))
    if (name.endsWith(".cjs") || name.endsWith(".mjs"))
      assert.ok(
        !/kill-session|kill-server/.test(read("electron/" + name)),
        name + " never kills a tmux session",
      );

  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort();
  const using = (needle) =>
    files.filter((name) => stripComments(read("src/" + name)).includes(needle));
  assert.deepEqual(using("onContextMenu="), ["App.tsx"]);
  assert.deepEqual(using("./panel-close-targets"), [
    "App.tsx",
    "PanelContextMenu.tsx",
  ]);
  assert.deepEqual(using("./PanelContextMenu"), ["App.tsx"]);
  assert.deepEqual(using("closeAll"), []);
  assert.deepEqual(using("Actions.group("), []);
});

test("panel-close-targets docs: NAVIGATION.md says what the tab menu does, that it works inside the clicked tab's group, that unsaved edits and terminals are asked about, and what Reopen keeps", () => {
  const text = read("NAVIGATION.md");
  const paragraphs = text.split("\n\n");
  const mine = paragraphs.filter((p) =>
    p.startsWith("Right-click a panel's tab"),
  );
  assert.equal(mine.length, 1, "one paragraph");
  const at = paragraphs.indexOf(mine[0]);
  assert.ok(
    paragraphs[at - 1].startsWith(
      "Ctrl+Tab switches panels in most recently used order",
    ),
    "directly after the Ctrl+Tab paragraph",
  );
  assert.ok(
    paragraphs[at + 1].startsWith("Project path spelling remains stable"),
    "and before the next paragraph",
  );
  const p = collapse(mine[0]);
  assert.ok(/^[\x20-\x7e]*$/.test(mine[0]), "ASCII only");
  for (const fragment of [
    "Right-click a panel's tab for Close, Close others and Close to the right",
    "only the panels in that tab's own group",
    "Close to the right closes the tabs after it",
    "pinned tabs are skipped",
    "closes the panels from right to left",
    "More than one panel, or any terminal, asks first and says how many close",
    "closing a shell ends it and what runs in it",
    "a seat panel only detaches and the seat's session keeps running",
    "A panel with unsaved edits asks before it closes, one at a time, with the same Save, Discard and Cancel choices as its tab button",
    "Cancel stops the run and leaves the rest open",
    "Nothing is discarded without an answer",
    "Every panel closes the way its tab button closes it",
    "Reopen closed panel brings back files, diffs and seat panels",
    "only the last 10 closed are kept",
    "Shells are not remembered",
    "no keyboard shortcut",
    "nothing is typed or sent",
  ])
    assert.ok(p.includes(fragment), "missing: " + fragment);
  assert.ok(!/future|later|for now|v1/i.test(p));
});

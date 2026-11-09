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
const char = (code) => String.fromCodePoint(code);
function isAscii(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 126 || (c < 32 && c !== 10)) return false;
  }
  return true;
}

function bundle(options) {
  const built = buildSync({
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
    ...options,
  });
  const mod = new Module("undo-toast-test", module);
  mod._compile(built.outputFiles[0].text, "undo-toast-test");
  return mod.exports;
}
const lib = bundle({ entryPoints: [path.join(root, "src/undo-toast.ts")] });
// The real layout code and the real flexlayout model in one bundle, so Model,
// Actions and the arrangement helpers share one instance.
const real = bundle({
  stdin: {
    contents:
      'export * from "./src/layout.ts"; export { Actions, DockLocation, Model, TabNode } from "flexlayout-react";',
    resolveDir: root,
    sourcefile: "undo-toast-entry.ts",
    loader: "ts",
  },
});
const { Actions, DockLocation, Model, TabNode, arrangement } = real;

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
// The real text of src/App.tsx: each piece below is cut out of the file,
// compiled and run over fakes, so what the test sees is what the application
// does. The model is the real flexlayout model; React is a small stand-in that
// keeps the stale-closure rule (a handler sees the values of the render it
// belongs to) and runs an effect only when its dependencies changed.

function cut(from, to) {
  const app = read("src/App.tsx");
  const start = app.indexOf(from);
  assert.ok(start >= 0, "found in App.tsx: " + from);
  assert.equal(app.indexOf(from, start + 1), -1, "exactly one: " + from);
  const end = app.indexOf(to, start + from.length);
  assert.ok(end > start, "ends at: " + to);
  return app.slice(start, end);
}
function compile(text, names, results) {
  const js = transformSync(text, { loader: "ts" }).code;
  return new Function(
    ...names,
    js + "\nreturn { " + results.join(", ") + " };",
  );
}

const HOOKS_TEXT = cut(
  "const undoOffered = ",
  "useEffect(() => onTerminalDropped(",
);
const HISTORY_TEXT = cut(
  "const remember = () => {",
  "const refreshAll = () => {",
);
const ARRANGE_TEXT = cut(
  "const applyPreset = (preset: string) => {",
  "// Keeps only the kind and identifiers needed to reopen",
);
const TOAST_TEXT = cut("{toast && (", '{modal === "connect" && (');
// The role template handler is a function inside the arranger element.
const ROLE_TEXT = cut("onApplyTemplate={(template) => {", "onDeleteTemplate=")
  .trim()
  .replace(/^onApplyTemplate=\{/, "const applyTemplate = ")
  .replace(/\}$/, "");

const makeHooks = compile(
  HOOKS_TEXT,
  [
    "toast",
    "toastUndo",
    "toastHover",
    "setToast",
    "setToastUndo",
    "setToastHover",
    "log",
    "useCallback",
    "useEffect",
    "history",
    "modelRef",
    "revision",
    "toastDelay",
    "offerValid",
    "setTimeout",
    "clearTimeout",
  ],
  ["undoOffered", "notify"],
);
const makeHistory = compile(
  HISTORY_TEXT,
  [
    "model",
    "history",
    "setModel",
    "modelChanged",
    "Model",
    "notify",
    "setToast",
    "setToastUndo",
    "toastUndo",
    "offerFor",
    "markOffer",
    "offerValid",
  ],
  ["remember", "travel", "announceLayout", "undoFromToast"],
);
const makeArrange = compile(
  ARRANGE_TEXT,
  [
    "remember",
    "allTabs",
    "arrangement",
    "setModel",
    "modelChanged",
    "setMenu",
    "announceLayout",
    "notify",
    "seats",
    "connection",
    "root",
  ],
  ["applyPreset", "openAll"],
);
const makeRole = compile(
  ROLE_TEXT,
  [
    "state",
    "notify",
    "protect",
    "remember",
    "restoreModel",
    "instantiateRoles",
    "connection",
    "root",
    "seats",
    "setModel",
    "modelChanged",
    "announceLayout",
  ],
  ["applyTemplate"],
);
const makeToast = (() => {
  const source =
    "export default function Toast({ toast, setToast, setToastHover, undoOffered, undoFromToast, UNDO_LABEL, Check, X }) { return (<section>" +
    TOAST_TEXT +
    "</section>); }";
  const out = transformSync(source, {
    loader: "tsx",
    jsx: "automatic",
    format: "cjs",
  }).code;
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(
    (id) => {
      if (id === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      throw new Error("unexpected import in the toast: " + id);
    },
    mod,
    mod.exports,
  );
  return mod.exports.default;
})();

function allNodes(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => allNodes(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    allNodes(node.props && node.props.children, out);
  }
  return out;
}
function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object")
    return textOf(node.props && node.props.children);
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : "";
}

function tabJson(id, index) {
  return {
    type: "tab",
    id,
    name: id,
    component: index === 0 ? "editor" : "terminal",
    config: { terminalId: id },
  };
}

// One application in a box. setX applies at once but every closure keeps the
// values it was built with until the next render, as in React.
function world(options = {}) {
  const ids = options.tabs || ["a", "b", "c", "d"];
  const s = {
    model: arrangement(
      options.tabJsons || ids.map(tabJson),
      options.start || "Focus",
    ),
    toast: "",
    toastUndo: null,
    toastHover: false,
    revision: 0,
    menu: "open",
    history: { current: { past: [], future: [] } },
    events: [],
    timers: [],
    now: 0,
    dirty: false,
    queue: [],
    slots: [],
    api: null,
    seats: options.seats || [],
    activeRig: options.activeRig === undefined ? "rig1" : options.activeRig,
    // protect() runs a replacement at once, or keeps it while edits are unsaved.
    hold: false,
    asked: [],
    renders: 0,
  };
  const setters = {
    setToast: (v) => {
      if (s.toast !== v) {
        s.toast = v;
        s.dirty = true;
      }
    },
    setToastUndo: (v) => {
      if (s.toastUndo !== v) {
        s.toastUndo = v;
        s.dirty = true;
      }
    },
    setToastHover: (v) => {
      if (s.toastHover !== v) {
        s.toastHover = v;
        s.dirty = true;
      }
    },
    setModel: (m) => {
      if (s.model !== m) {
        s.model = m;
        s.dirty = true;
      }
    },
    setMenu: (v) => {
      s.menu = v;
    },
    modelChanged: () => {
      s.revision += 1;
      s.dirty = true;
    },
  };
  const timers = {
    setTimeout: (fn, ms) => {
      const timer = { id: s.timers.length + 1, ms, at: s.now + ms, fn };
      s.timers.push(timer);
      return timer.id;
    },
    clearTimeout: (id) => {
      const timer = s.timers.find((t) => t.id === id);
      if (timer) timer.cleared = true;
    },
  };
  function instantiate() {
    const model = s.model;
    const modelRef = { current: model };
    const hooks = makeHooks(
      s.toast,
      s.toastUndo,
      s.toastHover,
      setters.setToast,
      setters.setToastUndo,
      setters.setToastHover,
      (text, kind) => s.events.push([text, kind]),
      (fn) => fn,
      (fn, deps) => s.queue.push({ fn, deps }),
      s.history,
      modelRef,
      s.revision,
      lib.toastDelay,
      lib.offerValid,
      timers.setTimeout,
      timers.clearTimeout,
    );
    const toastUndo = s.toastUndo;
    const tools = makeHistory(
      model,
      s.history,
      setters.setModel,
      setters.modelChanged,
      Model,
      hooks.notify,
      setters.setToast,
      setters.setToastUndo,
      toastUndo,
      lib.offerFor,
      lib.markOffer,
      lib.offerValid,
    );
    const allTabs = () => {
      const tabs = [];
      model.visitNodes((node) => {
        if (node instanceof TabNode) tabs.push(node.toJson());
      });
      return tabs;
    };
    const arrange = makeArrange(
      tools.remember,
      allTabs,
      arrangement,
      setters.setModel,
      setters.modelChanged,
      setters.setMenu,
      tools.announceLayout,
      hooks.notify,
      s.seats,
      { id: "local" },
      "/p",
    );
    const role = makeRole(
      { activeRig: s.activeRig },
      hooks.notify,
      (run) => {
        s.asked.push(run);
        if (!s.hold) run();
      },
      tools.remember,
      real.restoreModel,
      real.instantiateRoles,
      { id: "local" },
      "/p",
      s.seats,
      setters.setModel,
      setters.modelChanged,
      tools.announceLayout,
    );
    const tree = makeToast({
      toast: s.toast,
      setToast: setters.setToast,
      setToastHover: setters.setToastHover,
      undoOffered: hooks.undoOffered,
      undoFromToast: tools.undoFromToast,
      UNDO_LABEL: lib.UNDO_LABEL,
      Check: "Check",
      X: "X",
    });
    return { ...hooks, ...tools, ...arrange, ...role, allTabs, tree, model };
  }
  function runEffects() {
    const queue = s.queue;
    s.queue = [];
    queue.forEach((entry, i) => {
      const prev = s.slots[i];
      const changed =
        !prev ||
        prev.deps.length !== entry.deps.length ||
        entry.deps.some((d, k) => !Object.is(d, prev.deps[k]));
      if (!changed) return;
      if (prev && typeof prev.cleanup === "function") prev.cleanup();
      s.slots[i] = { deps: entry.deps, cleanup: entry.fn() };
    });
  }
  function render() {
    let guard = 0;
    do {
      s.dirty = false;
      s.queue = [];
      s.api = instantiate();
      s.renders += 1;
      runEffects();
      if (++guard > 25) throw new Error("the render does not settle");
    } while (s.dirty);
    return s.api;
  }
  const w = {
    s,
    set: setters,
    render,
    get api() {
      return s.api;
    },
    // A handler runs with the closures of the last render, then React renders.
    act(fn) {
      fn(s.api);
      render();
    },
    get model() {
      return s.model;
    },
    get history() {
      return s.history.current;
    },
    json: () => JSON.stringify(s.model.toJson()),
    shape: () => lib.layoutShape(s.model.toJson()),
    shown: () =>
      allNodes(s.api.tree).find((n) => n.props && n.props.role === "status"),
    undoButton: () =>
      allNodes(s.api.tree).find(
        (n) => n.type === "button" && textOf(n) === lib.UNDO_LABEL,
      ),
    closeButton: () =>
      allNodes(s.api.tree).find(
        (n) => n.type === "button" && allNodes(n).some((c) => c.type === "X"),
      ),
    pending: () => s.timers.filter((t) => !t.cleared && !t.fired),
    advance(ms) {
      const target = s.now + ms;
      for (;;) {
        const due = w
          .pending()
          .filter((t) => t.at <= target)
          .sort((x, y) => x.at - y.at || x.id - y.id)[0];
        if (!due) break;
        s.now = due.at;
        due.fired = true;
        due.fn();
        render();
      }
      s.now = target;
    },
    // What a person does to the layout without going through the arrange code.
    drag(id, target) {
      w.act((c) => {
        c.remember();
        s.model.doAction(Actions.moveNode(id, target, DockLocation.RIGHT, -1));
        setters.modelChanged();
      });
    },
    tabsets: () => {
      const out = [];
      s.model.visitNodes((n) => {
        if (n.getType() === "tabset") out.push(n.getId());
      });
      return out;
    },
  };
  render();
  return w;
}

test("undo-toast tracer: applying a preset in the real App code offers Undo, one click restores the earlier layout once through the real history, and the offer is withdrawn when anything else changed", () => {
  const w = world();
  const before = w.json();
  const beforeShape = w.shape();
  assert.equal(w.api.undoOffered, false);
  assert.equal(w.shown(), undefined, "no toast yet");

  // The entry point: the same applyPreset the menu, the palette and the arranger call.
  w.act((c) => c.applyPreset("Team"));
  assert.notEqual(w.shape(), beforeShape, "the layout really changed");
  assert.equal(
    w.s.toast,
    "Team arrangement applied",
    "the old text, unchanged",
  );
  assert.deepEqual(w.s.events, [["Team arrangement applied", "success"]]);
  assert.equal(w.history.past.length, 1);
  assert.equal(w.api.undoOffered, true);
  const button = w.undoButton();
  assert.ok(button, "the notice carries an Undo button");
  assert.equal(button.props.className, "small-button");
  assert.equal(typeof button.props.onClick, "function");
  assert.ok(w.closeButton(), "the close button is still there");
  assert.deepEqual(
    w.pending().map((t) => t.ms),
    [lib.UNDO_MS],
    "one timer, longer than a plain notice",
  );
  assert.ok(lib.UNDO_MS > lib.NOTICE_MS);

  // One click: back to exactly the earlier layout, through travel, once.
  w.act(() => button.props.onClick());
  assert.equal(w.json(), before, "the layout is exactly the earlier one");
  assert.equal(w.s.toast, "", "the notice is dismissed");
  assert.equal(w.s.toastUndo, null);
  assert.equal(w.shown(), undefined);
  assert.equal(w.history.past.length, 0);
  assert.equal(w.history.future.length, 1, "Redo is still available");
  assert.deepEqual(w.pending(), [], "no timer left");
  // A second click on the same button, from the same render, does nothing.
  w.act(() => button.props.onClick());
  assert.equal(w.json(), before);
  assert.equal(w.history.past.length, 0);
  assert.equal(w.history.future.length, 1);
  assert.deepEqual(
    w.s.events,
    [["Team arrangement applied", "success"]],
    "no extra notice",
  );

  // The button of an old render cannot undo something newer.
  const stale = world();
  stale.act((c) => c.applyPreset("Team"));
  const oldClick = stale.undoButton().props.onClick;
  const teamShape = stale.shape();
  stale.act((c) => c.applyPreset("Review"));
  assert.notEqual(stale.shape(), teamShape);
  assert.equal(stale.s.toast, "Review arrangement applied");
  stale.act(() => oldClick());
  assert.equal(stale.s.toast, "", "the old click only closes the notice");
  assert.equal(stale.history.past.length, 2, "and undoes nothing");
  assert.equal(stale.history.future.length, 0);

  // A newer offer undoes exactly one step: back to Team, not to the start.
  const steps = world();
  steps.act((c) => c.applyPreset("Team"));
  const teamLayout = steps.shape();
  steps.act((c) => c.applyPreset("Review"));
  steps.act(() => steps.undoButton().props.onClick());
  assert.equal(steps.shape(), teamLayout, "one step only");
  assert.equal(steps.history.past.length, 1);

  // Withdrawn: another drag, a panel opened or closed, an Undo from elsewhere.
  const drag = world();
  drag.act((c) => c.applyPreset("Team"));
  const dragClick = drag.undoButton().props.onClick;
  drag.drag("b", drag.tabsets().at(-1));
  assert.equal(drag.undoButton(), undefined, "a drag withdraws the offer");
  assert.equal(drag.s.toast, "Team arrangement applied", "the text stays");
  assert.equal(drag.s.toastUndo, null);
  const afterDrag = drag.json();
  drag.act(() => dragClick());
  assert.equal(
    drag.json(),
    afterDrag,
    "a click on the withdrawn button undoes nothing",
  );
  assert.equal(drag.history.past.length, 2);

  const opened = world();
  opened.act((c) => c.applyPreset("Team"));
  assert.ok(opened.undoButton());
  opened.act(() => {
    opened.model.doAction(
      Actions.addNode(
        tabJson("e", 1),
        opened.tabsets()[0],
        DockLocation.CENTER,
        -1,
      ),
    );
    opened.s.revision += 1;
    opened.s.dirty = true;
  });
  assert.equal(
    opened.undoButton(),
    undefined,
    "a panel opened later withdraws it",
  );

  const closed = world();
  closed.act((c) => c.applyPreset("Team"));
  closed.act(() => {
    closed.s.history.current = { past: [], future: [] };
    closed.model.doAction(Actions.deleteTab("c"));
    closed.s.revision += 1;
    closed.s.dirty = true;
  });
  assert.equal(
    closed.undoButton(),
    undefined,
    "closing a panel clears history and the offer",
  );

  const elsewhere = world();
  elsewhere.act((c) => c.applyPreset("Team"));
  const elseClick = elsewhere.undoButton().props.onClick;
  elsewhere.act((c) => c.travel("undo"));
  assert.equal(
    elsewhere.undoButton(),
    undefined,
    "Undo arrangement elsewhere withdraws it",
  );
  const undone = elsewhere.json();
  elsewhere.act(() => elseClick());
  assert.equal(elsewhere.json(), undone);
  assert.equal(elsewhere.history.future.length, 1);

  const renamedTab = world();
  renamedTab.act((c) => c.applyPreset("Team"));
  assert.ok(renamedTab.undoButton());
  renamedTab.act(() => {
    renamedTab.model.doAction(Actions.renameTab("c", "Build"));
    renamedTab.s.revision += 1;
    renamedTab.s.dirty = true;
  });
  assert.equal(
    renamedTab.undoButton(),
    undefined,
    "a renamed panel withdraws it: Undo would revert the title",
  );

  // Selecting a tab is not a change of the arrangement: the offer stays.
  const selected = world();
  selected.act((c) => c.applyPreset("Team"));
  selected.act(() => {
    selected.model.doAction(Actions.selectTab("c"));
    selected.s.revision += 1;
    selected.s.dirty = true;
  });
  assert.ok(selected.undoButton(), "selecting a tab keeps the offer");

  // Timing: the offer outlasts a plain notice and then goes with it.
  const timed = world();
  timed.act((c) => c.applyPreset("Team"));
  timed.advance(lib.UNDO_MS - 1);
  assert.ok(timed.undoButton(), "still offered one tick before the end");
  timed.advance(1);
  assert.equal(timed.s.toast, "");
  assert.equal(timed.s.toastUndo, null);
  assert.equal(timed.undoButton(), undefined);

  // Hover pauses a notice that has the button, and only that one.
  const hover = world();
  hover.act((c) => c.applyPreset("Team"));
  hover.advance(5000);
  hover.act(() => hover.shown().props.onMouseEnter());
  assert.deepEqual(hover.pending(), [], "resting on it stops the timer");
  hover.advance(600000);
  assert.ok(hover.undoButton(), "still there after any wait");
  hover.act(() => hover.shown().props.onMouseLeave());
  assert.deepEqual(
    hover.pending().map((t) => t.ms),
    [lib.UNDO_MS],
  );
  hover.advance(lib.UNDO_MS);
  assert.equal(hover.s.toast, "");
  assert.equal(
    hover.s.toastHover,
    false,
    "the hover flag is reset with the notice",
  );

  // A plain notice is what it always was: no button, 4.5 seconds, hover changes nothing.
  const plain = world();
  plain.act((c) => c.notify("Project opened"));
  assert.equal(plain.undoButton(), undefined);
  assert.deepEqual(
    plain.pending().map((t) => t.ms),
    [4500],
  );
  const plainTimer = plain.pending()[0];
  plain.act(() => plain.shown().props.onMouseEnter());
  plain.act(() => plain.shown().props.onMouseLeave());
  assert.deepEqual(
    plain.pending(),
    [plainTimer],
    "no pause and no new timer for a plain notice",
  );
  assert.equal(plain.s.timers.length, 1, "the one timer was never restarted");
  plain.advance(4500);
  assert.equal(plain.s.toast, "");
  assert.deepEqual(plain.s.events, [["Project opened", "success"]]);

  // Another notice replaces the offer, whether it comes through notify or setToast.
  const replaced = world();
  replaced.act((c) => c.applyPreset("Team"));
  replaced.act((c) => c.notify("Project opened"));
  assert.equal(replaced.undoButton(), undefined);
  assert.equal(replaced.s.toastUndo, null);
  const direct = world();
  direct.act((c) => c.applyPreset("Team"));
  direct.act(() => direct.set.setToast("Nothing to reopen"));
  assert.equal(
    direct.undoButton(),
    undefined,
    "a direct setToast text hides the button",
  );
  assert.equal(direct.s.toastUndo, null);
  assert.equal(direct.s.toast, "Nothing to reopen");

  // A preset that changes nothing gives the same notice and no button.
  const same = world();
  same.act((c) => c.applyPreset("Focus"));
  assert.equal(same.s.toast, "Focus arrangement applied");
  assert.equal(
    same.undoButton(),
    undefined,
    "nothing changed, nothing to undo",
  );
  assert.deepEqual(
    same.pending().map((t) => t.ms),
    [4500],
  );
  assert.deepEqual(same.s.events, [["Focus arrangement applied", "success"]]);
});

// ---------------------------------------------------------------------------
// The pure module.

const tab = (id) => ({ type: "tab", id, name: id, component: "terminal" });
const group = (ids, extra = {}) => ({
  type: "tabset",
  id: "#g-" + ids.join(""),
  children: ids.map(tab),
  ...extra,
});
const layoutOf = (...children) => ({
  global: { splitterSize: 5 },
  borders: [],
  layout: { type: "row", id: "#root", children },
  subLayouts: {},
});

test("undo-toast rules: the shape ignores sizes, selection and generated ids, the offer needs a known kind, a snapshot and a real change, the text is clean and capped, the mark and its check hold, and the timer rule is a table", () => {
  assert.deepEqual(Object.keys(lib).sort(), [
    "MAX_LABEL",
    "NOTICE_MS",
    "UNDO_LABEL",
    "UNDO_MS",
    "layoutShape",
    "markOffer",
    "offerFor",
    "offerValid",
    "toastDelay",
  ]);
  assert.equal(lib.UNDO_LABEL, "Undo");
  assert.equal(lib.NOTICE_MS, 4500);
  assert.equal(lib.UNDO_MS, 8000);
  assert.equal(lib.MAX_LABEL, 40);

  // layoutShape: only the placement of panels counts.
  const base = layoutOf(group(["a", "b"]), group(["c"]));
  const shape = lib.layoutShape(base);
  assert.equal(typeof shape, "string");
  assert.equal(shape, 'Lrow(tabset(["a","a"],["b","b"]),tabset(["c","c"]))');
  assert.equal(
    lib.layoutShape(
      layoutOf(
        group(["a", "b"], {
          id: "#other",
          weight: 70,
          selected: 1,
          active: true,
          maximized: true,
        }),
        group(["c"], { weight: 5 }),
      ),
    ),
    shape,
    "sizes, selection, focus, maximize and group ids are not structure",
  );
  // Titles are part of what Undo would put back, so a rename counts.
  const renamed = JSON.parse(JSON.stringify(base));
  renamed.layout.children[0].children[1].name = "Build";
  assert.notEqual(lib.layoutShape(renamed), shape, "a renamed panel");
  const named = JSON.parse(JSON.stringify(base));
  named.layout.children[1].name = "Review";
  assert.notEqual(lib.layoutShape(named), shape, "a named group");
  assert.notEqual(lib.layoutShape(named), lib.layoutShape(renamed));
  const blank = JSON.parse(JSON.stringify(base));
  blank.layout.children[1].name = "";
  assert.equal(lib.layoutShape(blank), shape, "an empty group name is no name");
  const odd = JSON.parse(JSON.stringify(base));
  odd.layout.children[1].name = 5;
  assert.equal(
    lib.layoutShape(odd),
    shape,
    "a name that is not text is no name",
  );
  const changed = [
    layoutOf(group(["b", "a"]), group(["c"])),
    layoutOf(group(["a"]), group(["b", "c"])),
    layoutOf(group(["a", "b", "c"])),
    layoutOf(group(["a", "b"]), group(["c"]), group(["d"])),
    layoutOf(group(["a", "b"])),
    layoutOf({ type: "row", children: [group(["a", "b"]), group(["c"])] }),
    layoutOf(group(["a", "b"]), group(["x"])),
  ];
  for (const other of changed)
    assert.notEqual(
      lib.layoutShape(other),
      shape,
      JSON.stringify(other.layout.children),
    );
  assert.equal(
    new Set(changed.map((c) => lib.layoutShape(c))).size,
    changed.length,
    "every change reads differently",
  );
  const withBorder = {
    ...base,
    borders: [{ type: "border", location: "left", children: [tab("p")] }],
  };
  assert.notEqual(
    lib.layoutShape(withBorder),
    shape,
    "a docked border panel counts",
  );
  assert.notEqual(
    lib.layoutShape({
      ...withBorder,
      borders: [{ ...withBorder.borders[0], location: "right" }],
    }),
    lib.layoutShape(withBorder),
  );
  const withWindow = {
    ...base,
    subLayouts: { w1: { layout: { type: "row", children: [group(["p"])] } } },
  };
  assert.notEqual(
    lib.layoutShape(withWindow),
    shape,
    "a panel in its own window counts",
  );
  assert.notEqual(
    lib.layoutShape({ ...base, subLayouts: { w2: withWindow.subLayouts.w1 } }),
    lib.layoutShape(withWindow),
  );
  assert.equal(
    lib.layoutShape({
      ...base,
      subLayouts: { b: withWindow.subLayouts.w1, a: withWindow.subLayouts.w1 },
    }),
    lib.layoutShape({
      ...base,
      subLayouts: { a: withWindow.subLayouts.w1, b: withWindow.subLayouts.w1 },
    }),
    "window order does not matter",
  );
  for (const junk of [
    undefined,
    null,
    0,
    1,
    "",
    "text",
    true,
    [],
    [base],
    () => 0,
    Symbol("x"),
    {},
    { layout: null },
    { layout: [] },
    { layout: "row" },
    { layout: { type: "row", children: [null] } },
  ])
    assert.equal(lib.layoutShape(junk), null, String(typeof junk));
  assert.equal(
    lib.layoutShape({ layout: { type: "row" } }),
    "Lrow()",
    "a row without children reads as empty",
  );
  assert.equal(
    lib.layoutShape({ layout: { type: "row", children: "x" } }),
    "Lrow()",
    "children that are not a list read as empty",
  );
  const proto = JSON.parse(
    '{"layout":{"type":"row","__proto__":{"x":1},"children":[]},"subLayouts":{"__proto__":{"layout":{"type":"row","children":[]}}}}',
  );
  assert.equal(
    typeof lib.layoutShape(proto),
    "string",
    "a parsed __proto__ key is just a key",
  );
  assert.equal(
    lib.layoutShape(Object.freeze(layoutOf(Object.freeze(group(["a"]))))),
    lib.layoutShape(layoutOf(group(["a"]))),
  );
  // Bounded: depth and node count, so a hostile or cyclic value cannot hang the page.
  const cyclic = { type: "row", children: [] };
  cyclic.children.push(cyclic);
  assert.equal(
    lib.layoutShape({ layout: cyclic }),
    null,
    "a cycle is cut by the depth bound",
  );
  let deep = { type: "tabset", children: [] };
  for (let i = 0; i < 32; i++) deep = { type: "row", children: [deep] };
  assert.equal(
    typeof lib.layoutShape({ layout: deep }),
    "string",
    "a panel group 32 levels down is read",
  );
  deep = { type: "row", children: [deep] };
  assert.equal(
    lib.layoutShape({ layout: deep }),
    null,
    "33 levels down is not",
  );
  const many = (n) =>
    layoutOf(...Array.from({ length: n }, (_, i) => group(["t" + i])));
  assert.equal(
    typeof lib.layoutShape(many(2000)),
    "string",
    "thousands of panels are read",
  );
  assert.equal(
    lib.layoutShape(many(2600)),
    null,
    "more than 5000 nodes are not",
  );
  const tabs = (n) =>
    layoutOf(group(Array.from({ length: n }, (_, i) => "t" + i)));
  assert.equal(
    typeof lib.layoutShape(tabs(4998)),
    "string",
    "exactly 5000 nodes are read",
  );
  assert.equal(lib.layoutShape(tabs(4999)), null, "one node more is not");
  assert.equal(
    lib.layoutShape({
      ...tabs(4998),
      borders: [{ type: "border", location: "left", children: [] }],
    }),
    null,
    "the borders share the same budget",
  );
  assert.equal(
    lib.layoutShape({
      ...tabs(4998),
      subLayouts: { w: { layout: { type: "row", children: [] } } },
    }),
    null,
    "and so do the separate windows",
  );

  // offerFor: kind, snapshot and a real change.
  const before = layoutOf(group(["a", "b", "c"]));
  const after = layoutOf(group(["a"]), group(["b"]), group(["c"]));
  const give = (extra) =>
    lib.offerFor({
      kind: "preset",
      label: "Team",
      pastLength: 1,
      before,
      after,
      ...extra,
    });
  assert.deepEqual(give(), { text: "Team arrangement applied", canUndo: true });
  assert.deepEqual(give({ kind: "sessions", label: "ignored" }), {
    text: "Rig sessions arranged",
    canUndo: true,
  });
  assert.deepEqual(give({ kind: "role", label: "Review pair" }), {
    text: "Role template applied: Review pair",
    canUndo: true,
  });
  assert.deepEqual(give({ kind: "role", label: "" }), {
    text: "Role template applied",
    canUndo: true,
  });
  assert.deepEqual(give({ label: "" }), {
    text: "Arrangement applied",
    canUndo: true,
  });
  assert.deepEqual(give({ label: undefined }), {
    text: "Arrangement applied",
    canUndo: true,
  });
  for (const kind of [
    "drag",
    "move",
    "rename",
    "maximize",
    "equal",
    "",
    " preset",
    "Preset",
    "PRESET",
    "__proto__",
    "toString",
    "constructor",
    null,
    undefined,
    1,
    true,
    {},
    [],
    ["preset"],
  ])
    assert.deepEqual(
      give({ kind }),
      { text: "Layout changed", canUndo: false },
      "kind " + String(kind),
    );
  assert.equal(give({ after: before }).canUndo, false, "no change, no offer");
  assert.equal(
    give({
      after: layoutOf(group(["a", "b", "c"], { weight: 9, selected: 2 })),
    }).canUndo,
    false,
    "only sizes changed",
  );
  for (const pastLength of [
    0,
    -1,
    NaN,
    undefined,
    null,
    "1",
    [],
    {},
    Infinity * 0,
  ])
    assert.equal(
      give({ pastLength }).canUndo,
      false,
      "pastLength " + String(pastLength),
    );
  for (const pastLength of [1, 2, 40, 1.5, Infinity])
    assert.equal(
      give({ pastLength }).canUndo,
      true,
      "pastLength " + pastLength,
    );
  for (const junk of [undefined, null, 0, "x", [], {}, { layout: 1 }])
    assert.equal(give({ before: junk }).canUndo, false, "unreadable before");
  for (const junk of [undefined, null, 0, "x", [], {}, { layout: 1 }])
    assert.equal(give({ after: junk }).canUndo, false, "unreadable after");
  assert.deepEqual(lib.offerFor({}), {
    text: "Layout changed",
    canUndo: false,
  });
  assert.deepEqual(lib.offerFor({ kind: "preset" }), {
    text: "Arrangement applied",
    canUndo: false,
  });

  // The text of a name: white space collapsed, hidden and direction characters removed, capped.
  const text = (label) => give({ label }).text;
  assert.equal(text("  Team \t\n  two  "), "Team two arrangement applied");
  for (const code of [
    0, 1, 8, 27, 127, 128, 159, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a,
    0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ])
    assert.equal(
      text("A" + char(code) + "B"),
      "AB arrangement applied",
      "hidden code " + code,
    );
  for (const code of [
    9, 10, 11, 12, 13, 32, 0xa0, 0x2003, 0x2028, 0x2029, 0x3000, 0xfeff,
  ])
    assert.equal(
      text("A" + char(code) + "B"),
      "A B arrangement applied",
      "space code " + code,
    );
  assert.equal(
    text(char(0xe9) + char(0x4e2d)),
    char(0xe9) + char(0x4e2d) + " arrangement applied",
    "ordinary letters stay",
  );
  assert.equal(
    text("<b>x</b>; {y}"),
    "<b>x</b>; {y} arrangement applied",
    "markup is only text; React shows it as text",
  );
  for (const junk of [1, null, undefined, {}, [], true, Symbol("x"), () => 0])
    assert.equal(text(junk), "Arrangement applied");
  assert.equal(
    text("x".repeat(40)),
    "x".repeat(40) + " arrangement applied",
    "40 characters fit",
  );
  assert.equal(
    text("x".repeat(41)),
    "x".repeat(37) + "... arrangement applied",
    "41 are cut to 37 and three dots",
  );
  assert.equal(
    text("x".repeat(5000)),
    "x".repeat(37) + "... arrangement applied",
  );
  assert.equal(
    text("ab" + " ".repeat(36) + "cd" + "e".repeat(10)),
    "ab " + "cd" + "e".repeat(10) + " arrangement applied",
    "white space collapses before the cap",
  );
  const astral = char(0x1f600);
  assert.equal(
    text(astral.repeat(40)),
    astral.repeat(40) + " arrangement applied",
  );
  assert.equal(
    text(astral.repeat(41)),
    astral.repeat(37) + "... arrangement applied",
    "no pair is split",
  );
  assert.equal(
    text("x".repeat(36) + " tail"),
    "x".repeat(36) + "... arrangement applied",
    "a space before the dots is dropped",
  );
  assert.equal(
    text(char(0x202e) + char(0x200b)),
    "Arrangement applied",
    "a name of only hidden characters is empty",
  );

  // markOffer and offerValid.
  const top = { snapshot: 1 };
  const other = { snapshot: 2 };
  const stack = { past: [other, top], future: [] };
  const mark = lib.markOffer(stack, after);
  assert.deepEqual(mark, { depth: 2, top, shape: lib.layoutShape(after) });
  assert.equal(lib.offerValid(mark, stack, after), true);
  assert.equal(
    lib.offerValid(
      mark,
      { past: [other, top], future: [] },
      layoutOf(group(["a"], { weight: 3 }), group(["b"]), group(["c"])),
    ),
    true,
    "sizes and selection do not withdraw it",
  );
  assert.equal(
    lib.offerValid(
      mark,
      { past: [other, top], future: [] },
      layoutOf(
        group(["a"], { selected: 1, active: true }),
        group(["b"]),
        group(["c"]),
      ),
    ),
    true,
  );
  const no = (history, current = after) =>
    lib.offerValid(mark, history, current);
  assert.equal(
    no({ past: [other, top, other], future: [] }),
    false,
    "deeper history",
  );
  assert.equal(no({ past: [top], future: [] }), false, "shallower history");
  assert.equal(
    no({ past: [other, { ...top }], future: [] }),
    false,
    "same depth, a different entry",
  );
  assert.equal(
    no({ past: [top, other], future: [] }),
    false,
    "same entries, another order",
  );
  assert.equal(
    no({ past: [other, top], future: [other] }),
    false,
    "something was undone",
  );
  assert.equal(
    no(stack, layoutOf(group(["a"]), group(["b"]), group(["c"]), group(["d"]))),
    false,
    "a panel appeared",
  );
  assert.equal(
    no(stack, layoutOf(group(["a"]), group(["b"]))),
    false,
    "a panel left",
  );
  assert.equal(
    no(stack, layoutOf(group(["b"]), group(["a"]), group(["c"]))),
    false,
    "a panel moved",
  );
  assert.equal(lib.offerValid(mark, stack, null), false);
  assert.equal(lib.offerValid(mark, stack, undefined), false);
  for (const junk of [
    undefined,
    null,
    0,
    "x",
    [],
    () => 0,
    {},
    { past: [] },
    { future: [] },
    { past: "ab", future: [] },
    { past: [other, top], future: null },
  ])
    assert.equal(no(junk), false, "history " + JSON.stringify(junk));
  for (const junk of [
    undefined,
    null,
    0,
    "x",
    [],
    {},
    { depth: 2 },
    { depth: "2", top, shape: mark.shape },
    { depth: 2, top, shape: 5 },
    { depth: 0, top: undefined, shape: mark.shape },
    { depth: 2, top, shape: "" },
    { depth: NaN, top, shape: mark.shape },
    { depth: -1, top, shape: mark.shape },
  ])
    assert.equal(
      lib.offerValid(junk, stack, after),
      false,
      "mark " + JSON.stringify(junk),
    );
  assert.deepEqual(lib.markOffer(undefined, after), {
    depth: 0,
    top: undefined,
    shape: lib.layoutShape(after),
  });
  assert.deepEqual(lib.markOffer({ past: [], future: [] }, null), {
    depth: 0,
    top: undefined,
    shape: "",
  });
  assert.deepEqual(lib.markOffer("x", 7), {
    depth: 0,
    top: undefined,
    shape: "",
  });
  assert.equal(
    lib.offerValid(
      lib.markOffer({ past: [], future: [] }, after),
      { past: [], future: [] },
      after,
    ),
    false,
    "an empty history never offers",
  );
  assert.equal(
    lib.offerValid(lib.markOffer(stack, null), stack, null),
    false,
    "an unreadable layout never offers",
  );

  // toastDelay: a table.
  assert.equal(lib.toastDelay(false, false, false), null);
  assert.equal(lib.toastDelay(false, true, false), null);
  assert.equal(lib.toastDelay(false, true, true), null);
  assert.equal(lib.toastDelay(false, false, true), null);
  assert.equal(lib.toastDelay(true, false, false), 4500);
  assert.equal(
    lib.toastDelay(true, false, true),
    4500,
    "a plain notice is never paused",
  );
  assert.equal(lib.toastDelay(true, true, false), 8000);
  assert.equal(
    lib.toastDelay(true, true, true),
    null,
    "a notice with Undo waits while the pointer is on it",
  );

  // A seeded walk: the shape is equal exactly when the independent model of the structure is.
  const random = seeded(20260611);
  const ids = ["a", "b", "c", "d", "e", "f"];
  const make = () => {
    const pool = ids
      .slice()
      .sort(() => random() - 0.5)
      .slice(0, 1 + Math.floor(random() * 5));
    const node = (list, depth) => {
      if (list.length <= 1 || depth > 2 || random() < 0.4)
        return {
          type: "tabset",
          id: "#" + Math.floor(random() * 1e9),
          weight: Math.floor(random() * 100),
          selected: Math.floor(random() * 3),
          active: random() < 0.5,
          ...(random() < 0.25 ? { name: "g" + Math.floor(random() * 3) } : {}),
          children: list.map(tab),
        };
      const cut = 1 + Math.floor(random() * (list.length - 1));
      return {
        type: "row",
        id: "#" + Math.floor(random() * 1e9),
        weight: Math.floor(random() * 100),
        children: [
          node(list.slice(0, cut), depth + 1),
          node(list.slice(cut), depth + 1),
        ],
      };
    };
    return {
      layout: { type: "row", id: "#r", children: [node(pool, 0)] },
      borders: [],
      subLayouts: {},
    };
  };
  const model = (n) =>
    n.type === "tab"
      ? [n.id, n.name]
      : [n.type, n.name || "", (n.children || []).map(model)];
  let walked = 0;
  let equal = 0;
  let unequal = 0;
  for (let i = 0; i < 400; i++) {
    const a = make();
    const b = random() < 0.3 ? JSON.parse(JSON.stringify(a)) : make();
    if (random() < 0.5)
      (function scramble(n) {
        if (n.type !== "tab") {
          n.weight = Math.floor(random() * 50);
          n.selected = 1;
          (n.children || []).forEach(scramble);
        }
      })(b.layout);
    const same =
      JSON.stringify(model(a.layout)) === JSON.stringify(model(b.layout));
    assert.equal(lib.layoutShape(a) === lib.layoutShape(b), same);
    const offer = lib.offerFor({
      kind: "preset",
      label: "x",
      pastLength: 1,
      before: a,
      after: b,
    });
    assert.equal(offer.canUndo, !same);
    const stackNow = { past: [a], future: [] };
    assert.equal(lib.offerValid(lib.markOffer(stackNow, a), stackNow, b), same);
    walked++;
    if (same) equal++;
    else unequal++;
  }
  assert.equal(walked, 400);
  assert.ok(
    equal > 40 && unequal > 40,
    "the walk meets both outcomes: " + equal + "/" + unequal,
  );
});

test("undo-toast wiring: the module is pure and ASCII with the pinned exports, App.tsx imports it once and holds exactly the pinned toast state, effects, offer, Undo handler and notice, notify keeps its string callers, and nothing else knows the module", () => {
  const source = read("src/undo-toast.ts");
  assert.ok(isAscii(source), "ASCII only");
  const code = stripComments(source);
  assert.ok(
    !code.includes(String.fromCharCode(92) + "u"),
    "no backslash-u escape",
  );
  assert.equal(count(code, "import "), 0, "no import");
  assert.ok(!/export default/.test(code), "no default export");
  for (const word of [
    "document",
    "window",
    "hrig",
    "React",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "setTimeout",
    "setInterval",
    "fetch",
    "Date",
    "Math",
    "performance",
    "eval",
    "require",
    "console",
    "process",
    "structuredClone",
  ])
    assert.ok(!new RegExp("\\b" + word + "\\b").test(code), "pure: " + word);
  const lines = source.split("\n");
  const exported = lines
    .map((line, i) => ({ line, i }))
    .filter((x) => x.line.startsWith("export "));
  assert.deepEqual(
    exported.map((x) => x.line.replace(/[({=:].*$/, "").trim()),
    [
      "export type UndoKind",
      "export const UNDO_LABEL",
      "export const NOTICE_MS",
      "export const UNDO_MS",
      "export const MAX_LABEL",
      "export interface UndoOffer",
      "export interface OfferInput",
      "export interface UndoMark",
      "export interface UndoNotice",
      "export function layoutShape",
      "export function offerFor",
      "export function markOffer",
      "export function offerValid",
      "export function toastDelay",
    ],
  );
  for (const x of exported)
    assert.ok(
      lines[x.i - 1].startsWith("/** ") && lines[x.i - 1].endsWith(" */"),
      "a one-line doc comment above: " + x.line,
    );
  for (const line of [
    'export const UNDO_LABEL = "Undo";',
    "export const NOTICE_MS = 4500;",
    "export const UNDO_MS = 8000;",
    "export const MAX_LABEL = 40;",
  ])
    assert.ok(lines.includes(line), line);

  // App.tsx: the import, the state, the hooks, the offer, the click, the notice.
  const app = tight(stripComments(read("src/App.tsx")));
  const expectText = (text, ...lines) => {
    const want = tight(lines.join("\n"));
    assert.ok(text.includes(want), "App.tsx must hold: " + want);
    assert.equal(count(text, want), 1, "exactly once: " + want);
  };
  expectText(
    app,
    "import {",
    "markOffer,",
    "offerFor,",
    "offerValid,",
    "toastDelay,",
    "UNDO_LABEL,",
    "type UndoKind,",
    "type UndoNotice,",
    '} from "./undo-toast";',
  );
  expectText(app, 'const [toast, setToast] = useState("");');
  expectText(
    app,
    "const [toastUndo, setToastUndo] = useState<UndoNotice | null>(null);",
    "const [toastHover, setToastHover] = useState(false);",
  );
  expectText(
    app,
    "const undoOffered = toastUndo !== null && toastUndo.text === toast;",
    "const notify = useCallback(",
    "(text: string) => {",
    "setToast(text);",
    "setToastUndo(null);",
    'log(text, "success");',
    "},",
    "[log],",
    ");",
    "useEffect(() => {",
    "const delay = toastDelay(!!toast, undoOffered, toastHover);",
    "if (delay === null) return;",
    'const timer = setTimeout(() => setToast(""), delay);',
    "return () => clearTimeout(timer);",
    "}, [toast, toastUndo, undoOffered && toastHover]);",
    "useEffect(() => {",
    "if (!toast) setToastHover(false);",
    "if (!toastUndo) return;",
    "if (",
    "!undoOffered ||",
    "!offerValid(toastUndo.mark, history.current, modelRef.current.toJson())",
    ")",
    "setToastUndo(null);",
    "}, [toast, toastUndo, revision]);",
    "useEffect(() => onTerminalDropped(",
  );
  assert.ok(
    !app.includes("4500"),
    "the plain timeout lives in the module only",
  );
  expectText(
    app,
    "const announceLayout = (kind: UndoKind, label: string, next: Model) => {",
    "const past = history.current.past;",
    "const after = next.toJson();",
    "const offer = offerFor({",
    "kind,",
    "label,",
    "pastLength: past.length,",
    "before: past.at(-1),",
    "after,",
    "});",
    "notify(offer.text);",
    "if (offer.canUndo)",
    "setToastUndo({ text: offer.text, mark: markOffer(history.current, after) });",
    "};",
    "const undoFromToast = () => {",
    "const offer = toastUndo;",
    'setToast("");',
    "setToastUndo(null);",
    "if (offer && offerValid(offer.mark, history.current, model.toJson()))",
    'travel("undo");',
    "};",
    "const refreshAll = () => {",
  );
  expectText(
    app,
    "const applyPreset = (preset: string) => {",
    "remember();",
    'const tabs = allTabs().filter((t) => t.component !== "welcome");',
    "const next = arrangement(tabs, preset);",
    "setModel(next);",
    "modelChanged(next);",
    "setMenu(null);",
    'announceLayout("preset", preset, next);',
    "};",
  );
  expectText(
    app,
    "{toast && (",
    '<div className="toast" role="status" onMouseEnter={() => setToastHover(true)} onMouseLeave={() => setToastHover(false)} >',
    "<Check size={15} />",
    "{toast}",
    "{undoOffered && (",
    '<button className="small-button" onClick={undoFromToast}>',
    "{UNDO_LABEL}",
    "</button>",
    ")}",
    '<button onClick={() => setToast("")}>',
    "<X size={13} />",
    "</button>",
    "</div>",
    ")}",
    '{modal === "connect" && (',
  );
  // The history itself is the existing one: three calls of travel("undo"), the palette's, the arranger's and the button's.
  assert.equal(count(app, 'travel("undo")'), 3);
  assert.equal(count(app, 'travel("redo")'), 2);
  assert.equal(count(app, "const history = useRef<"), 1);
  assert.equal(count(app, "const travel = (direction:"), 1);
  assert.equal(count(app, "const remember = () => {"), 1);
  assert.equal(
    count(app, "history.current = { past: [], future: [] };"),
    4,
    "history is cleared where it was",
  );
  assert.equal(count(app, "undoFromToast"), 2, "defined once, used once");
  assert.equal(count(app, "setToastHover("), 3, "reset, enter and leave");

  // What the added text must not contain: a bridge, a terminal, storage, a link, markup or a stylesheet.
  const added = [HOOKS_TEXT, HISTORY_TEXT, TOAST_TEXT]
    .map((t) => stripComments(t))
    .join("\n");
  for (const word of [
    "window.",
    "hrig",
    "writeTerminal",
    "sendTerminalCommand",
    "createTerminal",
    "closeTerminal",
    "rigAction",
    "sendMessage",
    "localStorage",
    "sessionStorage",
    "fetch(",
    "eval(",
    "innerHTML",
    "dangerouslySetInnerHTML",
    "href",
    "style=",
    "document.",
    "Math.random",
    "Date",
  ])
    assert.ok(!added.includes(word), "the notice code must not use " + word);

  // Only App.tsx knows the module; the stylesheet keeps its two toast rules and gains none.
  const names = fs
    .readdirSync(path.join(root, "src"))
    .filter((n) => /\.(ts|tsx)$/.test(n));
  assert.deepEqual(
    names.filter((n) => /undo-toast/.test(read("src/" + n))),
    ["App.tsx"],
  );
  for (const dir of ["electron", "mobile"]) {
    const walk = (d) =>
      fs
        .readdirSync(path.join(root, d), { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory()
            ? e.name === "node_modules" || e.name === "dist"
              ? []
              : walk(d + "/" + e.name)
            : [d + "/" + e.name],
        );
    for (const file of walk(dir))
      if (/\.(cjs|mjs|js|ts|tsx|json|html)$/.test(file))
        assert.ok(!/undo-toast|toastUndo/.test(read(file)), file);
  }
  const css = read("src/styles.css");
  assert.equal(count(css, "\n.toast {"), 1);
  assert.equal(count(css, "\n.toast > button {"), 1);
  assert.equal(count(css, "\n.small-button {"), 1);
  assert.ok(
    !/undo/i.test(css),
    "no new rule for the button: it reuses .toast and .small-button",
  );
});

// ---------------------------------------------------------------------------
// The other two entry points and the census of who may offer Undo.

const seatTab = (id, name) => ({
  type: "tab",
  id: "seat:local:" + id,
  name,
  component: "terminal",
  config: {
    connection: { id: "local" },
    root: "/p",
    seat: { id, name, session: "s-" + id },
    terminalId: "seat:local:" + id,
  },
});
const SEATS = [
  { id: "s1", name: "Planner", session: "s-s1" },
  { id: "s2", name: "Idle", session: null },
  { id: "s3", name: "Builder", session: "s-s3" },
];

test("undo-toast callers: Open all rig sessions and a role template offer Undo through the same path, nothing is offered when the panels did not move or an edit prompt is open, and no other layout change offers it", () => {
  // Open all rig sessions: the real openAll over the real model.
  const sessions = world({ tabs: ["a", "b"], seats: SEATS });
  const before = sessions.json();
  sessions.act((c) => c.openAll());
  assert.equal(sessions.s.toast, "Rig sessions arranged", "the old text");
  assert.deepEqual(sessions.s.events, [["Rig sessions arranged", "success"]]);
  const ids = sessions.api
    .allTabs()
    .map((t) => t.id)
    .sort();
  assert.deepEqual(
    ids,
    ["a", "b", "seat:local:s1", "seat:local:s3"],
    "the idle seat is not opened",
  );
  assert.equal(sessions.history.past.length, 1);
  const button = sessions.undoButton();
  assert.ok(button, "Undo is offered");
  assert.deepEqual(
    sessions.pending().map((t) => t.ms),
    [lib.UNDO_MS],
  );
  sessions.act(() => button.props.onClick());
  assert.equal(sessions.json(), before, "back to exactly the earlier layout");
  assert.equal(sessions.s.toast, "");
  assert.equal(sessions.history.past.length, 0);
  assert.equal(sessions.history.future.length, 1);
  sessions.act(() => button.props.onClick());
  assert.equal(sessions.json(), before, "a second click does nothing");
  assert.equal(sessions.history.future.length, 1);

  // Every session is already open in the same place: the notice stays plain.
  const open = world({
    tabJsons: [seatTab("s1", "Planner")],
    seats: [SEATS[0]],
  });
  const openBefore = open.shape();
  open.act((c) => c.openAll());
  assert.equal(open.shape(), openBefore);
  assert.equal(open.s.toast, "Rig sessions arranged");
  assert.equal(open.undoButton(), undefined, "nothing moved, nothing to undo");
  assert.deepEqual(
    open.pending().map((t) => t.ms),
    [4500],
  );

  // A role template: the real handler over the real instantiateRoles.
  const tabs = [
    {
      type: "tab",
      id: "a",
      name: "a",
      component: "editor",
      config: { path: "x.txt" },
    },
    seatTab("s1", "Planner"),
    seatTab("s3", "Builder"),
  ];
  const template = {
    id: "t1",
    name: "Review pair",
    model: real.roleSnapshot(arrangement(tabs, "Focus").toJson()),
  };
  const role = world({ tabJsons: tabs, start: "Team", seats: SEATS });
  const roleBefore = role.json();
  role.act((c) => c.applyTemplate(template));
  assert.equal(role.s.toast, "Role template applied: Review pair");
  assert.deepEqual(role.s.events, [
    ["Role template applied: Review pair", "success"],
  ]);
  assert.notEqual(role.json(), roleBefore, "the template replaced the layout");
  assert.equal(role.history.past.length, 1);
  const roleButton = role.undoButton();
  assert.ok(roleButton, "Undo is offered after a role template");
  role.act(() => roleButton.props.onClick());
  assert.equal(
    role.json(),
    roleBefore,
    "the earlier layout is back, panel for panel",
  );
  assert.equal(role.history.future.length, 1);
  role.act(() => roleButton.props.onClick());
  assert.equal(role.json(), roleBefore);

  // The name in the notice is cleaned like any other.
  const named = world({ tabJsons: tabs, start: "Team", seats: SEATS });
  named.act((c) =>
    c.applyTemplate({
      ...template,
      name: "  x" + char(0x202e) + "y\n" + "z".repeat(60),
    }),
  );
  assert.equal(
    named.s.toast,
    "Role template applied: xy " + "z".repeat(34) + "...",
  );

  // With no rig chosen nothing is applied: the old notice, no history, no button.
  const none = world({
    tabJsons: tabs,
    start: "Team",
    seats: SEATS,
    activeRig: "",
  });
  const noneBefore = none.json();
  none.act((c) => c.applyTemplate(template));
  assert.equal(
    none.s.toast,
    "Select one rig in the sidebar before applying a role template.",
  );
  assert.equal(none.undoButton(), undefined);
  assert.equal(none.history.past.length, 0);
  assert.equal(none.json(), noneBefore);

  // Unsaved edits: the replacement waits behind the prompt, and the offer comes only when it runs.
  const held = world({ tabJsons: tabs, start: "Team", seats: SEATS });
  held.s.hold = true;
  const heldBefore = held.json();
  held.act((c) => c.applyTemplate(template));
  assert.equal(held.s.asked.length, 1, "the prompt is asked");
  assert.equal(held.s.toast, "", "no notice yet");
  assert.equal(held.history.past.length, 0);
  assert.equal(
    held.json(),
    heldBefore,
    "nothing changed while the prompt is open",
  );
  held.act(() => held.s.asked[0]());
  assert.equal(held.s.toast, "Role template applied: Review pair");
  assert.ok(held.undoButton());
  held.act(() => held.undoButton().props.onClick());
  assert.equal(held.json(), heldBefore);

  // A template that puts the same panels in the same places changes nothing to undo.
  const lone = world({ tabJsons: [seatTab("s1", "Planner")], seats: SEATS });
  const loneTemplate = {
    id: "t2",
    name: "Solo",
    model: real.roleSnapshot(lone.model.toJson()),
  };
  const loneBefore = lone.shape();
  lone.act((c) => c.applyTemplate(loneTemplate));
  assert.equal(lone.shape(), loneBefore);
  assert.equal(lone.s.toast, "Role template applied: Solo");
  assert.equal(lone.undoButton(), undefined);

  // The census: three call sites, one per kind, each in its own handler; every other
  // remember() caller is an incremental edit that never announces anything.
  const app = tight(stripComments(read("src/App.tsx")));
  assert.equal(count(app, "announceLayout("), 3);
  assert.equal(count(app, 'announceLayout("preset", preset, next);'), 1);
  assert.equal(count(app, 'announceLayout("sessions", "", next);'), 1);
  assert.equal(count(app, 'announceLayout("role", template.name, next);'), 1);
  assert.equal(
    count(stripComments(ARRANGE_TEXT), "announceLayout("),
    2,
    "applyPreset and openAll",
  );
  assert.equal(
    count(stripComments(ROLE_TEXT), "announceLayout("),
    1,
    "the role handler",
  );
  assert.equal(
    count(app, "remember();"),
    9,
    "the callers of remember are the ones there were",
  );
  assert.ok(
    !app.includes('notify("Rig sessions arranged")'),
    "the old notice moved into the module",
  );
  assert.ok(!app.includes("arrangement applied"), "and so did the preset text");
  for (const [first, last] of [
    ["const movePanel = (", "const openSeatBeside = ("],
    [
      "const onAction = (action: Action) => {",
      "const markDirty = useCallback(",
    ],
    ["const toggleMaximize = (", "const reopenClosedPanel = () => {"],
  ]) {
    const from = app.indexOf(tight(first));
    assert.ok(from >= 0, first);
    const to = app.indexOf(tight(last), from + 5);
    assert.ok(to > from, last);
    assert.ok(
      !app.slice(from, to).includes("announceLayout"),
      "an incremental edit does not announce: " + first,
    );
    assert.ok(app.slice(from, to).includes("remember();"), first);
  }
  const arranger = tight(
    stripComments(cut('case "arranger": {', 'case "doctor":')),
  );
  for (const edit of ["onRenameGroup", "onMove=", "onEqual="]) {
    const from = arranger.indexOf(edit);
    assert.ok(from >= 0, edit);
    const to = arranger.indexOf("onUndo=", from);
    assert.ok(!arranger.slice(from, to).includes("announceLayout"), edit);
  }
  // Saved layouts are restored without history, so they never offer Undo.
  const restore = tight(
    stripComments(
      cut("const next = restoreModel(saved.model);", "notify(`Restored"),
    ),
  );
  assert.ok(
    !restore.includes("remember") && !restore.includes("announceLayout"),
  );
});

test("undo-toast docs: NAVIGATION.md has one paragraph that says where the Undo button appears, what it undoes, how long it stays, when it goes away, what never shows it and that nothing is sent", () => {
  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark is kept");
  assert.ok(raw.endsWith(".\n") && !raw.endsWith("\n\n"));
  assert.ok(!raw.includes("\r"));
  const lines = raw.split("\n");
  const mine = lines.filter((l) => l.startsWith("Layout undo notice:"));
  assert.equal(mine.length, 1);
  const paragraph = mine[0];
  assert.ok(isAscii(paragraph), "plain ASCII");
  const at = lines.indexOf(paragraph);
  assert.ok(
    lines[at - 1] === "" && lines[at + 1] === "",
    "a paragraph of its own",
  );
  const index = (start) => lines.findIndex((l) => l.startsWith(start));
  assert.ok(
    at > index("Double-click the empty part of a panel group's tab strip"),
  );
  assert.ok(at < index("The command center entry Toggle focus mode"));
  assert.equal(count(raw, "Layout undo notice:"), 1);
  for (const part of [
    "after Arrange: Team, Focus or Review",
    "the command center, the Layout presets menu or the Arrange workspace panel",
    "when the review workspace arranges Review as it opens a seat or a diff",
    "Open all rig sessions",
    "applying a saved role template in Arrange workspace",
    "has an Undo button",
    "One click puts the previous layout back",
    "one step through the same history as the command center entry Undo arrangement and Redo arrangement",
    "closes the notice",
    "Redo arrangement brings the new layout back",
    "The notice stays for " +
      lib.UNDO_MS / 1000 +
      " seconds instead of " +
      lib.NOTICE_MS / 1000,
    "the time stops while the pointer rests on it",
    "only offered when the panels really moved",
    "leaving the plain notice",
    "another arrangement, a panel moved, split, resized or renamed, a panel opened or closed, or an Undo or Redo from elsewhere",
    "only undo the change it was shown for, and only once",
    "ignoring it changes nothing",
    "Single moves, splits, group renames, equal sizes and maximize do not show it",
    "restoring a saved layout from the Layout presets menu has no Undo",
    "there is no setting or shortcut for the button",
    "the command center entry Undo arrangement is the keyboard route and works at any time",
    "only changes where panels are shown",
    "nothing is typed or sent to a terminal or seat",
  ])
    assert.ok(paragraph.includes(part), "paragraph: " + part);
  assert.ok(paragraph.endsWith("seat."));
  // The neighbours the other documentation tests pin are where they were.
  assert.ok(
    index("Ctrl+Tab switches panels") ===
      index("Ctrl+Shift+P (Cmd+Shift+P) finds existing panels") + 2,
  );
  assert.equal(count(paragraph, "Undo arrangement"), 3);
});

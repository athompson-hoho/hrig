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

function load(entry) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = new Module(entry, module);
  mod.filename = path.join(root, entry);
  mod._compile(built.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const mru = load("src/panel-mru.ts");
const catalog = load("src/shortcuts.ts");
const terminalKeys = load("src/terminal-keys.ts");
const overrides = load("src/shortcut-overrides.ts");

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function press(text, extra = {}) {
  const event = {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
  };
  for (const part of text.split("+")) {
    if (part === "Ctrl") event.ctrlKey = true;
    else if (part === "Cmd") event.metaKey = true;
    else if (part === "Shift") event.shiftKey = true;
    else event.key = part;
  }
  return Object.assign(event, extra);
}

// ---------------------------------------------------------------------------
// The real App text, cut out, stripped of its types and run over fakes.

class FakeTab {
  getId() {
    return this.id;
  }
  getWindow() {
    return this.win;
  }
}

function fakeModel(ids) {
  const nodes = new Map();
  for (const id of ids) {
    const node = new FakeTab();
    node.id = id;
    nodes.set(id, node);
  }
  const listeners = [];
  const model = {
    active: null,
    getActiveTabset: () =>
      model.active === null
        ? undefined
        : { getSelectedNode: () => nodes.get(model.active) },
    getNodeById: (id) => nodes.get(id),
    addChangeListener: (l) => listeners.push(l),
    removeChangeListener: (l) => listeners.splice(listeners.indexOf(l), 1),
    listeners,
    nodes,
    fire(action) {
      for (const l of [...listeners]) l.onAfterAction(action);
    },
    select(id) {
      model.active = id;
      model.fire({ type: "selectTab", data: { tabNode: id } });
    },
    close(id, next) {
      nodes.delete(id);
      model.active = model.active === id ? next : model.active;
      model.fire({ type: "deleteTab", data: { node: id } });
    },
  };
  return model;
}

function glueText() {
  const app = read("src/App.tsx");
  const from = app.indexOf("// Ctrl+Tab order, newest first.");
  const to = app.indexOf("const movePanel = (", from);
  assert.ok(from > 0 && to > from, "the panel order block is found");
  return app.slice(from, to);
}

// The real glue block (the state ref, the model listener, the Control release
// listener and cyclePanel) over a fake model, window and focusPanel.
function glueHarness(ids) {
  const model = fakeModel(ids);
  const registered = {};
  const win = {
    addEventListener: (type, fn) => (registered[type] = fn),
    removeEventListener: (type) => delete registered[type],
  };
  const document = {};
  const focused = [];
  const effects = [];
  const fakes = {
    useRef: (value) => ({ current: value }),
    useEffect: (fn, deps) => effects.push({ fn, deps }),
    emptyMru: mru.emptyMru,
    noteActive: mru.noteActive,
    noteClosed: mru.noteClosed,
    stepCycle: mru.stepCycle,
    endCycle: mru.endCycle,
    model,
    modelRef: { current: model },
    window: win,
    document,
    TabNode: FakeTab,
    focusPanel: (id) => {
      focused.push(id);
      model.select(id);
    },
  };
  const js = transformSync(glueText(), { loader: "ts" }).code;
  const names = Object.keys(fakes);
  const make = new Function(
    ...names,
    js + "\nreturn { panelMru, cyclePanel };",
  );
  const out = make(...names.map((n) => fakes[n]));
  assert.equal(
    effects.length,
    2,
    "two effects: the model listener, the release",
  );
  assert.deepEqual(
    effects.map((e) => e.deps.length),
    [1, 0],
    "the listener follows the model, the release is registered once",
  );
  const cleanups = effects.map((e) => e.fn());
  return {
    ...out,
    model,
    focused,
    document,
    registered,
    cleanups,
    release: () => registered.keyup({ key: "Control" }),
    blur: () => registered.blur(),
    order: () => out.panelMru.current.order,
  };
}

// The real key handler text over fakes, with the real classifiers behind it.
function handlerHarness(platform, cyclePanel, overridesText = "", doc = null) {
  const source = read("src/App.tsx");
  const from = source.indexOf("const handler = (event: KeyboardEvent) => {");
  const to = source.indexOf("const windows = [", from);
  assert.ok(from > 0 && to > from, "the key handler is found");
  const js = transformSync(source.slice(from, to), { loader: "ts" }).code;
  const calls = [];
  const state = { modal: null, dialog: false };
  const fakes = {
    terminalOwnsKey: terminalKeys.terminalOwnsKey,
    isHelpKey: catalog.isHelpKey,
    hasOpenDialog: () => state.dialog,
    isReopenPanelKey: catalog.isReopenPanelKey,
    isMaximizePanelKey: catalog.isMaximizePanelKey,
    isFocusModeKey: catalog.isFocusModeKey,
    isPanelCycleKey: catalog.isPanelCycleKey,
    routeOverriddenKey: overrides.routeOverriddenKey,
    window: { hrig: { platform } },
    shortcutOverrides: overrides.parseOverrideText(overridesText, platform).map,
    cyclePanel:
      cyclePanel ||
      ((direction, source) =>
        calls.push("cycle:" + direction + ":" + !!source)),
    openShortcuts: () => calls.push("shortcuts"),
    reopenClosedPanel: () => calls.push("reopen"),
    toggleMaximize: (mode) => calls.push("maximize:" + mode),
    toggleFocusMode: () => calls.push("focus"),
    openPanelNavigator: () => calls.push("panels"),
    openQuickOpen: () => calls.push("quickOpen"),
    openSettings: () => calls.push("settings"),
    openPalette: () => calls.push("palette"),
    openProject: () => calls.push("project"),
    setSidebar: () => calls.push("sidebar"),
    openShell: () => calls.push("shell"),
  };
  const names = Object.keys(fakes);
  const make = new Function(...names, "modal", js + "\nreturn handler;");
  return {
    calls,
    state,
    key(text, extra = {}, target) {
      const handler = make(...names.map((n) => fakes[n]), state.modal);
      const event = press(text, extra);
      let prevented = 0;
      let stopped = 0;
      event.preventDefault = () => prevented++;
      event.stopPropagation = () => stopped++;
      event.target = target || {
        tagName: "DIV",
        isContentEditable: false,
        closest: () => null,
        ownerDocument: doc || { querySelector: () => null },
      };
      const before = calls.length;
      handler(event);
      return {
        ran: calls.slice(before),
        claimed: prevented > 0 && stopped > 0,
        touched: prevented + stopped,
      };
    },
  };
}

test("panel-mru tracer: Ctrl+Tab in the real App key handler walks the real recent-panel order, frozen while Control is held, and releasing Control makes the panel you stopped on the newest", () => {
  const g = glueHarness(["A", "B", "C", "D"]);
  // You used A, then B, then C, then D: the newest is first.
  for (const id of ["A", "B", "C", "D"]) g.model.select(id);
  assert.deepEqual(g.order(), ["D", "C", "B", "A"]);
  const h = handlerHarness("linux", g.cyclePanel, "", g.document);
  const activeAfter = (text, extra) => {
    const result = h.key(text, extra);
    assert.equal(result.claimed, true, text + " is claimed");
    return g.model.active;
  };
  // One press goes back one panel, and that one press already shows it.
  assert.equal(activeAfter("Ctrl+Tab"), "C");
  assert.deepEqual(g.focused, ["C"]);
  // Pressing Tab again with Control still down walks deeper, not back to D.
  assert.equal(activeAfter("Ctrl+Tab"), "B");
  assert.equal(activeAfter("Ctrl+Tab"), "A");
  assert.equal(activeAfter("Ctrl+Tab"), "D", "the walk wraps");
  assert.equal(activeAfter("Ctrl+Shift+Tab"), "A", "Shift goes the other way");
  assert.deepEqual(
    g.order(),
    ["D", "C", "B", "A"],
    "the order is frozen while Control is held",
  );
  g.release();
  assert.deepEqual(
    g.order(),
    ["A", "D", "C", "B"],
    "A, where you stopped, is newest",
  );
  // A fresh hold starts from the new order: one press goes to D.
  assert.equal(activeAfter("Ctrl+Tab"), "D");
  g.release();
  assert.deepEqual(g.order(), ["D", "A", "C", "B"]);
  // Ctrl+Shift+Tab from the newest panel goes straight to the oldest.
  assert.equal(activeAfter("Ctrl+Shift+Tab"), "B");
  g.release();
  assert.deepEqual(g.order(), ["B", "D", "A", "C"]);
  // A click that is not a press ends a hold and is recorded like any selection.
  assert.equal(activeAfter("Ctrl+Tab"), "D");
  g.model.select("C");
  assert.deepEqual(g.order(), ["C", "B", "D", "A"]);
  g.release();
  assert.deepEqual(
    g.order(),
    ["C", "B", "D", "A"],
    "release after a click changes nothing",
  );
  assert.equal(activeAfter("Ctrl+Tab"), "B");
  // Losing window focus ends the hold as well.
  g.blur();
  assert.deepEqual(g.order(), ["B", "C", "D", "A"]);
});

test("panel-mru handler rules: a held key, a dialog, a popout, a closed panel, a panel in another window and a lone panel never cycle, and what the handler does not own is untouched", () => {
  const g = glueHarness(["A", "B", "C"]);
  for (const id of ["A", "B", "C"]) g.model.select(id);
  const h = handlerHarness("linux", g.cyclePanel, "", g.document);
  // A held key is claimed (a shell would get a plain Tab) but cycles nothing.
  assert.deepEqual(h.key("Ctrl+Tab", { repeat: true }), {
    ran: [],
    claimed: true,
    touched: 2,
  });
  assert.equal(g.model.active, "C");
  // A dialog open: claimed, nothing happens.
  h.state.dialog = true;
  assert.equal(h.key("Ctrl+Tab").claimed, true);
  assert.equal(g.model.active, "C");
  h.state.dialog = false;
  h.state.modal = "palette";
  assert.equal(h.key("Ctrl+Tab").claimed, true);
  assert.equal(g.model.active, "C");
  h.state.modal = null;
  // A key pressed in a popout window (another document) is claimed and ignored.
  const popout = {
    tagName: "DIV",
    isContentEditable: false,
    closest: () => null,
    ownerDocument: { querySelector: () => null },
  };
  assert.equal(h.key("Ctrl+Tab", {}, popout).claimed, true);
  assert.equal(g.model.active, "C");
  // The same event from this window's document cycles.
  const here = { ...popout, ownerDocument: g.document };
  assert.equal(h.key("Ctrl+Tab", {}, here).claimed, true);
  assert.equal(g.model.active, "B");
  g.release();
  // A closed panel is skipped, a panel in another window is skipped.
  g.model.nodes.get("A").win = { other: true };
  assert.equal(h.key("Ctrl+Tab", {}, here).claimed, true);
  assert.equal(g.model.active, "C", "A is in another window, so B goes to C");
  g.release();
  g.model.nodes.get("A").win = undefined;
  // The walk skips such a panel wherever it sits: B is elsewhere, so C goes on to A.
  g.model.nodes.get("B").win = { other: true };
  assert.equal(h.key("Ctrl+Tab", {}, here).claimed, true);
  assert.equal(g.model.active, "A", "B is in another window, so C goes to A");
  g.release();
  g.model.nodes.get("B").win = undefined;
  g.model.close("A", "C");
  assert.ok(!g.order().includes("A"), "a closed panel leaves the order");
  assert.equal(h.key("Ctrl+Tab", {}, here).claimed, true);
  assert.equal(g.model.active, "B");
  g.release();
  // One panel left: nothing to switch to and nothing selected.
  g.model.close("B", "C");
  g.focused.length = 0;
  assert.equal(h.key("Ctrl+Tab", {}, here).claimed, true);
  assert.deepEqual(g.focused, []);
  assert.equal(g.model.active, "C");

  // Other keys: every default chord does what it did and cycles nothing, on every platform.
  for (const platform of ["linux", "win32", "darwin"]) {
    const plain = handlerHarness(platform, null);
    const mod = platform === "darwin" ? "Cmd" : "Ctrl";
    for (const [text, ran] of [
      [mod + "+K", ["palette"]],
      [mod + "+O", ["project"]],
      [mod + "+B", ["sidebar"]],
      [mod + "+P", ["quickOpen"]],
      [mod + "+Shift+P", ["panels"]],
      [mod + "+Shift+T", ["shell"]],
      [mod + "+Shift+H", ["reopen"]],
      [mod + "+Shift+M", ["maximize:toggle"]],
      [mod + "+Shift+D", ["focus"]],
    ]) {
      const result = plain.key(text, { key: text.split("+").pop() });
      assert.deepEqual(result.ran, ran, platform + " " + text);
    }
    // Control and Tab only: Cmd+Tab, Alt+Ctrl+Tab and Tab alone are left to the system, the terminal and the page.
    for (const text of ["Cmd+Tab", "Tab", "Shift+Tab", "Cmd+Shift+Tab"])
      assert.deepEqual(
        plain.key(text),
        { ran: [], claimed: false, touched: 0 },
        platform + " " + text,
      );
    assert.deepEqual(plain.key("Ctrl+Tab", { altKey: true }), {
      ran: [],
      claimed: false,
      touched: 0,
    });
    // Control, not Cmd, on macOS as everywhere else.
    assert.deepEqual(plain.key("Ctrl+Tab").ran, ["cycle:1:true"], platform);
    assert.deepEqual(
      plain.key("Ctrl+Shift+Tab").ran,
      ["cycle:-1:true"],
      platform,
    );
  }
  // A rebound shortcut text changes nothing about Ctrl+Tab.
  const rebound = handlerHarness(
    "linux",
    null,
    "workspace.reopenPanel=Ctrl+Shift+J",
  );
  assert.deepEqual(rebound.key("Ctrl+Tab").ran, ["cycle:1:true"]);
  assert.deepEqual(rebound.key("Ctrl+Shift+J", { key: "J" }).ran, ["reopen"]);
});

test("panel-mru list: touch, remove and cycle keep a bounded, deduplicated order, never mutate, and skip ids that are unknown or closed", () => {
  const { touch, remove, cycle, MAX_MRU_PANELS } = mru;
  assert.equal(MAX_MRU_PANELS, 100);
  assert.deepEqual(touch([], "a"), ["a"]);
  assert.deepEqual(touch(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(touch(["a", "b", "c"], "a"), ["a", "b", "c"]);
  assert.deepEqual(touch(["a", "b", "a", "c", "b"], "d"), ["d", "a", "b", "c"]);
  assert.deepEqual(touch(["a", "", 3, null, undefined, "b"], "c"), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(touch(["a", "b"], ""), ["a", "b"]);
  assert.deepEqual(touch(["a", "b"], null), ["a", "b"]);
  assert.deepEqual(touch(["a", "b"], 5), ["a", "b"]);
  const frozen = Object.freeze(["a", "b", "c"]);
  assert.deepEqual(touch(frozen, "c"), ["c", "a", "b"]);
  assert.notEqual(touch(frozen, "a"), frozen);
  const big = Array.from({ length: 250 }, (_, i) => "p" + i);
  const capped = touch(big, "new");
  assert.equal(capped.length, 100);
  assert.deepEqual(capped.slice(0, 3), ["new", "p0", "p1"]);
  assert.equal(capped[99], "p98");
  assert.equal(remove(big, "p0").length, 100);
  assert.deepEqual(remove(["a", "b", "a", "c"], "a"), ["b", "c"]);
  assert.deepEqual(remove(["a", "b"], "zzz"), ["a", "b"]);
  assert.deepEqual(remove(["a", "", 3, "b"], "b"), ["a"]);
  assert.deepEqual(remove(frozen, "b"), ["a", "c"]);
  assert.deepEqual(remove([], "a"), []);

  const list = ["a", "b", "c", "d"];
  assert.equal(cycle(list, "a", 1), "b");
  assert.equal(cycle(list, "b", 1), "c");
  assert.equal(cycle(list, "d", 1), "a", "wraps to the newest");
  assert.equal(cycle(list, "a", -1), "d", "wraps to the oldest");
  assert.equal(cycle(list, "c", -1), "b");
  assert.equal(
    cycle(list, "z", 1),
    "a",
    "a current outside the list goes to the newest",
  );
  assert.equal(cycle(list, "z", -1), "d");
  assert.equal(cycle(list, null, 1), "a");
  assert.equal(cycle(list, null, -1), "d");
  const open = (id) => id !== "b" && id !== "c";
  assert.equal(cycle(list, "a", 1, open), "d", "closed ids are skipped");
  assert.equal(cycle(list, "d", -1, open), "a");
  assert.equal(
    cycle(list, "b", 1, open),
    "d",
    "a closed current still has a place to start",
  );
  assert.equal(cycle(["a"], "a", 1), null);
  assert.equal(
    cycle(["a", "b"], "a", 1, (id) => id === "a"),
    null,
  );
  assert.equal(cycle([], "a", 1), null);
  assert.equal(cycle([], null, 1), null);
  assert.equal(cycle(["a", "a", "b"], "a", 1), "b", "repeats count once");
  assert.equal(cycle(["", "a", 7, "b"], "a", 1), "b");
  assert.equal(cycle(list, "a", 5), "b", "any other direction steps forward");
  assert.deepEqual(list, ["a", "b", "c", "d"], "the list is never changed");

  // A seeded walk against a plain model of the same rules.
  const next = seeded(7);
  const names = ["a", "b", "c", "d", "e", "f"];
  for (let run = 0; run < 400; run++) {
    let actual = [];
    let model = [];
    for (let step = 0; step < 12; step++) {
      const id = names[Math.floor(next() * names.length)];
      if (next() < 0.25) {
        actual = remove(actual, id);
        model = model.filter((x) => x !== id);
      } else {
        actual = touch(actual, id);
        model = [id, ...model.filter((x) => x !== id)];
      }
      assert.deepEqual(actual, model);
      const closed = new Set(names.filter(() => next() < 0.3));
      const isOpen = (x) => !closed.has(x);
      const direction = next() < 0.5 ? 1 : -1;
      const current =
        next() < 0.15 ? "zz" : names[Math.floor(next() * names.length)];
      const candidates = model.filter((x) => x === current || isOpen(x));
      const others = candidates.filter((x) => x !== current);
      let expected = null;
      if (others.length > 0) {
        const at = candidates.indexOf(current);
        expected =
          at === -1
            ? direction === 1
              ? candidates[0]
              : candidates[candidates.length - 1]
            : candidates[
                (at + direction + candidates.length) % candidates.length
              ];
      }
      const got = cycle(actual, current, direction, isOpen);
      assert.equal(got, expected);
      if (got !== null) {
        assert.notEqual(got, current);
        assert.ok(isOpen(got));
      }
    }
  }
});

test("panel-mru state: a press freezes the order, the app's own selection keeps the walk going, any other change or a release ends it, and a close leaves everywhere", () => {
  const { emptyMru, noteActive, noteClosed, stepCycle, endCycle } = mru;
  const all = () => true;
  let s = emptyMru();
  assert.deepEqual(s, { order: [], hold: null, expect: null, seen: null });
  assert.notEqual(emptyMru(), emptyMru(), "a fresh state every time");
  assert.equal(noteActive(s, null), s);
  assert.equal(noteActive(s, ""), s);
  s = noteActive(s, "a");
  s = noteActive(s, "b");
  s = noteActive(s, "c");
  assert.deepEqual(s.order, ["c", "b", "a"]);
  assert.equal(noteActive(s, "c"), s, "the same panel again changes nothing");
  // Nothing to walk to: no state change, no hold.
  const alone = noteActive(emptyMru(), "a");
  const none = stepCycle(alone, "a", 1, all);
  assert.equal(none.target, null);
  assert.equal(none.state, alone);
  // The first press freezes the order and expects the selection it asked for.
  const first = stepCycle(s, "c", 1, all);
  assert.equal(first.target, "b");
  assert.deepEqual(first.state.hold, ["c", "b", "a"]);
  assert.equal(first.state.expect, "b");
  assert.deepEqual(
    first.state.order,
    ["c", "b", "a"],
    "the order itself is not touched",
  );
  assert.deepEqual(s.order, ["c", "b", "a"], "the old state is not changed");
  assert.equal(s.hold, null);
  // The app's own selection is not a new use.
  const own = noteActive(first.state, "b");
  assert.deepEqual(own.order, ["c", "b", "a"]);
  assert.deepEqual(own.hold, ["c", "b", "a"]);
  assert.equal(own.expect, null);
  assert.equal(own.seen, "b");
  const second = stepCycle(own, "b", 1, all);
  assert.equal(second.target, "a");
  assert.deepEqual(second.state.hold, ["c", "b", "a"], "the same frozen copy");
  // A selection the app did not ask for ends the hold and counts as a use.
  const outside = noteActive(second.state, "c");
  assert.deepEqual(outside.order, ["c", "b", "a"]);
  assert.equal(outside.hold, null);
  const outside2 = noteActive(second.state, "q");
  assert.deepEqual(outside2.order, ["q", "c", "b", "a"]);
  assert.equal(outside2.hold, null);
  assert.equal(outside2.expect, null);
  // Release makes the panel you stopped on the newest.
  const own2 = noteActive(second.state, "a");
  const released = endCycle(own2, "a");
  assert.deepEqual(released.order, ["a", "c", "b"]);
  assert.equal(released.hold, null);
  assert.equal(released.expect, null);
  assert.equal(endCycle(s, "c"), s, "a release with no hold changes nothing");
  assert.deepEqual(endCycle(own2, null).order, ["c", "b", "a"]);
  // A close leaves the order, the frozen copy and the expectation.
  const closed = noteClosed(first.state, "b");
  assert.deepEqual(closed.order, ["c", "a"]);
  assert.deepEqual(closed.hold, ["c", "a"]);
  assert.equal(closed.expect, null);
  assert.equal(noteClosed(s, "zzz").order.join(), "c,b,a");
  assert.equal(noteClosed(noteActive(emptyMru(), "a"), "a").seen, null);
  // A walk skips closed panels.
  const skipping = stepCycle(s, "c", 1, (id) => id !== "b");
  assert.equal(skipping.target, "a");

  // A seeded walk against a plain model of the same rules.
  const next = seeded(99);
  const ids = ["a", "b", "c", "d", "e"];
  for (let run = 0; run < 600; run++) {
    let state = emptyMru();
    let order = [];
    let frozen = null;
    let active = null;
    let open = new Set(ids);
    for (let step = 0; step < 30; step++) {
      const roll = next();
      if (roll < 0.3) {
        // a click or any selection the app did not make
        const id = ids[Math.floor(next() * ids.length)];
        if (!open.has(id)) continue;
        if (id !== active) {
          order = [id, ...order.filter((x) => x !== id)];
          frozen = null;
        }
        active = id;
        state = noteActive(state, id);
      } else if (roll < 0.75) {
        const direction = next() < 0.5 ? 1 : -1;
        const result = stepCycle(state, active, direction, (x) => open.has(x));
        const from = frozen || order;
        const candidates = from.filter((x) => x === active || open.has(x));
        const others = candidates.filter((x) => x !== active);
        let expected = null;
        if (others.length > 0) {
          const at = candidates.indexOf(active);
          expected =
            at === -1
              ? direction === 1
                ? candidates[0]
                : candidates[candidates.length - 1]
              : candidates[
                  (at + direction + candidates.length) % candidates.length
                ];
        }
        assert.equal(result.target, expected, "run " + run + " step " + step);
        state = result.state;
        if (expected !== null) {
          frozen = from.slice();
          active = expected;
          state = noteActive(state, expected);
        }
      } else if (roll < 0.9) {
        if (frozen !== null && active !== null)
          order = [active, ...order.filter((x) => x !== active)];
        frozen = null;
        state = endCycle(state, active);
      } else if (open.size > 1) {
        const id = [...open][Math.floor(next() * open.size)];
        open.delete(id);
        order = order.filter((x) => x !== id);
        if (frozen) frozen = frozen.filter((x) => x !== id);
        state = noteClosed(state, id);
        if (active === id) {
          // the layout selects a neighbour by itself: a use the app did not ask for
          active = [...open][0];
          order = [active, ...order.filter((x) => x !== active)];
          frozen = null;
          state = noteActive(state, active);
        }
      }
      assert.deepEqual(state.order, order, "run " + run + " step " + step);
      assert.deepEqual(state.hold, frozen, "run " + run + " step " + step);
      assert.equal(new Set(state.order).size, state.order.length);
      assert.ok(state.order.length <= mru.MAX_MRU_PANELS);
    }
  }
});

test("panel-mru wiring: one pure module, one import each in App, the chord claimed between the focus mode block and the generic block, one Control release listener, and nothing sent to a terminal", () => {
  const code = stripComments(read("src/panel-mru.ts"));
  assert.ok(/^[\x20-\x7e\n]*$/.test(read("src/panel-mru.ts")), "ASCII only");
  assert.ok(!/^import /m.test(code), "the module imports nothing");
  for (const forbidden of [
    /\bwindow\b/,
    /\bdocument\b/,
    /\bhrig\b/,
    /localStorage|sessionStorage|indexedDB/,
    /\bfetch\(/,
    /setTimeout|setInterval|Date\.now|Math\.random|performance\./,
    /writeTerminal|createTerminal|sendTerminalCommand|writeText/,
    /export default/,
    /console\./,
    /from "react"/,
  ])
    assert.ok(!forbidden.test(code), "the module must stay pure: " + forbidden);
  assert.deepEqual(Object.keys(mru).sort(), [
    "MAX_MRU_PANELS",
    "cycle",
    "emptyMru",
    "endCycle",
    "noteActive",
    "noteClosed",
    "remove",
    "stepCycle",
    "touch",
  ]);
  const shortcuts = stripComments(read("src/shortcuts.ts"));
  assert.equal(count(shortcuts, "export function isPanelCycleKey("), 1);

  const app = tight(stripComments(read("src/App.tsx")));
  const has = (text, part) => text.includes(tight(part));
  assert.equal(count(app, 'import { isPanelCycleKey } from "./shortcuts";'), 1);
  assert.equal(
    count(
      app,
      'import { emptyMru, endCycle, noteActive, noteClosed, stepCycle } from "./panel-mru";',
    ),
    1,
  );
  for (const name of [
    "emptyMru(",
    "endCycle(",
    "noteActive(",
    "noteClosed(",
    "stepCycle(",
    "isPanelCycleKey(",
    "cyclePanel(",
  ])
    assert.equal(count(app, name), 1, name);
  const handler = app.slice(
    app.indexOf(tight("const handler = (event: KeyboardEvent) => {")),
    app.indexOf(tight("const windows = [")),
  );
  const order = [
    "if (isHelpKey(",
    "if (isReopenPanelKey(event, window.hrig.platform)) {",
    "if (isMaximizePanelKey(event, window.hrig.platform)) {",
    "if (isFocusModeKey(event, window.hrig.platform)) {",
    "if (isPanelCycleKey(event)) {",
    "if (event.ctrlKey || event.metaKey) {",
  ].map((needle) => handler.indexOf(tight(needle)));
  assert.ok(
    order.every((at, i) => at >= 0 && (i === 0 || order[i - 1] < at)),
    "claim order: " + order,
  );
  assert.ok(
    has(
      handler,
      "if (isPanelCycleKey(event)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat && modal === null && !hasOpenDialog(event.target)) cyclePanel(event.shiftKey ? -1 : 1, event.target); return; }",
    ),
    "claimed always, acts once per press and only with no dialog open",
  );
  assert.ok(
    has(
      handler,
      "if (event.defaultPrevented || event.isComposing || event.altKey) return;",
    ),
    "the early return for Alt, composing and handled keys is untouched",
  );
  assert.ok(!handler.includes("Escape"));
  assert.equal(count(app, 'addEventListener("keyup"'), 1);
  assert.equal(count(app, 'removeEventListener("keyup"'), 1);
  assert.equal(count(app, 'addEventListener("blur"'), 1);

  const glue = tight(
    stripComments(
      read("src/App.tsx").slice(
        read("src/App.tsx").indexOf("// Ctrl+Tab order, newest first."),
        read("src/App.tsx").indexOf("const movePanel = ("),
      ),
    ),
  );
  assert.ok(has(glue, "const panelMru = useRef(emptyMru());"));
  assert.ok(has(glue, "const note = () => { panelMru.current = noteActive("));
  assert.ok(has(glue, 'if (event.key === "Control") end();'));
  assert.ok(has(glue, "if (owner && owner !== document) return;"));
  assert.ok(has(glue, "if (step.target !== null) focusPanel(step.target);"));
  for (const forbidden of [
    "writeTerminal",
    "sendTerminalCommand",
    "createTerminal",
    "closeTerminal",
    "window.hrig",
    "setRecentPanels",
    "setModal",
    "Actions.selectTab",
    "Actions.deleteTab",
    "Actions.DELETE_TAB",
    "console" + ".",
    "localStorage",
  ])
    assert.ok(
      !glue.includes(forbidden),
      "the panel order block must not use " + forbidden,
    );
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .sort();
  assert.deepEqual(
    files.filter((name) =>
      stripComments(read("src/" + name)).includes("isPanelCycleKey("),
    ),
    ["App.tsx", "shortcuts.ts"],
  );
  assert.deepEqual(
    files.filter((name) =>
      stripComments(read("src/" + name)).includes("./panel-mru"),
    ),
    ["App.tsx"],
  );
});

test("panel-mru docs: NAVIGATION.md says what Ctrl+Tab does, that the order is frozen while Control is held, what is skipped and that it replaces a plain Tab in a terminal", () => {
  const text = read("NAVIGATION.md");
  const paragraphs = text.split("\n\n");
  const mine = paragraphs.filter((p) =>
    p.startsWith("Ctrl+Tab switches panels"),
  );
  assert.equal(mine.length, 1, "one paragraph");
  const at = paragraphs.indexOf(mine[0]);
  assert.ok(
    paragraphs[at - 1].startsWith(
      "Ctrl+Shift+P (Cmd+Shift+P) finds existing panels",
    ),
    "directly after the panel finder paragraph",
  );
  assert.ok(
    ["Project path spelling remains stable", "Right-click a panel's tab"].some(
      (start) => paragraphs[at + 1].startsWith(start),
    ),
    "and before the project path paragraph or the panel tab menu paragraph",
  );
  const p = collapse(mine[0]);
  assert.ok(/^[\x20-\x7e]*$/.test(mine[0]), "ASCII only");
  for (const fragment of [
    "Ctrl+Tab switches panels in most recently used order",
    "Ctrl+Shift+Tab goes the other way",
    "Control key on macOS as well",
    "not Cmd",
    "Keep holding Control and press Tab again to go further back",
    "frozen while Control is held",
    "releasing Control makes the panel you stopped on the most recent",
    "There is no overlay",
    "A held Tab does not repeat",
    "panels in a separate window are skipped",
    "ignored while a dialog is open",
    "in a terminal it replaces the plain Tab that Ctrl+Tab used to send",
    "kept in memory",
    "not saved",
    "listed in the Keyboard shortcuts sheet",
    "cannot be rebound",
    "nothing is typed or sent",
  ])
    assert.ok(p.includes(fragment), "missing: " + fragment);
  assert.ok(!/future|later|for now|v1/i.test(p));
});

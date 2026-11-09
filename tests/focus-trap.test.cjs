const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const count = (text, part) => text.split(part).length - 1;
const collapse = (text) => text.replace(/\s+/g, " ");

function bundle(entry, external = []) {
  return buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external,
  }).outputFiles[0].text;
}
function load(entry) {
  const mod = new Module(path.join(root, entry), module);
  mod._compile(bundle(entry), path.join(root, entry));
  return mod.exports;
}

const trap = load("src/focus-trap.ts");
const { isFocusable, nextFocusIndex } = trap;
const candidate = (over = {}) => ({
  tag: "div",
  disabled: false,
  hidden: false,
  tabIndex: null,
  hasHref: false,
  ...over,
});

// ---- the dialog over a small react stand-in and a fake document ----

const flatten = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    flatten(node.props && node.props.children, out);
  }
  return out;
};

let componentsText;
// The real src/components.tsx, compiled with hooks that only record their calls.
function compileComponents() {
  componentsText ??= bundle("src/components.tsx", [
    "react",
    "react/jsx-runtime",
    "lucide-react",
  ]);
  const refs = [];
  const effects = [];
  const react = {
    useRef: (start) => {
      const slot = { current: start };
      refs.push(slot);
      return slot;
    },
    useEffect: (fn, deps) => effects.push({ fn, deps }),
  };
  const element = (type, props) => ({ type, props });
  const file = path.join(root, "src/components.tsx");
  const mod = new Module(file, module);
  mod.require = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return { jsx: element, jsxs: element, Fragment: "fragment" };
    if (name === "lucide-react")
      return {
        X: "X",
        LoaderCircle: "LoaderCircle",
        AlertCircle: "AlertCircle",
      };
    return {};
  };
  mod._compile(componentsText, file);
  return { exports: mod.exports, refs, effects };
}

// A fake dialog whose elements answer the few questions the Tab trap asks.
function fakeDialog(specs, doc) {
  const log = [];
  const make = (spec) => {
    const attrs = { ...(spec.attrs || {}) };
    const el = {
      name: spec.name,
      tagName: (spec.tag || "button").toUpperCase(),
      hidden: Boolean(spec.hidden),
      offsetParent: spec.detached ? null : {},
      matches(selector) {
        assert.equal(selector, ":disabled");
        return Boolean(spec.disabled);
      },
      getAttribute: (n) => (n in attrs ? attrs[n] : null),
      hasAttribute: (n) => n in attrs,
      focus() {
        doc.activeElement = el;
        log.push(spec.name);
      },
    };
    return el;
  };
  const items = specs.map(make);
  const hit = (el, piece) => {
    if (/^[a-z]+$/.test(piece)) return el.tagName === piece.toUpperCase();
    if (piece === "a[href]")
      return el.tagName === "A" && el.hasAttribute("href");
    if (piece === "[tabindex]") return el.hasAttribute("tabindex");
    throw new Error("the fake does not know the selector " + piece);
  };
  const dialog = {
    name: "dialog",
    queries: [],
    contains: (el) => el === dialog || items.includes(el),
    querySelectorAll(selector) {
      dialog.queries.push(selector);
      return items.filter((el) =>
        selector.split(",").some((piece) => hit(el, piece.trim())),
      );
    },
    querySelector: (selector) => dialog.querySelectorAll(selector)[0] ?? null,
  };
  return { dialog, items, log, named: (n) => items.find((e) => e.name === n) };
}

// Opens the real Modal over the fake dialog and returns the keys it reacts to.
function openDialog(specs, props = {}) {
  const keep = { document: globalThis.document, window: globalThis.window };
  const body = { name: "body", focus() {} };
  const opener = {
    name: "opener",
    focus() {
      doc.activeElement = opener;
      dom.log.push("opener");
    },
  };
  const doc = { activeElement: opener, body };
  const dom = fakeDialog(specs, doc);
  const listeners = [];
  const removed = [];
  const win = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => removed.push({ type, fn }),
  };
  globalThis.document = doc;
  globalThis.window = win;
  const compiled = compileComponents();
  const closed = [];
  const tree = compiled.exports.Modal({
    title: "Test",
    onClose: () => closed.push("close"),
    children: null,
    ...props,
  });
  const dialogNode = flatten(tree).find((n) => n.props?.role === "dialog");
  assert.equal(dialogNode.props.ref, compiled.refs[0], "the dialog ref");
  compiled.refs[0].current = dom.dialog;
  const cleanups = compiled.effects.map((e) => e.fn());
  const press = (key, shiftKey = false) => {
    const event = {
      key,
      shiftKey,
      prevented: 0,
      stopped: 0,
      preventDefault() {
        this.prevented++;
      },
      stopPropagation() {
        this.stopped++;
      },
    };
    for (const l of listeners.filter((x) => x.type === "keydown")) l.fn(event);
    return event;
  };
  return {
    ...dom,
    doc,
    body,
    opener,
    closed,
    press,
    listeners,
    removed,
    tree,
    dialogNode,
    effects: compiled.effects,
    focused: () => doc.activeElement.name,
    focusOn: (name) => {
      doc.activeElement = dom.named(name);
    },
    close: () => cleanups.forEach((c) => c && c()),
    done: () => {
      globalThis.document = keep.document;
      globalThis.window = keep.window;
    },
  };
}
const withDialog = (specs, run, props) => {
  const d = openDialog(specs, props);
  try {
    return run(d);
  } finally {
    d.done();
  }
};

// ---- the pure rules ----

test("focus-trap rules: Tab lands on native controls, summaries, links with an address and tabindex 0 or more, never on a disabled, hidden or tabindex -1 element; only the ends wrap, an outside focus is pulled in and nothing else is moved", () => {
  assert.deepEqual(Object.keys(trap).sort(), ["isFocusable", "nextFocusIndex"]);

  for (const tag of ["button", "input", "select", "textarea", "summary"]) {
    assert.equal(isFocusable(candidate({ tag })), true, tag);
    assert.equal(isFocusable(candidate({ tag: tag.toUpperCase() })), true, tag);
    assert.equal(isFocusable(candidate({ tag, disabled: true })), false, tag);
    assert.equal(isFocusable(candidate({ tag, hidden: true })), false, tag);
    assert.equal(isFocusable(candidate({ tag, tabIndex: -1 })), false, tag);
    assert.equal(isFocusable(candidate({ tag, tabIndex: 0 })), true, tag);
    assert.equal(isFocusable(candidate({ tag, tabIndex: NaN })), true, tag);
  }
  // A link only counts with an address, or when it was given a tabindex.
  assert.equal(isFocusable(candidate({ tag: "a", hasHref: true })), true);
  assert.equal(isFocusable(candidate({ tag: "a" })), false);
  assert.equal(isFocusable(candidate({ tag: "a", tabIndex: 0 })), true);
  assert.equal(
    isFocusable(candidate({ tag: "a", hasHref: true, hidden: true })),
    false,
  );
  // Anything else needs a tabindex of 0 or more.
  assert.equal(isFocusable(candidate()), false);
  assert.equal(isFocusable(candidate({ tabIndex: 0 })), true);
  assert.equal(isFocusable(candidate({ tabIndex: 3 })), true);
  assert.equal(isFocusable(candidate({ tabIndex: -1 })), false);
  assert.equal(isFocusable(candidate({ tabIndex: NaN })), false);
  assert.equal(isFocusable(candidate({ tabIndex: Infinity })), false);
  assert.equal(isFocusable(candidate({ tabIndex: 0, disabled: true })), false);
  assert.equal(isFocusable(candidate({ tabIndex: 0, hidden: true })), false);
  assert.equal(isFocusable(candidate({ tag: "span", tabIndex: 0 })), true);
  assert.equal(isFocusable(null), false);
  assert.equal(isFocusable(undefined), false);
  // The descriptor is only read.
  const frozen = Object.freeze(candidate({ tag: "button", tabIndex: 0 }));
  assert.equal(isFocusable(frozen), true);

  // No items: nothing to do, whatever else is given.
  for (const count0 of [0, -1, NaN, 1.5, Infinity])
    for (const active of [-1, 0, 1])
      for (const shift of [false, true])
        assert.equal(nextFocusIndex(count0, active, shift), -1);
  // One item keeps focus on itself, inside or outside.
  for (const active of [-1, 0, 5])
    for (const shift of [false, true])
      assert.equal(nextFocusIndex(1, active, shift), 0);
  // Three items: only the ends wrap.
  assert.equal(nextFocusIndex(3, 0, false), -1);
  assert.equal(nextFocusIndex(3, 1, false), -1);
  assert.equal(nextFocusIndex(3, 2, false), 0);
  assert.equal(nextFocusIndex(3, 0, true), 2);
  assert.equal(nextFocusIndex(3, 1, true), -1);
  assert.equal(nextFocusIndex(3, 2, true), -1);
  // Outside focus (-1 or any index off the list) goes to the first, or the last with Shift.
  for (const active of [-1, -5, 3, 99, NaN, 1.5, Infinity]) {
    assert.equal(nextFocusIndex(3, active, false), 0, String(active));
    assert.equal(nextFocusIndex(3, active, true), 2, String(active));
  }
  // Every small case: the answer is -1 only for a middle item, otherwise a valid index.
  for (let n = 0; n <= 6; n++)
    for (let at = -2; at <= n + 1; at++)
      for (const shift of [false, true]) {
        const got = nextFocusIndex(n, at, shift);
        const inside = at >= 0 && at < n;
        const middle = inside && at !== (shift ? 0 : n - 1);
        if (n === 0 || middle) assert.equal(got, -1, [n, at, shift].join());
        else assert.ok(got >= 0 && got < n, [n, at, shift].join());
      }
});

// ---- the tracer: the real dialog, a disabled last field ----

test("focus-trap tracer: in the real dialog a disabled last field no longer lets Tab leave, Tab on the last enabled control wraps to the first and Shift+Tab on the first wraps to the last enabled one", () => {
  withDialog(
    [
      { name: "close" },
      { name: "name", tag: "input" },
      { name: "notes", tag: "textarea", disabled: true },
    ],
    (d) => {
      // The dialog opens on its first field, as before.
      assert.equal(d.focused(), "name");
      const tab = d.press("Tab");
      assert.equal(tab.prevented, 1);
      assert.equal(d.focused(), "close");
      const back = d.press("Tab", true);
      assert.equal(back.prevented, 1);
      assert.equal(d.focused(), "name", "the disabled field is not a stop");
      assert.ok(
        d.dialog.queries.length >= 2,
        "the dialog was asked for its controls",
      );
    },
  );
});

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

// ---- the dialog: every case of the Tab trap, and what did not change ----

test("focus-trap modal: the real dialog skips disabled, hidden and tabindex -1 elements, counts summaries, links and tabindex 0, pulls an outside focus back in, leaves an unlisted inner focus and the middle to the browser, and keeps Escape, the first focus and the focus restore", () => {
  const shell = [{ name: "close" }, { name: "name", tag: "input" }];

  // A hidden or detached last control is not a stop.
  withDialog(
    [
      ...shell,
      { name: "go" },
      { name: "folded", detached: true },
      { name: "gone", hidden: true },
    ],
    (d) => {
      d.focusOn("go");
      assert.equal(d.press("Tab").prevented, 1);
      assert.equal(d.focused(), "close");
      d.press("Tab", true);
      assert.equal(d.focused(), "go");
    },
  );

  // A control inside a disabled fieldset answers to :disabled and is not a stop.
  withDialog(
    [...shell, { name: "go" }, { name: "busy", disabled: true }],
    (d) => {
      d.focusOn("go");
      d.press("Tab");
      assert.equal(d.focused(), "close");
    },
  );

  // A summary, a link with an address and tabindex 0 are stops; tabindex -1 and a link without an address are not.
  withDialog(
    [
      ...shell,
      { name: "more", tag: "summary" },
      { name: "docs", tag: "a", attrs: { href: "x" } },
      { name: "box", tag: "div", attrs: { tabindex: "0" } },
      { name: "list", tag: "div", attrs: { tabindex: "-1" } },
      { name: "bare", tag: "a" },
    ],
    (d) => {
      d.focusOn("box");
      assert.equal(d.press("Tab").prevented, 1, "the tabindex 0 box is last");
      assert.equal(d.focused(), "close");
      d.press("Tab", true);
      assert.equal(d.focused(), "box");
      assert.equal(
        d.press("Tab", true).prevented,
        0,
        "middle: the browser moves",
      );
      d.focusOn("more");
      assert.equal(d.press("Tab").prevented, 0, "middle: the browser moves");
      assert.equal(d.press("Tab", true).prevented, 0);
      assert.equal(d.focused(), "more");
    },
  );
  withDialog(
    [...shell, { name: "docs", tag: "a", attrs: { href: "x" } }],
    (d) => {
      d.focusOn("docs");
      assert.equal(d.press("Tab").prevented, 1, "a link is the last stop");
      assert.equal(d.focused(), "close");
    },
  );
  withDialog([...shell, { name: "more", tag: "summary" }], (d) => {
    d.focusOn("more");
    assert.equal(d.press("Tab").prevented, 1, "a summary is the last stop");
    assert.equal(d.focused(), "close");
  });

  // Focus outside the dialog is pulled back in: Tab to the first, Shift+Tab to the last.
  withDialog([...shell, { name: "go" }], (d) => {
    d.doc.activeElement = d.body;
    let key = d.press("Tab");
    assert.equal(key.prevented, 1);
    assert.equal(d.focused(), "close");
    d.doc.activeElement = { name: "page" };
    key = d.press("Tab", true);
    assert.equal(key.prevented, 1);
    assert.equal(d.focused(), "go");
  });

  // Focus inside the dialog on something Tab does not list stays with the browser, as before.
  withDialog(
    [...shell, { name: "list", tag: "div", attrs: { tabindex: "-1" } }],
    (d) => {
      d.focusOn("list");
      assert.equal(d.press("Tab").prevented, 0);
      assert.equal(d.press("Tab", true).prevented, 0);
      assert.equal(d.focused(), "list");
    },
  );

  // One stop keeps focus on itself; no stop does nothing.
  withDialog([{ name: "only" }], (d) => {
    d.focusOn("only");
    assert.equal(d.press("Tab").prevented, 1);
    assert.equal(d.press("Tab", true).prevented, 1);
    assert.equal(d.focused(), "only");
  });
  withDialog([{ name: "folded", detached: true }], (d) => {
    d.focusOn("folded");
    assert.equal(d.press("Tab").prevented, 0);
    assert.equal(d.press("Tab", true).prevented, 0);
  });

  // The middle is the browser's; other keys are ignored.
  withDialog([...shell, { name: "go" }], (d) => {
    d.focusOn("name");
    assert.equal(d.press("Tab").prevented, 0);
    assert.equal(d.press("Tab", true).prevented, 0);
    for (const key of ["Enter", " ", "a", "ArrowDown", "Shift"]) {
      const event = d.press(key);
      assert.equal(event.prevented + event.stopped, 0, key);
    }
    assert.deepEqual(d.closed, []);
  });

  // Escape closes through onClose and stops there; nothing else does.
  withDialog([...shell], (d) => {
    const event = d.press("Escape");
    assert.equal(event.stopped, 1);
    assert.deepEqual(d.closed, ["close"]);
  });

  // The first focus: the first field, else the first button; the listener lives on the window.
  withDialog([...shell, { name: "second", tag: "select" }], (d) => {
    assert.equal(d.focused(), "name");
    assert.deepEqual(
      d.listeners.map((l) => l.type),
      ["keydown"],
    );
    assert.deepEqual(
      d.effects.map((e) => e.deps),
      [["Test"]],
    );
  });
  withDialog([{ name: "close" }, { name: "go" }], (d) => {
    assert.equal(d.focused(), "close");
  });

  // Closing removes the same listener and gives focus back unless an action focused elsewhere.
  for (const [where, back] of [
    ["body", true],
    ["inside", true],
    ["elsewhere", false],
  ]) {
    withDialog([...shell, { name: "go" }], (d) => {
      const [listener] = d.listeners;
      if (where === "body") d.doc.activeElement = d.body;
      if (where === "elsewhere") d.doc.activeElement = { name: "else" };
      if (where === "inside") d.focusOn("go");
      d.log.length = 0;
      d.close();
      assert.deepEqual(
        d.removed,
        [{ type: "keydown", fn: listener.fn }],
        where,
      );
      assert.deepEqual(d.log, back ? ["opener"] : [], where);
    });
  }
});

// ---- the status roles ----

test("focus-trap roles: an error box is an alert and a loading message a status, nothing else in the file gained a role and the file still exports the same six components", () => {
  const compiled = compileComponents();
  const { ErrorBox, Loading, Empty } = compiled.exports;
  assert.deepEqual(Object.keys(compiled.exports).sort(), [
    "Empty",
    "ErrorBox",
    "IconButton",
    "Loading",
    "Modal",
    "StatusDot",
  ]);

  const box = ErrorBox({ error: "Boom" });
  assert.equal(box.type, "div");
  assert.equal(box.props.className, "error-box");
  assert.equal(box.props.role, "alert");
  assert.deepEqual(
    flatten(box)
      .filter((n) => n.type === "span")
      .map((n) => n.props.children),
    ["Boom"],
  );

  const loading = Loading({});
  assert.equal(loading.props.className, "panel-empty");
  assert.equal(loading.props.role, "status");
  assert.deepEqual(
    flatten(loading)
      .filter((n) => n.type === "span")
      .map((n) => n.props.children),
    ["Loading\u2026"],
  );
  const named = Loading({ text: "Opening file" });
  assert.equal(
    flatten(named).find((n) => n.type === "span").props.children,
    "Opening file",
  );

  // The empty state shares the class and stays a plain block, so it is not announced.
  const empty = Empty({ icon: "i", title: "T", description: "D" });
  assert.equal(empty.props.className, "panel-empty");
  assert.equal(empty.props.role, undefined);

  const source = read("src/components.tsx");
  assert.equal(count(source, 'role="alert"'), 1);
  assert.equal(count(source, 'role="status"'), 1);
  assert.equal(count(source, 'className="error-box" role="alert"'), 1);
  assert.equal(count(source, 'className="panel-empty" role="status"'), 1);
  assert.equal(count(source, 'className="panel-empty"'), 2);
  // The sidebar's own stale-inventory box keeps its status role: it is its own element.
  assert.equal(
    count(read("src/Sidebar.tsx"), '<div className="error-box" role="status">'),
    1,
  );
});

// ---- the rings and the delete control ----

test("focus-trap rings: the global ring lists summary, links, tabindex 0 and role button next to the four controls at low specificity, the two search boxes show it on their wrapper outside High Contrast, and the layout delete control is reached with Tab and pressed with Enter or Space", () => {
  const css = read("src/styles.css");
  const ring = [
    "button:focus-visible,",
    "input:focus-visible,",
    "select:focus-visible,",
    "textarea:focus-visible,",
    "summary:focus-visible,",
    "a:focus-visible,",
    ':where([tabindex="0"], [role="button"]):focus-visible {',
    "  outline: 2px solid var(--color-86cdb0);",
    "  outline-offset: 2px;",
    "}",
    "",
  ].join("\n");
  assert.equal(count(css, ring), 1, "one list, one ring, edited in place");
  assert.equal(count(css, "\nbutton:focus-visible,"), 1);

  // Each search box: its own rule, right after the rule that hides the input's ring, same ring, not in High Contrast.
  const wrapper = (box, off) =>
    new RegExp(
      "\\." +
        box +
        " " +
        off +
        " \\{\\n  outline: 0;\\n\\}\\n(?:/\\*[^\\n]*\\*/\\n)?" +
        ':root:not\\(\\[data-theme="high-contrast"\\]\\) \\.' +
        box +
        ":focus-within \\{\\n  outline: 2px solid var\\(--color-86cdb0\\);\\n  outline-offset: 2px;\\n\\}\\n",
      "g",
    );
  assert.equal(
    (css.match(wrapper("sidebar-search", "input:focus")) || []).length,
    1,
  );
  assert.equal(
    (css.match(wrapper("palette-input", "input:focus-visible")) || []).length,
    1,
  );
  assert.equal(count(css, ".sidebar-search:focus-within"), 1);
  assert.equal(count(css, ".palette-input:focus-within"), 1);
  // The High Contrast ring that already reaches every control is untouched.
  assert.equal(
    count(
      css,
      ':root[data-theme="high-contrast"] :focus-visible {\n  outline: 2px solid #ffffff;\n  outline-offset: 2px;\n}\n',
    ),
    1,
  );
  // The rings that were there stay as they were.
  assert.equal(
    count(
      css,
      ".task-markdown:focus-visible {\n  outline: 2px solid var(--color-86cdb0);\n  outline-offset: 2px;\n}",
    ),
    1,
  );
  assert.equal(count(css, ".designer-option:has(input:focus-visible) {"), 1);
  assert.equal(
    count(
      css,
      ".settings-search:focus-within {\n  border-color: var(--mint);\n}",
    ),
    1,
  );

  // The saved-layout delete control: still a span with a role and a label, now focusable, with a key handler that clicks it.
  const app = collapse(read("src/App.tsx"));
  const head = '<span role="button" tabIndex={0} onKeyDown={';
  assert.equal(count(app, head), 1);
  const from = app.indexOf(head) + head.length;
  const to = app.indexOf("} aria-label={`Delete layout ${saved.name}`}", from);
  assert.ok(to > from, "the handler ends before the label");
  const handler = new Function("return " + app.slice(from, to))();
  const press = (key) => {
    const calls = [];
    handler({
      key,
      preventDefault: () => calls.push("prevent"),
      currentTarget: { click: () => calls.push("click") },
    });
    return calls;
  };
  assert.deepEqual(press("Enter"), ["prevent", "click"]);
  assert.deepEqual(press(" "), ["prevent", "click"]);
  for (const key of ["Tab", "Escape", "a", "Backspace", "Delete", "Shift"])
    assert.deepEqual(press(key), [], key);
  assert.equal(
    count(
      app,
      'className="delete-layout" onClick={(e) => { e.stopPropagation(); setState(',
    ),
    1,
    "the mouse path still stops the click from restoring the layout",
  );
});

// ---- the other overlays: one attribute each, nothing else ----

test("focus-trap overlays: the terminal menu gained its label and the panel list its status role, the other menus and dialogs keep what they had, and nothing beyond those two attributes changed", () => {
  const tools = collapse(read("src/TerminalTools.tsx"));
  assert.equal(
    count(
      tools,
      '<div className="dropdown terminal-context-menu" role="menu" aria-label="Terminal" style={{',
    ),
    1,
  );
  assert.equal(count(tools, 'role="menu"'), 1);
  assert.equal(count(tools, 'role="menuitem"'), 9);

  // The panel tab menu already had its label; the navigator now announces its count like Quick Open does.
  const panelMenu = collapse(read("src/PanelContextMenu.tsx"));
  assert.equal(count(panelMenu, 'role="menu" aria-label="Panel"'), 1);
  const navigator = collapse(read("src/PanelNavigator.tsx"));
  assert.equal(
    count(navigator, '<div className="navigation-status" role="status">'),
    1,
  );
  assert.equal(count(navigator, 'role="listbox"'), 1);
  assert.equal(count(navigator, 'aria-label="Open workspace panels"'), 1);
  const quick = collapse(read("src/QuickOpen.tsx"));
  assert.equal(
    count(quick, '<div className="navigation-status" role="status">'),
    1,
  );

  // Dialogs: the shared one is a modal dialog named by its title; the update restart screen is an alert dialog.
  const components = collapse(read("src/components.tsx"));
  assert.equal(
    count(components, 'role="dialog" aria-modal="true" aria-label={title}'),
    1,
  );
  const app = collapse(read("src/App.tsx"));
  assert.equal(
    count(
      app,
      'role="alertdialog" aria-modal="true" aria-label="Installing update"',
    ),
    1,
  );
  assert.equal(
    count(
      collapse(read("src/AccountStatus.tsx")),
      'role="dialog" aria-label="Available accounts"',
    ),
    1,
  );
});

// ---- the wiring: one pure module, one reader, the rest of the dialog as it was ----

test("focus-trap wiring: the module is plain ASCII, pure, has no import and the exact exports; only the shared dialog uses it, and the dialog keeps its Escape, first focus, restore and dependency list", () => {
  const raw = read("src/focus-trap.ts");
  assert.ok(/^[\t\n\r -~]*$/.test(raw), "printable ASCII");
  const code = raw
    .split("\n")
    .filter((line) => !/^\s*(\/\*\*|\*|\/\/)/.test(line))
    .join("\n");
  assert.equal(count(code, " from "), 0, "no import");
  assert.ok(!/^\s*import\b/m.test(code), "no import");
  assert.ok(
    !/\b(window|document|fetch|process|require|localStorage|sessionStorage|navigator|setTimeout|setInterval|console)\b|Date\.now|new Date|Math\.random|innerHTML/.test(
      code,
    ),
    "no page, storage, clock, timer or network use",
  );
  assert.deepEqual(
    raw.split("\n").filter((line) => line.startsWith("export ")),
    [
      "export interface FocusCandidate {",
      "export function isFocusable(candidate: FocusCandidate): boolean {",
      "export function nextFocusIndex(",
    ],
  );
  // A doc comment sits directly above every export.
  const lines = raw.split("\n");
  lines.forEach((line, i) => {
    if (line.startsWith("export ")) {
      const above = lines[i - 1];
      assert.ok(
        above.trimStart().startsWith("/**") || above.trim() === "*/",
        "doc comment above " + line,
      );
    }
  });

  // Only the shared dialog knows the module.
  const users = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .filter((name) => /focus-trap/.test(read("src/" + name)))
    .sort();
  assert.deepEqual(users, ["components.tsx"]);
  const components = read("src/components.tsx");
  assert.equal(
    count(
      components,
      'import { isFocusable, nextFocusIndex, type FocusCandidate } from "./focus-trap";',
    ),
    1,
  );
  assert.equal(count(components, "isFocusable("), 1);
  assert.equal(count(components, "nextFocusIndex("), 1);
  assert.equal(count(components, "querySelectorAll"), 1);
  assert.equal(
    count(
      components,
      'const TABBABLE = "button,input,select,textarea,summary,a[href],[tabindex]";',
    ),
    1,
  );
  assert.equal(count(components, 'disabled: el.matches(":disabled"),'), 1);
  assert.equal(
    count(components, "hidden: el.hidden || el.offsetParent === null,"),
    1,
  );

  // What did not change in the dialog, character for character.
  for (const piece of [
    'if (event.key === "Escape") {\n        event.stopPropagation();\n        closeRef.current();\n      }',
    'ref.current?.querySelector<HTMLElement>("input,select,textarea") ||\n      ref.current?.querySelector<HTMLElement>("button")',
    'window.addEventListener("keydown", handler);',
    'window.removeEventListener("keydown", handler);',
    "// Respect a destination that an action already focused outside this dialog.",
    "if (!active || active === document.body || dialog?.contains(active)) previous?.focus();",
    "}, [title]);",
    'role="dialog"\n        aria-modal="true"\n        aria-label={title}',
  ])
    assert.equal(count(components, piece), 1, piece);
});

// ---- the docs ----

test("focus-trap docs: NAVIGATION.md has one Accessibility paragraph after the last project one that says what the rings, the dialog Tab trap and the announcements do, keeps its byte order mark, ASCII and single final line feed, and leaves the paragraph before it untouched", () => {
  const raw = read("NAVIGATION.md");
  assert.equal(raw.charCodeAt(0), 0xfeff, "the byte order mark stays");
  const nav = raw.slice(1);
  assert.ok(/^[\t\n -~]*$/.test(nav), "plain ASCII");
  assert.ok(nav.endsWith(".\n") && !nav.endsWith("\n\n"));
  const lines = nav.split("\n");
  const mine = lines.filter((line) => line.startsWith("Accessibility: "));
  assert.equal(mine.length, 1);
  assert.equal(count(nav, "\nAccessibility: "), 1);
  // It follows the Reopen the last project paragraph directly (a later note may follow it).
  const at = lines.indexOf(mine[0]);
  assert.equal(lines[at - 1], "");
  assert.ok(lines[at - 2].startsWith("Reopen the last project: "));
  for (const part of [
    "keyboard focus ring (the mint outline, white in the High Contrast theme)",
    "the arrow of an expandable section",
    "the delete control of a saved layout in the Arrange menu",
    "pressed with Enter or Space",
    "Filter sessions box and the command center search box",
    "Tab and Shift+Tab stay inside an open dialog",
    "disabled and hidden controls are skipped",
    "when focus was outside the dialog the next Tab moves it back in",
    "announces an error box as an alert and a loading message as a status update",
    "no setting or shortcut was added",
  ])
    assert.ok(mine[0].includes(part), "NAVIGATION.md says: " + part);
  // The paragraph before it is the one the last project tests read.
  assert.equal(count(nav, "\nReopen the last project: "), 1);
});
